import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';

// Serve the Flutter web build ("Ping Web") on its own subdomain (config.webAppHost),
// off *this same* Node process. On that host:
//   - /api/*, /ws and /health are left to the normal handlers (same-origin, so
//     the web client talks to its API + WebSocket without any CORS), and
//   - everything else serves the static bundle in config.webAppDir, falling back
//     to index.html so Flutter's client-side routing and deep links work.
// On every other host this is a no-op, so the marketing site on the apex domain
// is completely untouched.

// A Flutter-web-friendly CSP (helmet's default blocks CanvasKit's wasm eval and
// the inline bootstrap script). Applied only to responses we serve for the
// web-app host; the apex site keeps its own stricter CSP from index.js.
const WEB_APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: blob: data: https://www.gstatic.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
].join('; ');

// Requests that must reach the normal API / realtime / health handlers even on
// the web-app host (everything else is the single-page app).
function isPassThrough(reqPath) {
  return (
    reqPath === '/api' ||
    reqPath.startsWith('/api/') ||
    reqPath === '/ws' ||
    reqPath === '/health'
  );
}

export function mountWebApp(app) {
  const host = config.webAppHost;
  if (!host) return; // serving the web app is disabled

  const dir = config.webAppDir;
  const indexFile = path.join(dir, 'index.html');

  // Long-cache the immutable hashed Flutter assets; keep index.html uncached so
  // a redeploy is picked up on the next load.
  const serveStatic = express.static(dir, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });

  app.use((req, res, next) => {
    if ((req.hostname || '').toLowerCase() !== host) return next();
    if (isPassThrough(req.path)) return next();

    // Flutter-web CSP for everything we serve on this host.
    res.setHeader('Content-Security-Policy', WEB_APP_CSP);

    serveStatic(req, res, (err) => {
      if (err) return next(err);
      // Not a real asset → serve the SPA shell so client-side routes resolve.
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      fs.access(indexFile, fs.constants.R_OK, (accessErr) => {
        if (accessErr) {
          // The bundle hasn't been built yet — a clear hint beats a blank 404.
          return res
            .status(503)
            .type('text/plain; charset=utf-8')
            .send('Ping Web ist noch nicht gebaut. Führe scripts/build-web.sh aus.');
        }
        res.sendFile(indexFile);
      });
    });
  });
}
