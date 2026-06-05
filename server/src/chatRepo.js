import { db, now } from './db.js';
import { uid, pickAvatarColor, getUserById, publicUser } from './repo.js';

const s = {
  insertChat: db.prepare(`
    INSERT INTO chats (id, type, name, avatar_color, created_by, created_at, direct_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  chatById: db.prepare('SELECT * FROM chats WHERE id = ?'),
  chatByDirectKey: db.prepare('SELECT * FROM chats WHERE direct_key = ?'),
  addMember: db.prepare(`
    INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at)
    VALUES (?, ?, ?, ?)`),
  removeMember: db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  isMember: db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  members: db.prepare('SELECT user_id, role FROM chat_members WHERE chat_id = ?'),
  memberIds: db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?'),
  setMuted: db.prepare('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?'),
  userChats: db.prepare(`
    SELECT c.* FROM chats c
    JOIN chat_members m ON m.chat_id = c.id
    WHERE m.user_id = ?`),
};

export function directKey(a, b) {
  return [a, b].sort().join(':');
}

// Returns the existing direct chat for a pair, or creates it. Idempotent.
export function getOrCreateDirectChat(userA, userB) {
  const key = directKey(userA, userB);
  let chat = s.chatByDirectKey.get(key);
  if (chat) return chat;
  const id = uid();
  const ts = now();
  try {
    s.insertChat.run(id, 'direct', null, pickAvatarColor(key), userA, ts, key);
  } catch (e) {
    // Lost a race against a concurrent create — fall back to the existing row.
    const existing = s.chatByDirectKey.get(key);
    if (existing) return existing;
    throw e;
  }
  s.addMember.run(id, userA, 'member', ts);
  s.addMember.run(id, userB, 'member', ts);
  return s.chatById.get(id);
}

export function createGroupChat({ name, ownerId, memberIds = [] }) {
  const id = uid();
  const ts = now();
  s.insertChat.run(id, 'group', name, pickAvatarColor(id), ownerId, ts, null);
  s.addMember.run(id, ownerId, 'owner', ts);
  for (const m of memberIds) {
    if (m !== ownerId && getUserById(m)) s.addMember.run(id, m, 'member', ts);
  }
  return s.chatById.get(id);
}

export const getChat = (id) => s.chatById.get(id);
export const isMember = (chatId, userId) => !!s.isMember.get(chatId, userId);
export const getMembers = (chatId) => s.members.all(chatId);
export const getMemberIds = (chatId) => s.memberIds.all(chatId).map((r) => r.user_id);
export const addMember = (chatId, userId, role = 'member') =>
  s.addMember.run(chatId, userId, role, now());
export const removeMember = (chatId, userId) => s.removeMember.run(chatId, userId);
export const setMuted = (chatId, userId, muted) =>
  s.setMuted.run(muted ? 1 : 0, chatId, userId);
export const getUserChats = (userId) => s.userChats.all(userId);

// Everyone who shares at least one chat with this user (their "contacts" in the
// social-graph sense). Used for status visibility and presence fan-out.
export function getPeerIds(userId) {
  const peers = new Set();
  for (const chat of s.userChats.all(userId)) {
    for (const row of s.members.all(chat.id)) {
      if (row.user_id !== userId) peers.add(row.user_id);
    }
  }
  return [...peers];
}

// Before a user row can be removed, the chats they created must stop pointing at
// them (chats.created_by has no ON DELETE rule, so the foreign key would block
// the delete). Hand each such chat to another current member; if nobody is left,
// drop the chat entirely (its messages cascade away).
const created = {
  byCreator: db.prepare('SELECT id FROM chats WHERE created_by = ?'),
  otherMember: db.prepare(
    'SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ? LIMIT 1'
  ),
  reassign: db.prepare('UPDATE chats SET created_by = ? WHERE id = ?'),
  drop: db.prepare('DELETE FROM chats WHERE id = ?'),
};

export function detachCreatedChats(userId) {
  for (const { id } of created.byCreator.all(userId)) {
    const other = created.otherMember.get(id, userId);
    if (other) {
      created.reassign.run(other.user_id, id);
    } else {
      created.drop.run(id);
    }
  }
}

// Build the rich chat view the client renders in the list: title, avatar,
// last message, unread count and (for direct chats) the other participant.
export function chatView(chat, viewerId) {
  const memberRows = s.members.all(chat.id);
  const memberIds = memberRows.map((m) => m.user_id);
  const base = {
    id: chat.id,
    type: chat.type,
    createdAt: chat.created_at,
    memberIds,
    muted: false,
  };

  const muteRow = db
    .prepare('SELECT muted FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chat.id, viewerId);
  base.muted = !!(muteRow && muteRow.muted);

  if (chat.type === 'direct') {
    const otherId = memberIds.find((m) => m !== viewerId);
    const other = otherId ? publicUser(getUserById(otherId)) : null;
    base.title = other ? other.displayName : 'Unbekannt';
    base.avatarColor = other ? other.avatarColor : chat.avatar_color;
    base.otherUser = other;
  } else {
    base.title = chat.name;
    base.avatarColor = chat.avatar_color;
    base.members = memberIds.map((id) => publicUser(getUserById(id))).filter(Boolean);
    base.ownerId = memberRows.find((m) => m.role === 'owner')?.user_id || null;
  }

  const last = db
    .prepare(
      `SELECT * FROM messages WHERE chat_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(chat.id);
  base.lastMessage = last ? messageView(last, viewerId) : null;

  base.unread = db
    .prepare(
      `SELECT COUNT(*) AS n FROM message_status
       WHERE chat_id = ? AND user_id = ? AND read_at IS NULL`
    )
    .get(chat.id, viewerId).n;

  base.updatedAt = last ? last.created_at : chat.created_at;
  return base;
}

// ---- Messages --------------------------------------------------------------

const m = {
  insert: db.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, type, body, attachment, reply_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM messages WHERE id = ?'),
  insertStatus: db.prepare(`
    INSERT OR IGNORE INTO message_status (message_id, user_id, chat_id)
    VALUES (?, ?, ?)`),
  history: db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? AND created_at < ?
    ORDER BY created_at DESC, id DESC LIMIT ?`),
  edit: db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?'),
  softDelete: db.prepare(
    "UPDATE messages SET deleted_at = ?, body = '' WHERE id = ?"
  ),
};

export function createMessage({
  chatId,
  senderId,
  body = '',
  type = 'text',
  attachment = null,
  replyTo = null,
}) {
  const id = uid();
  const ts = now();
  const att = attachment ? JSON.stringify(attachment) : null;
  m.insert.run(id, chatId, senderId, type, body, att, replyTo, ts);
  // Seed a status row for every recipient (everyone but the sender).
  for (const memberId of getMemberIds(chatId)) {
    if (memberId !== senderId) m.insertStatus.run(id, memberId, chatId);
  }
  return m.byId.get(id);
}

export const getMessage = (id) => m.byId.get(id);

export function editMessage(id, body) {
  m.edit.run(body, now(), id);
  return m.byId.get(id);
}

export function deleteMessage(id) {
  m.softDelete.run(now(), id);
  return m.byId.get(id);
}

export function getHistory(chatId, { before, limit = 40 } = {}) {
  const rows = m.history.all(chatId, before ?? Number.MAX_SAFE_INTEGER, Math.min(limit, 100));
  return rows.reverse();
}

// Mark every unread message in a chat (from others) as read for this viewer.
// Returns the messages that flipped to read, grouped by their sender so we can
// notify each author about their own receipts.
export function markChatRead(chatId, userId) {
  const ts = now();
  const pending = db
    .prepare(
      `SELECT ms.message_id, msg.sender_id
       FROM message_status ms JOIN messages msg ON msg.id = ms.message_id
       WHERE ms.chat_id = ? AND ms.user_id = ? AND ms.read_at IS NULL`
    )
    .all(chatId, userId);
  const upd = db.prepare(
    'UPDATE message_status SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE message_id = ? AND user_id = ?'
  );
  for (const p of pending) upd.run(ts, ts, p.message_id, userId);
  return { ts, messageIds: pending.map((p) => p.message_id), senders: pending };
}

export function markDelivered(chatId, userId) {
  const ts = now();
  const pending = db
    .prepare(
      `SELECT ms.message_id, msg.sender_id FROM message_status ms
       JOIN messages msg ON msg.id = ms.message_id
       WHERE ms.chat_id = ? AND ms.user_id = ? AND ms.delivered_at IS NULL`
    )
    .all(chatId, userId);
  const upd = db.prepare(
    'UPDATE message_status SET delivered_at = ? WHERE message_id = ? AND user_id = ?'
  );
  for (const p of pending) upd.run(ts, p.message_id, userId);
  return { ts, senders: pending };
}

// Aggregate receipt state for a message across all recipients. For direct
// chats this is just the single recipient; for groups it's "all delivered" /
// "all read".
export function receiptState(messageId) {
  const rows = db
    .prepare('SELECT delivered_at, read_at FROM message_status WHERE message_id = ?')
    .all(messageId);
  if (rows.length === 0) return 'sent';
  if (rows.every((r) => r.read_at)) return 'read';
  if (rows.every((r) => r.delivered_at)) return 'delivered';
  return 'sent';
}

// A compact snapshot of a quoted (replied-to) message so the client can always
// render the reply preview — even when the original is outside the loaded
// window or was sent long ago. The body is trimmed; deleted originals are blank.
export function quotedView(replyToId) {
  const o = replyToId ? m.byId.get(replyToId) : null;
  if (!o) return null;
  const text = o.deleted_at ? '' : o.body;
  return {
    id: o.id,
    senderId: o.sender_id,
    type: o.type,
    deleted: !!o.deleted_at,
    body: text.length > 160 ? `${text.slice(0, 160)}…` : text,
  };
}

export function messageView(msg, viewerId) {
  return {
    id: msg.id,
    chatId: msg.chat_id,
    senderId: msg.sender_id,
    type: msg.type,
    body: msg.deleted_at ? '' : msg.body,
    attachment:
      msg.deleted_at || !msg.attachment ? null : JSON.parse(msg.attachment),
    replyTo: msg.reply_to,
    // Inline snapshot of the quoted message (null when this isn't a reply).
    quoted: msg.reply_to ? quotedView(msg.reply_to) : null,
    createdAt: msg.created_at,
    editedAt: msg.edited_at,
    deleted: !!msg.deleted_at,
    // Only the author cares about the receipt ticks on their own bubble.
    status: msg.sender_id === viewerId ? receiptState(msg.id) : null,
  };
}
