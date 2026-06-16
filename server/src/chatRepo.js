import { db, now, tx } from './db.js';
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
  members: db.prepare('SELECT user_id, role, muted FROM chat_members WHERE chat_id = ?'),
  memberIds: db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?'),
  setMuted: db.prepare('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?'),
  setArchived: db.prepare(
    'UPDATE chat_members SET archived = ? WHERE chat_id = ? AND user_id = ?'
  ),
  memberFlags: db.prepare(
    'SELECT muted, archived FROM chat_members WHERE chat_id = ? AND user_id = ?'
  ),
  memberRole: db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  setChatMeta: db.prepare('UPDATE chats SET name = ?, description = ? WHERE id = ?'),
  setChatAvatarStmt: db.prepare(
    'UPDATE chats SET avatar_mime = ?, avatar_version = avatar_version + 1 WHERE id = ?'
  ),
  setChatLockedStmt: db.prepare('UPDATE chats SET locked = ? WHERE id = ?'),
  setChatExpireStmt: db.prepare('UPDATE chats SET expire_seconds = ? WHERE id = ?'),
  setInviteCodeStmt: db.prepare('UPDATE chats SET invite_code = ? WHERE id = ?'),
  chatByInviteCode: db.prepare('SELECT * FROM chats WHERE invite_code = ?'),
  userChats: db.prepare(`
    SELECT c.* FROM chats c
    JOIN chat_members m ON m.chat_id = c.id
    WHERE m.user_id = ?`),
  // The viewer's visible last message: not expired and not hidden for them.
  lastVisibleMessage: db.prepare(`
    SELECT * FROM messages m
    WHERE m.chat_id = ?
      AND (m.expires_at IS NULL OR m.expires_at > ?)
      AND NOT EXISTS (
        SELECT 1 FROM hidden_messages h
        WHERE h.message_id = m.id AND h.user_id = ?)
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1`),
  unreadCount: db.prepare(`
    SELECT COUNT(*) AS n FROM message_status
    WHERE chat_id = ? AND user_id = ? AND read_at IS NULL`),
};

export function directKey(a, b) {
  return [a, b].sort().join(':');
}

// True for the "note to self" chat — a direct chat whose only participant is the
// viewer. Detected via the direct_key (me:me) rather than "has no other member",
// so a normal 1:1 whose peer deleted their account is NOT mistaken for a self-chat.
export function isSelfChat(chat, viewerId) {
  return (
    chat.type === 'direct' && chat.direct_key === directKey(viewerId, viewerId)
  );
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
export const getMemberRole = (chatId, userId) =>
  s.memberRole.get(chatId, userId)?.role || null;

// Rename / re-describe a group. Unspecified fields keep their current value.
export function updateGroupMeta(chatId, { name, description }) {
  const c = s.chatById.get(chatId);
  if (!c) return null;
  s.setChatMeta.run(
    name ?? c.name,
    description ?? c.description ?? '',
    chatId
  );
  return s.chatById.get(chatId);
}

// Set/clear a group's uploaded picture; bumps avatar_version to bust caches.
export function setChatAvatar(chatId, mime) {
  s.setChatAvatarStmt.run(mime, chatId);
  return s.chatById.get(chatId);
}
// Mark a chat read-only (or not). Read-only chats reject member sends — used by
// the official "Ping Team" broadcast channel.
export function setChatLocked(chatId, locked) {
  s.setChatLockedStmt.run(locked ? 1 : 0, chatId);
  return s.chatById.get(chatId);
}
// Disappearing messages: new messages in this chat expire after [seconds]
// (0 turns the timer off). Existing messages keep their original lifetime.
export function setChatExpire(chatId, seconds) {
  s.setChatExpireStmt.run(seconds, chatId);
  return s.chatById.get(chatId);
}
export const setInviteCode = (chatId, code) => s.setInviteCodeStmt.run(code, chatId);
export const getChatByInviteCode = (code) =>
  code ? s.chatByInviteCode.get(code) : undefined;
export const getMembers = (chatId) => s.members.all(chatId);
export const getMemberIds = (chatId) => s.memberIds.all(chatId).map((r) => r.user_id);
export const addMember = (chatId, userId, role = 'member') =>
  s.addMember.run(chatId, userId, role, now());
export const removeMember = (chatId, userId) => s.removeMember.run(chatId, userId);
export const setMuted = (chatId, userId, muted) =>
  s.setMuted.run(muted ? 1 : 0, chatId, userId);
// Per-user archiving: the chat collapses into the "Archiviert" section on this
// user's device; other members are unaffected.
export const setArchived = (chatId, userId, archived) =>
  s.setArchived.run(archived ? 1 : 0, chatId, userId);
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

// ---- Admin: chat moderation ------------------------------------------------

// List chats for the admin portal with member + message counts and a readable
// title. Direct chats are titled from their two participants.
export function adminListChats(q = '', limit = 200) {
  const chats = db
    .prepare('SELECT * FROM chats ORDER BY created_at DESC LIMIT ?')
    .all(limit);
  const memberCount = db.prepare(
    'SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?'
  );
  const msgCount = db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?'
  );
  const lastAt = db.prepare(
    'SELECT MAX(created_at) AS t FROM messages WHERE chat_id = ?'
  );
  const memberNames = db.prepare(`
    SELECT u.display_name FROM chat_members m JOIN users u ON u.id = m.user_id
    WHERE m.chat_id = ? ORDER BY u.display_name LIMIT 4`);
  const needle = q.trim().toLowerCase();
  const rows = chats.map((c) => {
    const names = memberNames.all(c.id).map((r) => r.display_name);
    const title =
      c.type === 'group'
        ? c.name || 'Gruppe'
        : names.join(' · ') || 'Direkt-Chat';
    return {
      id: c.id,
      type: c.type,
      title,
      members: memberCount.get(c.id).n,
      messages: msgCount.get(c.id).n,
      lastActivity: lastAt.get(c.id).t || c.created_at,
      createdAt: c.created_at,
    };
  });
  return needle
    ? rows.filter((r) => r.title.toLowerCase().includes(needle))
    : rows;
}

export function adminDeleteChat(id) {
  // Messages, members and status rows all cascade off the chat row.
  return db.prepare('DELETE FROM chats WHERE id = ?').run(id).changes > 0;
}

// Recent messages of a chat for the admin moderation peek: newest first, with a
// short text/attachment preview and the sender's name.
export function adminChatMessages(chatId, limit = 40) {
  const rows = db
    .prepare(
      `SELECT m.*, u.display_name AS sender_name FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.chat_id = ? ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(chatId, Math.min(limit, 100));
  return rows.map((m) => {
    let preview = m.deleted_at ? '⌫ gelöscht' : (m.body || '');
    if (!preview && m.attachment) {
      try {
        const a = JSON.parse(m.attachment);
        preview = `[${a.kind || m.type}]`;
      } catch {
        preview = `[${m.type}]`;
      }
    }
    return {
      id: m.id,
      sender: m.sender_name || (m.type === 'system' ? 'System' : 'Unbekannt'),
      type: m.type,
      preview: preview.length > 200 ? preview.slice(0, 200) + '…' : preview,
      createdAt: m.created_at,
      deleted: !!m.deleted_at,
    };
  });
}

// Moderation: members of a chat with their role + online-irrelevant metadata,
// so the admin portal can show who is in a conversation it is reviewing.
export function adminChatMembers(chatId) {
  return db
    .prepare(
      `SELECT cm.user_id, cm.role, cm.joined_at,
              u.display_name AS name, u.phone, u.avatar_color
       FROM chat_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = ? ORDER BY cm.role DESC, u.display_name COLLATE NOCASE`
    )
    .all(chatId)
    .map((m) => ({
      id: m.user_id,
      name: m.name,
      phone: m.phone,
      avatarColor: m.avatar_color,
      role: m.role,
      joinedAt: m.joined_at,
    }));
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
    archived: false,
    // Read-only channel (official broadcasts): the client hides the composer.
    locked: !!chat.locked,
    // Disappearing-messages timer (seconds; 0 = off).
    expireSeconds: chat.expire_seconds || 0,
  };

  const flags = s.memberFlags.get(chat.id, viewerId);
  base.muted = !!(flags && flags.muted);
  base.archived = !!(flags && flags.archived);

  if (chat.type === 'direct') {
    if (isSelfChat(chat, viewerId)) {
      // "Note to self": render with the viewer's own identity; the client shows
      // a "Notiz an mich" label on top of this.
      const meU = publicUser(getUserById(viewerId));
      base.self = true;
      base.title = meU ? meU.displayName : 'Notiz an mich';
      base.avatarColor = meU ? meU.avatarColor : chat.avatar_color;
      base.otherUser = meU;
    } else {
      const otherId = memberIds.find((m) => m !== viewerId);
      const other = otherId ? publicUser(getUserById(otherId)) : null;
      base.self = false;
      base.title = other ? other.displayName : 'Unbekannt';
      base.avatarColor = other ? other.avatarColor : chat.avatar_color;
      base.otherUser = other;
    }
  } else {
    base.title = chat.name;
    base.avatarColor = chat.avatar_color;
    base.description = chat.description || '';
    base.hasAvatar = !!chat.avatar_mime;
    base.avatarVersion = chat.avatar_version || 0;
    base.members = memberIds.map((id) => publicUser(getUserById(id))).filter(Boolean);
    base.ownerId = memberRows.find((m) => m.role === 'owner')?.user_id || null;
  }

  const last = s.lastVisibleMessage.get(chat.id, now(), viewerId);
  base.lastMessage = last ? messageView(last, viewerId) : null;

  base.unread = s.unreadCount.get(chat.id, viewerId).n;

  base.updatedAt = last ? last.created_at : chat.created_at;
  return base;
}

// ---- Messages --------------------------------------------------------------

const m = {
  insert: db.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, type, body, attachment, reply_to, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM messages WHERE id = ?'),
  insertStatus: db.prepare(`
    INSERT OR IGNORE INTO message_status (message_id, user_id, chat_id)
    VALUES (?, ?, ?)`),
  // History as the viewer sees it: skip expired messages and ones the viewer
  // deleted "für mich".
  history: db.prepare(`
    SELECT * FROM messages m WHERE m.chat_id = ? AND m.created_at < ?
      AND (m.expires_at IS NULL OR m.expires_at > ?)
      AND NOT EXISTS (
        SELECT 1 FROM hidden_messages h
        WHERE h.message_id = m.id AND h.user_id = ?)
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`),
  edit: db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?'),
  softDelete: db.prepare(
    "UPDATE messages SET deleted_at = ?, body = '' WHERE id = ?"
  ),
  hide: db.prepare(`
    INSERT OR IGNORE INTO hidden_messages (message_id, user_id, created_at)
    VALUES (?, ?, ?)`),
  expired: db.prepare(
    'SELECT id, chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?'
  ),
};

export function createMessage({
  chatId,
  senderId,
  body = '',
  type = 'text',
  attachment = null,
  replyTo = null,
  expiresAt = null,
}) {
  const id = uid();
  const ts = now();
  const att = attachment ? JSON.stringify(attachment) : null;
  // One transaction: the message and its per-recipient receipt rows land
  // atomically (and as a single fsync instead of one per group member).
  tx(() => {
    m.insert.run(id, chatId, senderId, type, body, att, replyTo, ts, expiresAt);
    for (const memberId of getMemberIds(chatId)) {
      if (memberId !== senderId) m.insertStatus.run(id, memberId, chatId);
    }
  });
  return m.byId.get(id);
}

/// "Für mich löschen": hide [messageId] for [userId] only. The message keeps
/// existing for everyone else; this viewer's history/search/chat-list skip it.
export function hideMessageFor(messageId, userId) {
  m.hide.run(messageId, userId, now());
}

/// Drop every message whose disappearing-messages timer has run out. Returns
/// the removed { id, chat_id } rows so the caller can notify live clients.
export function purgeExpiredMessages() {
  const rows = m.expired.all(now());
  if (rows.length === 0) return [];
  tx(() => {
    for (const r of rows) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(r.id);
    }
  });
  return rows;
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

/// Hard-delete a message row (used by "nur lokal" storage: the server drops the
/// message once every recipient has read it). Replies referencing it keep
/// working via ON DELETE SET NULL on reply_to.
export function purgeMessage(id) {
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

// The hard ceiling exists so a single call can never drag the whole table into
// memory; the public history route additionally caps at 100 per page. The
// personal export passes a high limit on purpose (it really wants everything).
export function getHistory(chatId, { before, limit = 40, viewerId = '' } = {}) {
  const rows = m.history.all(
    chatId,
    before ?? Number.MAX_SAFE_INTEGER,
    now(),
    viewerId,
    Math.min(limit, 10000)
  );
  return rows.reverse();
}

// Full-history text search across every chat the user belongs to (newest
// first). Powers the global search on the home screen. The LIKE wildcards in
// the query itself are escaped so they're matched literally.
const searchStmt = db.prepare(`
  SELECT m.* FROM messages m
  JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
  WHERE m.deleted_at IS NULL
    AND m.type != 'system'
    AND (m.expires_at IS NULL OR m.expires_at > ?)
    AND NOT EXISTS (
      SELECT 1 FROM hidden_messages h
      WHERE h.message_id = m.id AND h.user_id = ?)
    AND m.body LIKE ? ESCAPE '\\'
  ORDER BY m.created_at DESC
  LIMIT ?`);

export function searchMessages(userId, q, limit = 30) {
  const needle = (q || '').trim();
  if (needle.length < 2) return [];
  const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
  return searchStmt.all(userId, now(), userId, like, Math.min(limit, 50));
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
  tx(() => {
    for (const p of pending) upd.run(ts, ts, p.message_id, userId);
  });
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
  tx(() => {
    for (const p of pending) upd.run(ts, p.message_id, userId);
  });
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

// Per-recipient delivery/read timestamps for one message — powers the "message
// info" sheet (who has received and read it, and when). Sorted read-first.
export function messageReceipts(messageId) {
  return db
    .prepare(
      `SELECT user_id, delivered_at, read_at FROM message_status
       WHERE message_id = ?
       ORDER BY read_at IS NULL, read_at DESC, delivered_at DESC`
    )
    .all(messageId);
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

// Toggle an emoji reaction by [userId] on [messageId]: adds it if absent, removes
// it if present. Returns { added, reactions } where reactions is { emoji: count }.
export function toggleReaction(messageId, userId, emoji) {
  const existing = db
    .prepare(
      'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    )
    .get(messageId, userId, emoji);
  if (existing) {
    db.prepare(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    ).run(messageId, userId, emoji);
    return { added: false, reactions: reactionCounts(messageId) };
  }
  db.prepare(
    'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
  ).run(messageId, userId, emoji, now());
  return { added: true, reactions: reactionCounts(messageId) };
}

function reactionCounts(messageId) {
  const rows = db
    .prepare(
      'SELECT emoji, COUNT(*) AS n FROM message_reactions WHERE message_id = ? GROUP BY emoji ORDER BY n DESC'
    )
    .all(messageId);
  const out = {};
  for (const r of rows) out[r.emoji] = r.n;
  return out;
}

function myReactions(messageId, viewerId) {
  return db
    .prepare(
      'SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?'
    )
    .all(messageId, viewerId)
    .map((r) => r.emoji);
}

// ---- Polls -------------------------------------------------------------------

const p = {
  insert: db.prepare(`
    INSERT INTO polls (id, message_id, chat_id, question, options, multi, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  byMessage: db.prepare('SELECT * FROM polls WHERE message_id = ?'),
  votes: db.prepare(
    'SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_index'
  ),
  myVotes: db.prepare(
    'SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?'
  ),
  voters: db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?'
  ),
  addVote: db.prepare(`
    INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_index, created_at)
    VALUES (?, ?, ?, ?)`),
  delVote: db.prepare(
    'DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?'
  ),
  clearVotes: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
};

/// Create the poll row backing a freshly-created 'poll' message.
export function createPoll({ messageId, chatId, question, options, multi = false }) {
  const id = uid();
  p.insert.run(id, messageId, chatId, question, JSON.stringify(options), multi ? 1 : 0, now());
  return p.byMessage.get(messageId);
}

export const getPollByMessage = (messageId) => p.byMessage.get(messageId);

/// Toggle a vote for [optionIndex]. Single-choice polls move the vote (any
/// previous pick is cleared); multi-choice polls toggle each option on/off.
/// Returns false when the option index is out of range.
export function votePoll(messageId, userId, optionIndex) {
  const poll = p.byMessage.get(messageId);
  if (!poll) return false;
  const options = JSON.parse(poll.options);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    return false;
  }
  const mine = p.myVotes.all(poll.id, userId).map((r) => r.option_index);
  tx(() => {
    if (mine.includes(optionIndex)) {
      p.delVote.run(poll.id, userId, optionIndex);
    } else {
      if (!poll.multi) p.clearVotes.run(poll.id, userId);
      p.addVote.run(poll.id, userId, optionIndex, now());
    }
  });
  return true;
}

/// The poll as one viewer sees it: option texts + counts, their own picks and
/// how many people voted overall.
export function pollView(messageId, viewerId) {
  const poll = p.byMessage.get(messageId);
  if (!poll) return null;
  const texts = JSON.parse(poll.options);
  const counts = new Map(p.votes.all(poll.id).map((r) => [r.option_index, r.n]));
  return {
    question: poll.question,
    multi: !!poll.multi,
    options: texts.map((text, i) => ({ text, votes: counts.get(i) || 0 })),
    myVotes: p.myVotes.all(poll.id, viewerId).map((r) => r.option_index),
    totalVoters: p.voters.get(poll.id).n,
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
    // Disappearing messages: when the client should drop this bubble.
    expiresAt: msg.expires_at || null,
    // Only the author cares about the receipt ticks on their own bubble.
    status: msg.sender_id === viewerId ? receiptState(msg.id) : null,
    // Emoji reactions: global counts + the viewer's own picks (for highlighting).
    reactions: msg.deleted_at ? {} : reactionCounts(msg.id),
    myReactions: msg.deleted_at ? [] : myReactions(msg.id, viewerId),
    // Poll payload (question/options/votes) for 'poll' messages.
    poll: msg.type === 'poll' && !msg.deleted_at ? pollView(msg.id, viewerId) : null,
  };
}
