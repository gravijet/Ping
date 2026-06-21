import { db, now } from './db.js';

// Live location (0.34.0). A "livelocation" message is a normal message that acts
// as the card in the conversation; the *current* position lives in one row per
// (user, chat) in live_locations and is updated in place as the sender moves.
// messageView.liveLocation surfaces that row so the card updates live; when the
// share ends or its expires_at passes, the row is gone and the card reads as
// ended. Position updates are broadcast as a lightweight 'location-update'.

const s = {
  upsert: db.prepare(`
    INSERT INTO live_locations (user_id, chat_id, lat, lng, accuracy, heading, updated_at, expires_at)
    VALUES (@userId, @chatId, @lat, @lng, @accuracy, @heading, @updatedAt, @expiresAt)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET
      lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
      heading = excluded.heading, updated_at = excluded.updated_at,
      expires_at = excluded.expires_at`),
  get: db.prepare('SELECT * FROM live_locations WHERE user_id = ? AND chat_id = ?'),
  // Move an *active* share without touching its expiry.
  updatePos: db.prepare(`
    UPDATE live_locations SET lat = ?, lng = ?, accuracy = ?, heading = ?, updated_at = ?
     WHERE user_id = ? AND chat_id = ? AND expires_at > ?`),
  stop: db.prepare('DELETE FROM live_locations WHERE user_id = ? AND chat_id = ?'),
  expired: db.prepare('SELECT user_id, chat_id FROM live_locations WHERE expires_at <= ?'),
  purge: db.prepare('DELETE FROM live_locations WHERE expires_at <= ?'),
};

/** Start or refresh a (user, chat) live-location share. */
export function setLiveLocation({ userId, chatId, lat, lng, accuracy = null, heading = null, durationMs }) {
  const ts = now();
  s.upsert.run({
    userId, chatId, lat, lng, accuracy, heading,
    updatedAt: ts,
    expiresAt: ts + Math.max(60_000, Math.min(durationMs || 3_600_000, 8 * 3_600_000)),
  });
  return s.get.get(userId, chatId);
}

/** Update an active share's position. Returns the row, or null if none active. */
export function updateLiveLocation({ userId, chatId, lat, lng, accuracy = null, heading = null }) {
  const r = s.updatePos.run(lat, lng, accuracy, heading, now(), userId, chatId, now());
  return r.changes > 0 ? s.get.get(userId, chatId) : null;
}

export function stopLiveLocation(userId, chatId) {
  s.stop.run(userId, chatId);
}

/** The live-location payload for a 'livelocation' message (from its msg row). */
export function liveLocationView(msg) {
  const row = s.get.get(msg.sender_id, msg.chat_id);
  if (!row || row.expires_at <= now()) {
    return { active: false, updatedAt: row?.updated_at || null };
  }
  return {
    active: true,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    heading: row.heading,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/** Sweep: rows whose share has expired (for the maintenance pass to notify + purge). */
export function dueExpiredLiveLocations(ts = now()) {
  return s.expired.all(ts);
}
export function purgeExpiredLiveLocations(ts = now()) {
  s.purge.run(ts);
}
