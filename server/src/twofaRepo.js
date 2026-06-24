import { db, now, tx } from './db.js';
import { hashRecoveryCode } from './totp.js';

// Persistence for two-factor auth: one user_totp row per account plus a pool of
// single-use recovery_codes. The TOTP secret is created when a user *begins*
// setup (enabled = 0) and only becomes a login gate once they confirm a code
// (enabled = 1). Recovery codes are stored hashed; we only ever return them in
// plaintext once, at the moment they are generated.

const s = {
  get: db.prepare('SELECT * FROM user_totp WHERE user_id = ?'),
  upsertSecret: db.prepare(`
    INSERT INTO user_totp (user_id, secret, enabled, created_at)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, confirmed_at = NULL`),
  enable: db.prepare('UPDATE user_totp SET enabled = 1, confirmed_at = ? WHERE user_id = ?'),
  del: db.prepare('DELETE FROM user_totp WHERE user_id = ?'),

  insertCode: db.prepare(
    'INSERT OR IGNORE INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)'
  ),
  delCodes: db.prepare('DELETE FROM recovery_codes WHERE user_id = ?'),
  findCode: db.prepare(
    'SELECT * FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL'
  ),
  // The `used_at IS NULL` guard makes the UPDATE itself the atomic single-use
  // consume — `changes > 0` then can't double-count a code even if two requests
  // ever raced (today node:sqlite runs find+use in one synchronous tick).
  useCode: db.prepare(
    'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL'
  ),
  countUnused: db.prepare(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL'
  ),
};

/** The raw user_totp row, or undefined if 2FA was never set up. */
export const getTotp = (userId) => s.get.get(userId);

/** Whether [userId] has fully enabled 2FA (a confirmed authenticator). */
export const is2faEnabled = (userId) => (s.get.get(userId)?.enabled ? true : false);

/** Begin (or restart) setup: store a fresh pending secret, not yet enabled. */
export function beginSetup(userId, secret) {
  s.upsertSecret.run(userId, secret, now());
  return s.get.get(userId);
}

/** Flip the pending secret to enabled and replace the recovery-code pool. */
export function enable2fa(userId, codes) {
  return tx(() => {
    s.enable.run(now(), userId);
    s.delCodes.run(userId);
    const t = now();
    for (const code of codes) s.insertCode.run(userId, hashRecoveryCode(code), t);
    return s.get.get(userId);
  });
}

/** Tear down 2FA completely (secret + every recovery code). */
export function disable2fa(userId) {
  return tx(() => {
    s.del.run(userId);
    s.delCodes.run(userId);
    return true;
  });
}

/** Replace the recovery-code pool (used by "neue Codes erzeugen"). */
export function replaceRecoveryCodes(userId, codes) {
  return tx(() => {
    s.delCodes.run(userId);
    const t = now();
    for (const code of codes) s.insertCode.run(userId, hashRecoveryCode(code), t);
    return true;
  });
}

/** How many recovery codes are still unused. */
export const unusedRecoveryCount = (userId) => s.countUnused.get(userId)?.n || 0;

/**
 * Atomically consume a recovery code: returns true (and marks it used) only if
 * [code] matches an unused code for [userId]. A used code can never be replayed.
 */
export function consumeRecoveryCode(userId, code) {
  const hash = hashRecoveryCode(code);
  const row = s.findCode.get(userId, hash);
  if (!row) return false;
  const r = s.useCode.run(now(), userId, hash);
  return r.changes > 0;
}
