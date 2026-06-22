import { db, now } from './db.js';
import { uid } from './repo.js';

// Code snippets (0.35.0). Sharing code creates a normal message (type='code');
// the snippet payload lives here and is surfaced via codeView() in
// messageView.code, so realtime/offline plumbing carries it for free.
//
// We deliberately keep the source *out* of messages.body — the body stays a
// short teaser ("```js · 14 Zeilen") so push previews and the chat list don't
// dump a wall of code. The full text travels only inside messageView.code.

const s = {
  insert: db.prepare(`
    INSERT INTO message_code
      (id, message_id, chat_id, author_id, language, filename, code, created_at)
    VALUES
      (@id, @messageId, @chatId, @authorId, @language, @filename, @code, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM message_code WHERE message_id = ?'),
  byId: db.prepare('SELECT * FROM message_code WHERE id = ?'),
};

/** Create the snippet row backing a freshly-created 'code' message. */
export function createCodeSnippet({
  messageId,
  chatId,
  authorId,
  language = '',
  filename = '',
  code,
}) {
  const id = uid();
  s.insert.run({
    id,
    messageId,
    chatId,
    authorId,
    language: (language || '').toLowerCase(),
    filename: filename || '',
    code,
    createdAt: now(),
  });
  return s.byId.get(id);
}

/** A short, push-safe teaser for the timeline body / notification preview. */
export function codeTeaser({ language = '', filename = '', code = '' }) {
  const lines = code ? code.split('\n').length : 0;
  const label = filename || (language ? language : 'Code');
  return `‹/› ${label} · ${lines} ${lines === 1 ? 'Zeile' : 'Zeilen'}`;
}

/** The snippet as the timeline shows it. */
export function codeView(messageId) {
  const row = s.byMessage.get(messageId);
  if (!row) return null;
  return {
    id: row.id,
    language: row.language || '',
    filename: row.filename || '',
    code: row.code,
    lines: row.code ? row.code.split('\n').length : 0,
  };
}
