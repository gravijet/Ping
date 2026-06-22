import { db, now } from './db.js';
import { uid, getUserById, publicUser } from './repo.js';

// Contact cards (0.35.0). Sharing a contact creates a normal message
// (type='contact'); the card payload lives here and is surfaced via
// contactCardView() in messageView.contact, so realtime/offline/search plumbing
// carries it for free — exactly the polls pattern.
//
// We snapshot the name/username/phone/colour at share time so the card always
// renders something sensible, but when contact_user_id points at a live account
// we prefer that account's *current* public profile (fresh avatar, renamed,
// new @handle) on view. Tapping the card then opens a chat with that user.

const s = {
  insert: db.prepare(`
    INSERT INTO message_contacts
      (id, message_id, chat_id, sharer_id, contact_user_id,
       display_name, username, phone, avatar_color, note, created_at)
    VALUES
      (@id, @messageId, @chatId, @sharerId, @contactUserId,
       @displayName, @username, @phone, @avatarColor, @note, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM message_contacts WHERE message_id = ?'),
  byId: db.prepare('SELECT * FROM message_contacts WHERE id = ?'),
};

/** Create the contact-card row backing a freshly-created 'contact' message. */
export function createContactCard({
  messageId,
  chatId,
  sharerId,
  contactUserId = null,
  displayName,
  username = '',
  phone = '',
  avatarColor = '',
  note = '',
}) {
  const id = uid();
  s.insert.run({
    id,
    messageId,
    chatId,
    sharerId,
    contactUserId: contactUserId || null,
    displayName,
    username: username || '',
    phone: phone || '',
    avatarColor: avatarColor || '',
    note: note || '',
    createdAt: now(),
  });
  return s.byId.get(id);
}

/** The card as the timeline shows it: snapshot, freshened from the live user. */
export function contactCardView(messageId) {
  const row = s.byMessage.get(messageId);
  if (!row) return null;
  const live = row.contact_user_id ? getUserById(row.contact_user_id) : null;
  const pub = live ? publicUser(live) : null;
  return {
    id: row.id,
    // The shared user's id, when they're a Ping account (drives "Chat starten").
    userId: row.contact_user_id || null,
    isUser: !!live,
    displayName: pub?.displayName || row.display_name,
    username: pub?.username || row.username || null,
    phone: row.phone || '',
    avatarColor: pub?.avatarColor || row.avatar_color || '#888',
    // So the card can render the *real* avatar image when there is one.
    hasAvatar: pub?.hasAvatar || false,
    avatarVersion: pub?.avatarVersion || 0,
    note: row.note || '',
  };
}
