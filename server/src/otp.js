import crypto from 'node:crypto';
import { db, now } from './db.js';
import { config } from './config.js';
import { sendSms } from './sms.js';

// Server-side phone verification: generate a one-time code, text it to the
// number, and check it back. Only a hash of the code is ever stored.

const stmts = {
  get: db.prepare('SELECT * FROM phone_codes WHERE phone = ?'),
  upsert: db.prepare(`
    INSERT INTO phone_codes (phone, code_hash, expires_at, attempts, last_sent, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      last_sent = excluded.last_sent`),
  bumpAttempts: db.prepare('UPDATE phone_codes SET attempts = attempts + 1 WHERE phone = ?'),
  del: db.prepare('DELETE FROM phone_codes WHERE phone = ?'),
};

function hashCode(phone, code) {
  // Bind the hash to the number so a code can't be replayed for another number,
  // and to the JWT secret so the table on its own isn't enough to forge one.
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${phone}:${code}`)
    .digest('hex');
}

function randomCode(len) {
  // Uniformly-random numeric code (no modulo bias), zero-padded.
  const max = 10 ** len;
  let n = crypto.randomInt(0, max);
  // For multi-digit codes, re-roll the (rare) leading-zero-heavy draws so the
  // code reliably fills its width.
  if (len > 1) {
    while (n < max / 10) n = crypto.randomInt(0, max);
  }
  return String(n).padStart(len, '0');
}

/**
 * Generate + send a verification code for [phone] (canonical E.164).
 * Returns { ok, expiresInSec, devCode?, retryInSec? }.
 * When throttled, returns { ok:false, retryInSec }.
 */
export async function requestCode(phone) {
  const ts = now();
  const existing = stmts.get.get(phone);
  if (existing && ts - existing.last_sent < config.otpResendMs) {
    return {
      ok: false,
      retryInSec: Math.ceil((config.otpResendMs - (ts - existing.last_sent)) / 1000),
    };
  }
  const code = randomCode(config.otpLength);
  stmts.upsert.run(phone, hashCode(phone, code), ts + config.otpTtlMs, ts, ts);

  const text = `Ping Bestätigungscode: ${code}\nGib ihn in der App ein. Er läuft in ${Math.round(
    config.otpTtlMs / 60000
  )} Minuten ab.`;
  const sent = await sendSms(phone, text);

  const out = { ok: true, expiresInSec: Math.round(config.otpTtlMs / 1000) };
  if (config.smsExposeCode || !sent.ok) out.devCode = code;
  if (!sent.ok) out.warning = 'SMS-Versand fehlgeschlagen — Code siehe Server-Log.';
  return out;
}

/**
 * Check [code] for [phone]. Returns true on success (and clears the code), false
 * otherwise. Wrong guesses count against otpMaxAttempts; expired codes are dropped.
 */
export function verifyCode(phone, code) {
  const row = stmts.get.get(phone);
  if (!row) return false;
  if (now() > row.expires_at) {
    stmts.del.run(phone);
    return false;
  }
  if (row.attempts >= config.otpMaxAttempts) {
    stmts.del.run(phone);
    return false;
  }
  const ok =
    row.code_hash.length === hashCode(phone, code).length &&
    crypto.timingSafeEqual(
      Buffer.from(row.code_hash),
      Buffer.from(hashCode(phone, code))
    );
  if (ok) {
    stmts.del.run(phone);
    return true;
  }
  stmts.bumpAttempts.run(phone);
  return false;
}
