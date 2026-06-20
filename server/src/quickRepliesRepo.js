import { db, now } from './db.js';
import { uid } from './repo.js';

// Per-user "quick replies" (canned responses): a small reorderable library of
// reusable text snippets the composer can insert with one tap. Each may carry a
// short "/shortcut" the client can autocomplete. Purely additive and private to
// the owner — no fan-out, no chat coupling.

const s = {
  insert: db.prepare(`
    INSERT INTO quick_replies (id, user_id, shortcut, text, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM quick_replies WHERE id = ?'),
  forUser: db.prepare('SELECT * FROM quick_replies WHERE user_id = ? ORDER BY sort ASC, created_at ASC'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM quick_replies WHERE user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM quick_replies WHERE user_id = ?'),
  update: db.prepare(
    'UPDATE quick_replies SET shortcut = ?, text = ?, sort = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ),
  del: db.prepare('DELETE FROM quick_replies WHERE id = ? AND user_id = ?'),
};

export const countQuickReplies = (userId) => s.count.get(userId)?.n || 0;

export function createQuickReply({ userId, shortcut = '', text }) {
  const id = uid();
  const sort = (s.maxSort.get(userId)?.m ?? -1) + 1;
  const t = now();
  s.insert.run(id, userId, shortcut.trim(), text, sort, t, t);
  return s.byId.get(id);
}

export const listQuickReplies = (userId) => s.forUser.all(userId);
export const getQuickReply = (id) => s.byId.get(id);

/** Patch a quick reply the caller owns. Returns the updated row or null. */
export function updateQuickReply(id, userId, { shortcut, text, sort }) {
  const cur = s.byId.get(id);
  if (!cur || cur.user_id !== userId) return null;
  const next = {
    shortcut: shortcut !== undefined ? shortcut.trim() : cur.shortcut,
    text: text !== undefined ? text : cur.text,
    sort: sort !== undefined ? sort : cur.sort,
  };
  s.update.run(next.shortcut, next.text, next.sort, now(), id, userId);
  return s.byId.get(id);
}

export const deleteQuickReply = (id, userId) => s.del.run(id, userId).changes > 0;

export function quickReplyView(row) {
  return {
    id: row.id,
    shortcut: row.shortcut || '',
    text: row.text,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
