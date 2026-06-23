import { db, now } from './db.js';
import { uid } from './repo.js';

// Whiteboard (type='whiteboard'): a collaborative drawing canvas backed by a
// normal message. Strokes are stored as one JSON array; new strokes append live
// over the socket ('whiteboard-stroke') and are persisted here so a late joiner
// (or reload) replays the full picture. A stroke is { color, width, points:[...] }.

const MAX_STROKES = 4000;

const s = {
  insert: db.prepare(`
    INSERT INTO whiteboards (id, message_id, chat_id, creator_id, title, strokes, created_at, updated_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @strokes, @createdAt, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM whiteboards WHERE message_id = ?'),
  setStrokes: db.prepare('UPDATE whiteboards SET strokes = ?, updated_at = ? WHERE message_id = ?'),
};

export function createWhiteboard({ messageId, chatId, creatorId, title = '', strokes = [] }) {
  const id = uid();
  s.insert.run({
    id,
    messageId,
    chatId,
    creatorId,
    title: title || '',
    strokes: JSON.stringify(Array.isArray(strokes) ? strokes.slice(0, MAX_STROKES) : []),
    createdAt: now(),
  });
  return s.byMessage.get(messageId);
}

/** Append one stroke. Returns false if the board is missing or already full. */
export function addStroke(messageId, stroke) {
  const wb = s.byMessage.get(messageId);
  if (!wb) return false;
  const strokes = JSON.parse(wb.strokes);
  if (strokes.length >= MAX_STROKES) return false;
  strokes.push(stroke);
  s.setStrokes.run(JSON.stringify(strokes), now(), messageId);
  return true;
}

/** Wipe the canvas (creator-only check is enforced in the route). */
export function clearWhiteboard(messageId) {
  if (!s.byMessage.get(messageId)) return false;
  s.setStrokes.run('[]', now(), messageId);
  return true;
}

export function whiteboardView(messageId) {
  const wb = s.byMessage.get(messageId);
  if (!wb) return null;
  return {
    id: wb.id,
    title: wb.title || '',
    creatorId: wb.creator_id,
    strokes: JSON.parse(wb.strokes),
    updatedAt: wb.updated_at,
  };
}
