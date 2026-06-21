import { db, now } from './db.js';
import { uid } from './repo.js';

// Collaborative group notes / wiki (0.34.0). Any chat member can create and edit
// notes; the latest editor + time are tracked. Notes are surfaced in the chat's
// info panel and changes are broadcast as 'note-updated' / 'note-deleted'.

const s = {
  insert: db.prepare(`
    INSERT INTO chat_notes (id, chat_id, title, body, updated_by, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM chat_notes WHERE id = ?'),
  forChat: db.prepare('SELECT * FROM chat_notes WHERE chat_id = ? ORDER BY updated_at DESC'),
  update: db.prepare(
    'UPDATE chat_notes SET title = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?'
  ),
  del: db.prepare('DELETE FROM chat_notes WHERE id = ?'),
};

export function createNote({ chatId, title, body = '', userId }) {
  const id = uid();
  const ts = now();
  s.insert.run(id, chatId, title, body, userId, ts, ts);
  return s.byId.get(id);
}

export const getNote = (id) => s.byId.get(id);

export function updateNote(id, { title, body, userId }) {
  const note = s.byId.get(id);
  if (!note) return null;
  s.update.run(
    title === undefined ? note.title : title,
    body === undefined ? note.body : body,
    userId,
    now(),
    id
  );
  return s.byId.get(id);
}

export const deleteNote = (id) => s.del.run(id);

const noteView = (n) => ({
  id: n.id,
  title: n.title,
  body: n.body || '',
  updatedBy: n.updated_by || null,
  updatedAt: n.updated_at,
  createdAt: n.created_at,
});

export const listNotes = (chatId) => s.forChat.all(chatId).map(noteView);
export const viewNote = (n) => noteView(n);
