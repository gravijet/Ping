import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { router } from './routes.js';
import { createHub } from './hub.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(','),
    })
  );
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, name: 'ping', version: '1.0.0' }));

  // Tighter limit on auth endpoints to slow down credential stuffing.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte warte einen Moment und versuch es erneut.' },
  });
  app.use('/api/auth', authLimiter);

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

  const shutdown = () => {
    console.log('\nServer wird beendet …');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
