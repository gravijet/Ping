import { db, now } from './db.js';

// Storage for W3C Push API subscriptions (the web counterpart of pushRepo's FCM
// device tokens). One row per push endpoint; a user may have several browsers.

const s = {
  upsert: db.prepare(`
    INSERT INTO web_push_subscriptions (endpoint, user_id, p256dh, auth, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = excluded.updated_at
  `),
  deleteByEndpoint: db.prepare('DELETE FROM web_push_subscriptions WHERE endpoint = ?'),
  deleteUserEndpoint: db.prepare(
    'DELETE FROM web_push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ),
  byUser: db.prepare(
    'SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = ?'
  ),
  countByUser: db.prepare(
    'SELECT COUNT(*) AS n FROM web_push_subscriptions WHERE user_id = ?'
  ),
};

export function saveWebPushSubscription(userId, { endpoint, p256dh, auth }) {
  const ts = now();
  s.upsert.run(endpoint, userId, p256dh, auth, ts, ts);
}

export function removeWebPushSubscription(endpoint) {
  s.deleteByEndpoint.run(endpoint);
}

/** Remove a subscription only if it belongs to the given user (logout/opt-out). */
export function removeUserWebPushSubscription(userId, endpoint) {
  s.deleteUserEndpoint.run(userId, endpoint);
}

/** Every web subscription for a set of users, as a flat array of {endpoint,p256dh,auth}. */
export function webSubscriptionsForUsers(userIds) {
  const out = [];
  for (const id of userIds) {
    for (const row of s.byUser.all(id)) out.push(row);
  }
  return out;
}

export function webPushCountForUser(userId) {
  return s.countByUser.get(userId)?.n || 0;
}
