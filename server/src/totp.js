import crypto from 'node:crypto';

// Dependency-free TOTP (RFC 6238) on top of node:crypto — the same approach the
// rest of the server takes (Web Push in webpush.js is hand-rolled too) so 2FA
// adds zero npm dependencies. Authenticator apps (Google Authenticator, Aegis,
// 1Password, …) all speak the standard otpauth:// + 6-digit / 30s SHA-1 dialect
// we implement here, so a user can pair with whatever app they already have.

const STEP_SECONDS = 30; // RFC 6238 default time-step
const DIGITS = 6;
const ALGO = 'sha1'; // the de-facto authenticator default

// RFC 4648 base32 alphabet (no padding in otpauth secrets).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode raw bytes as an (unpadded) base32 string. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 string (case-insensitive, padding/space tolerant) to bytes. */
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue; // skip anything outside the alphabet
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh, random base32 secret (20 bytes = 160 bits, the RFC-recommended size). */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** The HOTP value for a given counter, as a zero-padded DIGITS-long string. */
function hotp(secretBytes, counter) {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. JS bit-ops are 32-bit, so write each half.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac(ALGO, secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The current TOTP code for [secret] (base32) at [when] ms (default now). */
export function generateToken(secret, when = Date.now()) {
  const counter = Math.floor(when / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verify a user-supplied [token] against [secret], tolerating ±[window] steps
 * of clock drift (default ±1 → a ~90s acceptance window). Constant-time per
 * candidate so a timing side-channel can't leak which step matched. Returns
 * true/false.
 */
export function verifyToken(secret, token, { window = 1, when = Date.now() } = {}) {
  const cleaned = String(token || '').replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return false;
  const secretBytes = base32Decode(secret);
  const counter = Math.floor(when / 1000 / STEP_SECONDS);
  const supplied = Buffer.from(cleaned);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secretBytes, counter + i));
    if (
      candidate.length === supplied.length &&
      crypto.timingSafeEqual(candidate, supplied)
    ) {
      ok = true; // keep looping so the runtime doesn't depend on which step hit
    }
  }
  return ok;
}

/**
 * Build the otpauth:// URI an authenticator app reads from a QR code.
 * [label] is the account name (we use the e-mail), [issuer] the service name.
 */
export function otpauthUri(secret, label, issuer = 'Ping') {
  const acct = encodeURIComponent(`${issuer}:${label}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: ALGO.toUpperCase(),
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${acct}?${params.toString()}`;
}

/** Ten fresh recovery codes, formatted "xxxx-xxxx" from a crypto-random pool. */
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // 5 bytes → 8 base32 chars; split into two 4-char groups for readability.
    const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8).toLowerCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** Canonical hash of a recovery code (case/format-insensitive) for storage. */
export function hashRecoveryCode(code) {
  const norm = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha256').update(norm).digest('hex');
}
