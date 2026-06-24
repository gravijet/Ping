import { db, now, safeJson } from './db.js';
import { uid } from './repo.js';

// Storage for "send later" messages. They live here until their send_at passes,
// at which point the maintenance sweep delivers them as real chat messages.

const s = {
  insert: db.prepare(`
    INSERT INTO scheduled_messages
      (id, chat_id, sender_id, type, body, attachment, reply_to, send_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM scheduled_messages WHERE id = ?'),
  forUserChat: db.prepare(`
    SELECT * FROM scheduled_messages
    WHERE chat_id = ? AND sender_id = ? ORDER BY send_at ASC`),
  due: db.prepare('SELECT * FROM scheduled_messages WHERE send_at <= ? ORDER BY send_at ASC'),
  del: db.prepare('DELETE FROM scheduled_messages WHERE id = ?'),
};

export function createScheduled({
  chatId,
  senderId,
  type = 'text',
  body = '',
  attachment = null,
  replyTo = null,
  sendAt,
}) {
  const id = uid();
  s.insert.run(
    id,
    chatId,
    senderId,
    type,
    body,
    attachment ? JSON.stringify(attachment) : null,
    replyTo,
    sendAt,
    now()
  );
  return s.byId.get(id);
}

export const getScheduled = (id) => s.byId.get(id);
export const listScheduled = (chatId, senderId) => s.forUserChat.all(chatId, senderId);
export const dueScheduled = (ts = now()) => s.due.all(ts);
export const deleteScheduled = (id) => s.del.run(id);

export function scheduledView(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    type: row.type,
    body: row.body,
    attachment: safeJson(row.attachment, null),
    replyTo: row.reply_to,
    sendAt: row.send_at,
    createdAt: row.created_at,
  };
}
