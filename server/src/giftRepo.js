import { db, now } from './db.js';
import { uid } from './repo.js';

// Virtual gift (type='gift'): a fun, animated gift sent into a chat (cake, heart,
// trophy, flower, star, gift, balloon, rocket). Rendered as a celebratory card;
// the client plays a one-shot animation, reusing the send-effect machinery.

export const GIFT_KINDS = ['cake', 'heart', 'trophy', 'flower', 'star', 'gift', 'balloon', 'rocket'];

const s = {
  insert: db.prepare(`
    INSERT INTO gifts (id, message_id, chat_id, sender_id, kind, note, created_at)
    VALUES (@id, @messageId, @chatId, @senderId, @kind, @note, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM gifts WHERE message_id = ?'),
};

export function createGift({ messageId, chatId, senderId, kind, note = '' }) {
  s.insert.run({ id: uid(), messageId, chatId, senderId, kind, note: note || '', createdAt: now() });
  return s.byMessage.get(messageId);
}

export function giftView(messageId) {
  const g = s.byMessage.get(messageId);
  if (!g) return null;
  return { id: g.id, kind: g.kind, note: g.note || '', senderId: g.sender_id };
}
