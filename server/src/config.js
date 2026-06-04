import crypto from 'node:crypto';

// Centralised runtime configuration. Everything is overridable through the
// environment so the same build runs locally, in CI and in production.
const isProd = process.env.NODE_ENV === 'production';

function readSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (isProd) {
    throw new Error(
      'JWT_SECRET must be set to a strong value (>=16 chars) in production.'
    );
  }
  // Dev fallback: a per-process random secret. Tokens won't survive a restart,
  // which is exactly what you want while hacking locally.
  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: readSecret(),
  // Access tokens are long-lived because this is a chat client that should
  // stay logged in; rotate by changing JWT_SECRET if you ever need to.
  tokenTtl: process.env.TOKEN_TTL || '180d',
  dbFile: process.env.DB_FILE || 'ping.db',
  // Comma separated list, or "*" to allow any origin (handy for the Android
  // emulator and desktop builds which don't send a meaningful Origin).
  corsOrigins: process.env.CORS_ORIGINS || '*',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  // How long a user is considered "online" after their last socket ping.
  presenceTimeoutMs: 35_000,
};
