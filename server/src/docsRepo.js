import { db, now } from './db.js';
import { uid } from './repo.js';

// Collaborative doc (type='doc'): a shared mini-document anyone in the chat can
// edit. Last-write-wins with a monotonic `version`; the client passes the version
// it edited so a stale save is rejected (409) rather than silently clobbering.

const s = {
  insert: db.prepare(`
    INSERT INTO docs (id, message_id, chat_id, creator_id, title, body, version, updated_by, created_at, updated_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @body, 1, @creatorId, @createdAt, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM docs WHERE message_id = ?'),
  update: db.prepare(`
    UPDATE docs SET title = @title, body = @body, version = version + 1,
                    updated_by = @userId, updated_at = @ts
     WHERE message_id = @messageId`),
};

export function createDoc({ messageId, chatId, creatorId, title = '', body = '' }) {
  s.insert.run({ id: uid(), messageId, chatId, creatorId, title: title || '', body: body || '', createdAt: now() });
  return s.byMessage.get(messageId);
}

/**
 * Save a new title/body. `baseVersion` (if given) must match the current version
 * or the save is rejected as stale. Returns the new view, or null (missing) or
 * 'stale'.
 */
export function updateDoc(messageId, { title, body, userId, baseVersion = null }) {
  const doc = s.byMessage.get(messageId);
  if (!doc) return null;
  if (baseVersion != null && baseVersion !== doc.version) return 'stale';
  s.update.run({
    messageId,
    title: title ?? doc.title,
    body: body ?? doc.body,
    userId,
    ts: now(),
  });
  return docView(messageId);
}

export function docView(messageId) {
  const doc = s.byMessage.get(messageId);
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title || '',
    body: doc.body || '',
    version: doc.version,
    creatorId: doc.creator_id,
    updatedBy: doc.updated_by,
    updatedAt: doc.updated_at,
  };
}
