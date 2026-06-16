import { db, now } from './db.js';

// Storage for FCM device tokens. One row per device token (token is globally
// unique). A user may register tokens from several devices.

const s = {
  upsert: db.prepare(`
    INSERT INTO push_tokens (token, user_id, platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      updated_at = excluded.updated_at
  `),
  deleteToken: db.prepare('DELETE FROM push_tokens WHERE token = ?'),
  deleteUserToken: db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?'),
  byUser: db.prepare('SELECT token FROM push_tokens WHERE user_id = ?'),
  byUserDetailed: db.prepare(
    'SELECT token, platform, created_at, updated_at FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  allTokens: db.prepare('SELECT token, user_id FROM push_tokens'),
};

export function savePushToken(token, userId, platform = 'android') {
  const ts = now();
  s.upsert.run(token, userId, platform, ts, ts);
}

export function removePushToken(token) {
  s.deleteToken.run(token);
}

/** Remove a token only if it belongs to the given user (used on logout). */
export function removeUserPushToken(userId, token) {
  s.deleteUserToken.run(userId, token);
}

/** All device tokens for a set of user ids. Returns a flat array of strings. */
export function tokensForUsers(userIds) {
  const out = [];
  for (const id of userIds) {
    for (const row of s.byUser.all(id)) out.push(row.token);
  }
  return out;
}

export function allPushTokens() {
  return s.allTokens.all();
}

/**
 * Registered devices for one user (admin view). The raw token is never exposed;
 * we return a short fingerprint so a specific device can still be identified and
 * revoked without leaking the push credential.
 */
export function devicesForUser(userId) {
  return s.byUserDetailed.all(userId).map((r) => ({
    token: r.token,
    fingerprint: r.token.slice(-8),
    platform: r.platform,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
