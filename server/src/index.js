import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { router } from './routes.js';
import { createHub } from './hub.js';
import { startBackupScheduler } from './backup.js';
import { mountDownloads } from './download.js';

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
          'img-src': ["'self'", 'data:'],
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

  // The admin portal (served before the JSON body parser; it has no API body).
  app.get(['/admin', '/admin/'], (_req, res) =>
    res.sendFile(path.join(publicDir, 'admin.html'))
  );

  // Public landing page + APK download (root domain auto-downloads the latest build).
  mountDownloads(app, publicDir);

  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, name: 'ping', version: '2.0.0' }));

  // Tighter limit on auth + admin endpoints to slow down credential/token guessing.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.authRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte warte einen Moment und versuch es erneut.' },
  });
  app.use('/api/auth', authLimiter);
  app.use('/api/admin', authLimiter);

  // General API rate limit.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Etwas zu schnell — bitte einen Moment warten.' },
    })
  );

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

  const shutdown = () => {
    console.log('\nServer wird beendet …');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
