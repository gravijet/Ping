import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { router } from './routes.js';
import { apiV1 } from './apiV1.js';
import { createHub } from './hub.js';
import { ensureOfficialUser } from './repo.js';
import { startBackupScheduler } from './backup.js';
import { startMaintenance } from './maintenance.js';
import { mountDownloads } from './download.js';
import { mountWebApp } from './webapp.js';
import { requireCfAccess } from './cfAccess.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  // The admin portal is a tiny inline-script page, so relax CSP just enough to
  // let it run while keeping helmet's other protections.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
          // Allow Google Fonts on the landing page + admin portal for nicer type.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          // Allow https images so the newsroom can show externally-hosted cover
          // images alongside our own /api/uploads/ ones.
          'img-src': ["'self'", 'data:', 'https:'],
          // Helmet enables `upgrade-insecure-requests` by default, which makes
          // the browser rewrite the admin portal's same-origin `fetch('/api/…')`
          // calls to https://. When Ping is served over plain HTTP (a self-hosted
          // server without TLS in front) there is no https listener, so every
          // request dies with a network-level "Failed to fetch" — which is exactly
          // what shows up the moment you try to log into /admin. Dropping the
          // directive lets the portal talk to its own origin over http. (When TLS
          // *is* terminated in front, requests are already https, so this is safe.)
          'upgrade-insecure-requests': null,
        },
      },
    })
  );
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(','),
    })
  );

  // --- Ping Web (Flutter web app on its own subdomain) ---------------------
  // Serves the web build for requests whose Host is config.webAppHost; /api,
  // /ws and /health fall through to the normal handlers (same-origin, no CORS).
  // A no-op on the apex domain, so the marketing site below is untouched.
  mountWebApp(app);

  // --- In-app admin console bridge -----------------------------------------
  // The native app authenticates with a normal user JWT and can't carry a
  // Cloudflare Access session (that login only lives in the browser). So a
  // signed-in admin reaches the admin API through a parallel /api/console/*
  // path that sits *outside* the Cloudflare-Access-protected surface. We rewrite
  // it onto the exact same /api/admin/* handlers — still locked down by
  // requireAdmin (a real admin account) and recorded in the audit log — and flag
  // the request so the Cloudflare Access gate below skips it. Cloudflare Access
  // keeps guarding the human web portal (/admin) and its /api/admin/* traffic.
  app.use((req, _res, next) => {
    if (req.url === '/api/console' || req.url.startsWith('/api/console/')) {
      req.url = '/api/admin' + req.url.slice('/api/console'.length);
      req.appConsole = true;
    }
    next();
  });

  // The admin portal (served before the JSON body parser; it has no API body).
  // Lives at config.adminPath (set ADMIN_PATH to hide it) and, when Cloudflare
  // Access is configured, is gated by a verified Access JWT.
  app.get([config.adminPath, `${config.adminPath}/`], requireCfAccess, (_req, res) =>
    res.sendFile(path.join(publicDir, 'admin.html'))
  );

  // Public landing page + APK download (root domain auto-downloads the latest build).
  mountDownloads(app, publicDir);

  // Developer API documentation — a static page that documents /api/v1. Served
  // before the JSON parser and the API rate limiters so it behaves like any
  // other marketing page, and before the catch-all /api 404 so GET /api lands
  // here instead of erroring.
  app.get(['/api', '/api/docs'], (_req, res) =>
    res.sendFile(path.join(publicDir, 'api-docs.html'))
  );

  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) =>
    res.json({ ok: true, name: 'ping', version: config.version })
  );

  // Rate-limit key: in production the server sits behind Cloudflare + nginx, so
  // req.ip is an edge/proxy address shared by *all* users — keying on it would
  // throttle everyone together. Cloudflare passes the real client address in
  // CF-Connecting-IP; fall back to req.ip when it's absent (local/dev/tests).
  const clientKey = (req) => {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    return req.ip;
  };

  // Tighter limit on auth endpoints to slow down credential guessing.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.authRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    message: { error: 'Zu viele Versuche. Bitte warte einen Moment und versuch es erneut.' },
    // Desktop device-linking lives under /api/auth/link but isn't credential
    // guessing — the desktop *polls* /auth/link/poll every couple of seconds
    // while it waits for the phone to scan the QR, which would blow through the
    // strict bucket in seconds. These endpoints still fall under the general
    // /api limiter below and the links themselves expire in ~2 minutes.
    skip: (req) => req.originalUrl.includes('/auth/link'),
  });
  app.use('/api/auth', authLimiter);

  // The admin portal gets its own bucket: still slow enough to blunt token
  // guessing, but roomy enough for the dashboard's auto-refresh polling.
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(config.authRateMax * 6, 240),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    message: { error: 'Zu viele Versuche. Bitte warte einen Moment und versuch es erneut.' },
  });
  // Cloudflare Access gate (no-op unless configured) runs before the admin
  // limiter + token check, so unauthenticated traffic is rejected at the edge of
  // the API too — not just on the portal page. Requests that arrived via the
  // /api/console bridge (the native app) are exempt: they can't carry a CF
  // Access session and are already gated by requireAdmin + the audit log.
  app.use('/api/admin', (req, res, next) =>
    req.appConsole ? next() : requireCfAccess(req, res, next)
  );
  app.use('/api/admin', adminLimiter);

  // General API rate limit.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: config.apiRateMax,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: clientKey,
      message: { error: 'Etwas zu schnell — bitte einen Moment warten.' },
    })
  );

  // Public developer API (key-authenticated). Sits under the general /api rate
  // limiter above but outside the stricter /api/auth and /api/admin buckets.
  app.use('/api/v1', apiV1);

  app.use('/api', router);

  // 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Diese Ressource gibt es nicht.' }));

  // Central error handler — never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({
      error: status >= 500 ? 'Auf dem Server ist etwas schiefgelaufen.' : err.message,
    });
  });

  return app;
}

export function createServer() {
  // Make sure the official "Ping Team" account exists before we serve traffic.
  ensureOfficialUser();
  const app = createApp();
  const server = http.createServer(app);
  createHub(server);
  return server;
}

// Only start listening when run directly (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`Ping server läuft auf http://${config.host}:${config.port}`);
    console.log(`WebSocket: ws://${config.host}:${config.port}/ws`);
  });
  startBackupScheduler();
  startMaintenance();

  const shutdown = () => {
    console.log('\nServer wird beendet …');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
