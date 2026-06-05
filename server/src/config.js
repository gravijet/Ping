import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

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

const dbFile = process.env.DB_FILE || 'ping.db';
const isMemoryDb = /:memory:|mode=memory/.test(dbFile);

export const config = {
  isProd,
  // A port in the IANA dynamic/private range (49152-65535) that also sits above
  // the usual Linux ephemeral range (32768-60999), so it won't collide with the
  // other services or with the OS's outbound sockets on a busy host.
  port: Number(process.env.PORT) || 61337,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: readSecret(),
  // Access tokens are long-lived because this is a chat client that should
  // stay logged in; rotate by changing JWT_SECRET if you ever need to.
  tokenTtl: process.env.TOKEN_TTL || '180d',
  dbFile,
  // Uploaded avatars live next to the database (so the Docker /data volume
  // persists them too) unless an explicit directory is given. In-memory DBs
  // (tests) get a throwaway temp dir so the repo never gets an uploads/ folder.
  uploadsDir:
    process.env.UPLOADS_DIR ||
    (isMemoryDb
      ? path.join(os.tmpdir(), 'ping-uploads')
      : path.join(path.dirname(path.resolve(dbFile)), 'uploads')),
  // Comma separated list, or "*" to allow any origin (handy for the Android
  // emulator and desktop builds which don't send a meaningful Origin).
  corsOrigins: process.env.CORS_ORIGINS || '*',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  // How long a user is considered "online" after their last socket ping.
  presenceTimeoutMs: 35_000,
  // Requests allowed per 15 min window on the auth endpoints (per IP).
  authRateMax: Number(process.env.AUTH_RATE_MAX) || 40,

  // Numbers entered without a country code are assumed to belong to this one
  // (49 = Germany). Always overridable per input by typing +<cc>.
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '49').replace(/\D/g, ''),

  // Max avatar upload size.
  maxAvatarBytes: Number(process.env.MAX_AVATAR_BYTES) || 5 * 1024 * 1024,

  // Max size of a message attachment (photo, voice note, file, …).
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 30 * 1024 * 1024,

  // How long a status update ("story") stays visible before it expires.
  statusTtlMs: Number(process.env.STATUS_TTL_MS) || 24 * 60 * 60 * 1000,

  // Privacy: how many identifiers a single contact-match request may carry.
  // Contacts are matched in memory and never stored.
  maxContactMatch: Number(process.env.MAX_CONTACT_MATCH) || 2000,

  // ---- Admin portal --------------------------------------------------------
  // Secret that unlocks /admin and the /api/admin/* endpoints. Required in
  // production; without it the admin portal stays disabled. In dev it defaults
  // to a known value so the portal works out of the box.
  adminToken: process.env.ADMIN_TOKEN || (isProd ? null : 'ping-admin-dev'),
};
