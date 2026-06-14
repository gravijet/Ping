import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Centralised runtime configuration. Everything is overridable through the
// environment so the same build runs locally, in CI and in production.
const isProd = process.env.NODE_ENV === 'production';

// The single source of truth for the server version (surfaced by /health and
// the admin system view) is package.json — no hardcoded copies elsewhere.
function readVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
        'utf8'
      )
    );
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

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
  version: readVersion(),
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
  // Requests allowed per minute on the general API (per IP). Raise it in tests
  // (the suite fires far more than a human ever would in one minute).
  apiRateMax: Number(process.env.API_RATE_MAX) || 300,

  // Numbers entered without a country code are assumed to belong to this one
  // (43 = Austria). Always overridable per input by typing +<cc>.
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '43').replace(/\D/g, ''),

  // Max avatar upload size.
  maxAvatarBytes: Number(process.env.MAX_AVATAR_BYTES) || 5 * 1024 * 1024,

  // Max size of a message attachment (photo, voice note, file, …).
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 30 * 1024 * 1024,

  // How long a status update ("story") stays visible before it expires.
  statusTtlMs: Number(process.env.STATUS_TTL_MS) || 24 * 60 * 60 * 1000,

  // Privacy: how many identifiers a single contact-match request may carry.
  // Contacts are matched in memory and never stored.
  maxContactMatch: Number(process.env.MAX_CONTACT_MATCH) || 2000,

  // ---- Firebase phone verification -----------------------------------------
  // The Firebase project whose ID tokens we accept as proof of phone ownership.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'ping-gj',
  // When true, /auth/register refuses accounts without a valid Firebase phone
  // token. Keep it off until the verifying app build is rolled out, then flip
  // REQUIRE_PHONE_VERIFICATION=1 to enforce it.
  requirePhoneVerification:
    /^(1|true|yes)$/i.test(process.env.REQUIRE_PHONE_VERIFICATION || ''),

  // ---- Firebase Cloud Messaging (push notifications) -----------------------
  // Path to the Firebase service-account JSON (Project settings → Service
  // accounts → "Generate new private key"). When present the server can send
  // FCM push notifications for new messages / admin broadcasts to devices that
  // don't currently have the app open. Without it push simply stays disabled
  // (everything else keeps working over the live WebSocket).
  firebaseServiceAccountPath:
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firebase-service-account.json'),

  // ---- Backups -------------------------------------------------------------
  // Automatic daily snapshots of the SQLite database (via VACUUM INTO, which is
  // consistent even while the server is running). Stored next to the DB unless
  // overridden. Set BACKUP_ENABLED=0 to turn the scheduler off.
  backupEnabled: !/^(0|false|no)$/i.test(process.env.BACKUP_ENABLED || ''),
  backupDir:
    process.env.BACKUP_DIR ||
    (isMemoryDb
      ? path.join(os.tmpdir(), 'ping-backups')
      : path.join(path.dirname(path.resolve(dbFile)), 'backups')),
  // How many daily snapshots to keep before pruning the oldest.
  backupKeep: Number(process.env.BACKUP_KEEP) || 14,
  // How often to snapshot (default 24h).
  backupIntervalMs: Number(process.env.BACKUP_INTERVAL_MS) || 24 * 60 * 60 * 1000,

  // ---- Admin portal --------------------------------------------------------
  // Secret that unlocks /admin and the /api/admin/* endpoints. Required in
  // production; without it the admin portal stays disabled. In dev it defaults
  // to a known value so the portal works out of the box.
  adminToken: process.env.ADMIN_TOKEN || (isProd ? null : 'ping-admin-dev'),

  // The URL path the admin portal HTML is served at. Set this to something
  // non-guessable in production (e.g. ADMIN_PATH=/control-7f3a) so the dashboard
  // isn't sitting at the obvious /admin. Always starts with a slash.
  adminPath: (() => {
    let p = (process.env.ADMIN_PATH || '/admin').trim();
    if (!p.startsWith('/')) p = `/${p}`;
    return p.replace(/\/+$/, '') || '/admin';
  })(),

  // ---- Cloudflare Zero Trust (Access) --------------------------------------
  // When this deployment sits behind a Cloudflare Access application, Cloudflare
  // authenticates the visitor (email/Google/etc.) before the request reaches us
  // and forwards a signed JWT in the `Cf-Access-Jwt-Assertion` header. Setting
  // both values turns on origin-side verification of that JWT for the admin
  // portal + /api/admin, so even a request that bypasses Cloudflare (hitting the
  // origin IP directly) can't reach admin. Leave unset to disable (dev/tests).
  //   CF_ACCESS_TEAM_DOMAIN – e.g. "myteam.cloudflareaccess.com" or "myteam"
  //   CF_ACCESS_AUD         – the Access application's Audience (AUD) tag
  cfAccess: (() => {
    let team = (process.env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (team && !team.includes('.')) team = `${team}.cloudflareaccess.com`;
    const aud = (process.env.CF_ACCESS_AUD || '').trim();
    return team && aud ? { teamDomain: team, aud } : null;
  })(),

  // ---- App download (landing page + APK) -----------------------------------
  // Where the public landing page picks up the latest Android build. The newest
  // *.apk in this directory is what visitors download from `/` and `/download`.
  // Defaults to server/public/downloads. Use `scripts/publish-apk.sh` to copy a
  // fresh release build in.
  apkDir:
    process.env.APK_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'downloads'),
  // The public URL of this deployment (used in invite links / landing copy).
  // Primary domain is ping.example.invalid.
  publicUrl: (process.env.PUBLIC_URL || 'https://example.invalid').replace(/\/$/, ''),

  // ---- SMS phone verification (server-side OTP) ----------------------------
  // Ping can verify a phone number itself by texting a one-time code, instead of
  // relying on Firebase. Pick a provider via SMS_PROVIDER:
  //   'log'    – (default) no real SMS; the code is written to the server log and,
  //              unless SMS_EXPOSE_CODE=0, returned in the API response so you can
  //              test the whole flow before wiring up a paid gateway.
  //   'twilio' – Twilio REST API. Needs SMS_TWILIO_SID, SMS_TWILIO_TOKEN, SMS_FROM.
  //   'http'   – any generic HTTP SMS gateway: POSTs {"to","text"} as JSON to
  //              SMS_HTTP_URL (optionally with an Authorization: SMS_HTTP_AUTH).
  smsProvider: (process.env.SMS_PROVIDER || 'log').toLowerCase(),
  smsFrom: process.env.SMS_FROM || 'Ping',
  twilioSid: process.env.SMS_TWILIO_SID || '',
  twilioToken: process.env.SMS_TWILIO_TOKEN || '',
  smsHttpUrl: process.env.SMS_HTTP_URL || '',
  smsHttpAuth: process.env.SMS_HTTP_AUTH || '',
  // Return the code in the request response (handy for the 'log' provider and
  // local testing). Defaults on whenever the provider can't actually deliver SMS.
  smsExposeCode: process.env.SMS_EXPOSE_CODE
    ? /^(1|true|yes)$/i.test(process.env.SMS_EXPOSE_CODE)
    : (process.env.SMS_PROVIDER || 'log').toLowerCase() === 'log',
  // One-time code shape + lifetime.
  otpLength: Number(process.env.OTP_LENGTH) || 6,
  otpTtlMs: Number(process.env.OTP_TTL_MS) || 5 * 60 * 1000,
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  // Don't let the same number request a fresh code more often than this.
  otpResendMs: Number(process.env.OTP_RESEND_MS) || 30 * 1000,

  // ---- WebRTC calls (ICE servers) ------------------------------------------
  // STUN is always available (public Google STUN by default). For reliable calls
  // through NAT/firewalls, run a TURN server (coturn) and set TURN_URL/_USER/
  // _PASS — see server/deploy/coturn.md.
  ice: {
    stun: process.env.STUN_URL || 'stun:stun.l.google.com:19302',
    turnUrl: process.env.TURN_URL || '', // e.g. turn:example.invalid:3478
    turnUser: process.env.TURN_USER || '',
    turnPass: process.env.TURN_PASS || '',
  },
};
