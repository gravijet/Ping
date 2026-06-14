import { db, now } from './db.js';
import { uid, publicUser, getUserById } from './repo.js';

// Call history. Each side of a call writes its own row (own direction/outcome),
// keyed by (user_id, call_id) so a client that re-posts the same call just
// updates the existing entry rather than duplicating it.

const stmts = {
  upsert: db.prepare(`
    INSERT INTO calls (id, call_id, user_id, peer_id, direction, video, outcome, duration, created_at)
    VALUES (@id, @callId, @userId, @peerId, @direction, @video, @outcome, @duration, @createdAt)
    ON CONFLICT(user_id, call_id) DO UPDATE SET
      outcome = excluded.outcome,
      duration = excluded.duration,
      video = excluded.video,
      created_at = excluded.created_at
  `),
  list: db.prepare(
    'SELECT * FROM calls WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ),
  byId: db.prepare('SELECT * FROM calls WHERE id = ? AND user_id = ?'),
  del: db.prepare('DELETE FROM calls WHERE id = ? AND user_id = ?'),
  clear: db.prepare('DELETE FROM calls WHERE user_id = ?'),
};

/** Insert or update one participant's record of a call. Returns the row. */
export function recordCall({ userId, peerId, callId, direction, video, outcome, duration }) {
  const id = uid();
  stmts.upsert.run({
    id,
    callId,
    userId,
    peerId,
    direction,
    video: video ? 1 : 0,
    outcome,
    duration: Math.max(0, Math.round(duration || 0)),
    createdAt: now(),
  });
  // The conflict path keeps the original id, so read the canonical row back.
  return db
    .prepare('SELECT * FROM calls WHERE user_id = ? AND call_id = ?')
    .get(userId, callId);
}

export function listCalls(userId, limit = 200) {
  return stmts.list.all(userId, limit);
}

export function deleteCall(userId, id) {
  return stmts.del.run(id, userId).changes > 0;
}

export function clearCalls(userId) {
  return stmts.clear.run(userId).changes;
}

/** Serialise a call row for the client, embedding the peer's public profile. */
export function callView(row) {
  const peer = getUserById(row.peer_id);
  return {
    id: row.id,
    callId: row.call_id,
    direction: row.direction,
    video: !!row.video,
    outcome: row.outcome,
    duration: row.duration,
    createdAt: row.created_at,
    peer: peer ? publicUser(peer) : null,
  };
}
