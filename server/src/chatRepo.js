import { db, now, tx, ftsAvailable } from './db.js';
import { uid, pickAvatarColor, getUserById, publicUser } from './repo.js';
import { eventView } from './eventsRepo.js';
import { taskListView } from './tasksRepo.js';

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
  // ---- Channels / Communities (0.31.0) -----------------------------------
  insertChannel: db.prepare(`
    INSERT INTO chats (id, type, name, avatar_color, created_by, created_at,
                       visibility, handle, broadcast, category, description)
    VALUES (?, 'group', ?, ?, ?, ?, 'public', ?, 1, ?, ?)`),
  chatByHandle: db.prepare('SELECT * FROM chats WHERE handle = ? COLLATE NOCASE'),
  setChannelMetaStmt: db.prepare(
    'UPDATE chats SET name = ?, description = ?, category = ? WHERE id = ?'
  ),
  setChannelVisibilityStmt: db.prepare(
    'UPDATE chats SET visibility = ?, handle = ?, broadcast = ? WHERE id = ?'
  ),
  subscriberCount: db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?'),
  // Directory listing: public channels, most-subscribed first, with an optional
  // category filter and a free-text query over name/handle/description.
  publicChannels: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) AS sub_count
    FROM chats c
    WHERE c.visibility = 'public'
      AND (@cat = '' OR c.category = @cat)
      AND (@q = '' OR c.name LIKE @like OR c.handle LIKE @like OR c.description LIKE @like)
    ORDER BY sub_count DESC, c.created_at DESC
    LIMIT @limit`),
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

// ---- Channels / Communities ------------------------------------------------
// A channel is a public, discoverable, broadcast-style chat: it reuses the group
// machinery (members, messages, reactions, …) but is listed in the directory,
// joinable by anyone via its handle, and — being a broadcast — only its owner
// may post (everyone else reads and reacts). See chatView() for the surfaced
// fields and the message route for the posting gate.

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

/** Normalize a raw handle to the canonical lower-case, URL-safe form, or null. */
export function normalizeHandle(raw) {
  const h = String(raw || '').trim().toLowerCase().replace(/^@+/, '');
  return HANDLE_RE.test(h) ? h : null;
}

export const getChannelByHandle = (handle) => {
  const h = normalizeHandle(handle);
  return h ? s.chatByHandle.get(h) : null;
};

/** Create a public broadcast channel owned by [ownerId]. Handle must be free. */
export function createChannel({ name, handle, description = '', category = '', ownerId }) {
  const id = uid();
  const ts = now();
  s.insertChannel.run(id, name, pickAvatarColor(id), ownerId, ts, handle, category, description);
  s.addMember.run(id, ownerId, 'owner', ts);
  return s.chatById.get(id);
}

/** Browse the public-channel directory. */
export function listChannelDirectory({ q = '', category = '', limit = 60 } = {}) {
  const query = String(q || '').trim();
  return s.publicChannels
    .all({
      q: query,
      like: `%${query}%`,
      cat: String(category || '').trim(),
      limit: Math.min(Math.max(1, limit | 0), 200),
    })
    .map((row) => channelCard(row));
}

/** Compact directory card for a channel row (already carrying sub_count). */
export function channelCard(chat, viewerId = null) {
  return {
    id: chat.id,
    handle: chat.handle,
    title: chat.name,
    description: chat.description || '',
    category: chat.category || '',
    avatarColor: chat.avatar_color,
    hasAvatar: !!chat.avatar_mime,
    avatarVersion: chat.avatar_version || 0,
    subscriberCount: chat.sub_count != null ? chat.sub_count : s.subscriberCount.get(chat.id).n,
    createdAt: chat.created_at,
    joined: viewerId ? isMember(chat.id, viewerId) : undefined,
  };
}

/** Rename / re-describe / re-categorize a channel. Unspecified fields stay. */
export function updateChannelMeta(chatId, { name, description, category }) {
  const c = s.chatById.get(chatId);
  if (!c) return null;
  s.setChannelMetaStmt.run(
    name ?? c.name,
    description ?? c.description ?? '',
    category ?? c.category ?? '',
    chatId
  );
  return s.chatById.get(chatId);
}

export const subscriberCount = (chatId) => s.subscriberCount.get(chatId).n;

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
    base.ownerId = memberRows.find((m) => m.role === 'owner')?.user_id || null;
    // ---- Channels / Communities ------------------------------------------
    const isChannel = chat.visibility === 'public' && !!chat.broadcast;
    base.isChannel = isChannel;
    base.visibility = chat.visibility || 'private';
    base.handle = chat.handle || null;
    base.broadcast = !!chat.broadcast;
    base.category = chat.category || '';
    base.role = memberRows.find((m) => m.user_id === viewerId)?.role || null;
    base.subscriberCount = memberIds.length;
    // A broadcast channel can be huge; only the owner needs the full member list
    // (for moderation). Subscribers just see the count, which keeps chat-list
    // payloads small.
    base.members = isChannel && base.role !== 'owner'
      ? []
      : memberIds.map((id) => publicUser(getUserById(id))).filter(Boolean);
  }
  // Whether the viewer may post: blocked by a read-only lock, and in a broadcast
  // channel restricted to owners/admins. The client uses this to swap the
  // composer for a "you're following this channel" bar.
  base.canPost = !chat.locked && (!chat.broadcast || base.role === 'owner');

  const last = s.lastVisibleMessage.get(chat.id, now(), viewerId);
  base.lastMessage = last ? messageView(last, viewerId) : null;

  base.unread = s.unreadCount.get(chat.id, viewerId).n;

  // 0.27.0: how many pinned messages this chat has (the banner shows the newest)
  // and the viewer's saved draft text, so it follows them across devices.
  base.pinnedCount = pinnedCount(chat.id);
  base.draft = getDraft(viewerId, chat.id);

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

// ---- Pins / stars / drafts (0.27.0 "Ordnung & Ausdruck") -------------------

const org = {
  pinInsert: db.prepare(`
    INSERT OR IGNORE INTO pinned_messages (chat_id, message_id, pinned_by, pinned_at)
    VALUES (?, ?, ?, ?)`),
  pinDelete: db.prepare(
    'DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ?'
  ),
  pinCount: db.prepare('SELECT COUNT(*) AS n FROM pinned_messages WHERE chat_id = ?'),
  isPinned: db.prepare('SELECT 1 FROM pinned_messages WHERE message_id = ?'),
  pinList: db.prepare(`
    SELECT m.* FROM pinned_messages p
    JOIN messages m ON m.id = p.message_id
    WHERE p.chat_id = ? AND m.deleted_at IS NULL
    ORDER BY p.pinned_at DESC`),
  starInsert: db.prepare(`
    INSERT OR IGNORE INTO starred_messages (user_id, message_id, chat_id, created_at)
    VALUES (?, ?, ?, ?)`),
  starDelete: db.prepare(
    'DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?'
  ),
  isStarred: db.prepare(
    'SELECT 1 FROM starred_messages WHERE user_id = ? AND message_id = ?'
  ),
  starList: db.prepare(`
    SELECT m.* FROM starred_messages s
    JOIN messages m ON m.id = s.message_id
    WHERE s.user_id = ? AND m.deleted_at IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > ?)
    ORDER BY s.created_at DESC LIMIT ?`),
  draftGet: db.prepare('SELECT text FROM chat_drafts WHERE user_id = ? AND chat_id = ?'),
  draftUpsert: db.prepare(`
    INSERT INTO chat_drafts (user_id, chat_id, text, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`),
  draftDelete: db.prepare('DELETE FROM chat_drafts WHERE user_id = ? AND chat_id = ?'),
};

// A chat can hold at most this many pinned messages (matches the WhatsApp feel:
// a short, curated banner list rather than an archive).
export const MAX_PINS_PER_CHAT = 50;

/// Pin a message in its chat. Returns { ok, count } or { error } when the chat
/// is already at the pin ceiling. Idempotent — re-pinning is a no-op.
export function pinMessage(chatId, messageId, userId) {
  if (org.isPinned.get(messageId)) return { ok: true, count: org.pinCount.get(chatId).n };
  if (org.pinCount.get(chatId).n >= MAX_PINS_PER_CHAT) {
    return { error: 'limit', count: MAX_PINS_PER_CHAT };
  }
  org.pinInsert.run(chatId, messageId, userId, now());
  return { ok: true, count: org.pinCount.get(chatId).n };
}

export function unpinMessage(chatId, messageId) {
  org.pinDelete.run(chatId, messageId);
  return { ok: true, count: org.pinCount.get(chatId).n };
}

export function isMessagePinned(messageId) {
  return !!org.isPinned.get(messageId);
}

export function pinnedCount(chatId) {
  return org.pinCount.get(chatId).n;
}

/// The pinned messages of a chat, newest pin first, rendered for [viewerId].
export function listPins(chatId, viewerId) {
  return org.pinList.all(chatId).map((row) => messageView(row, viewerId));
}

/// Toggle a personal bookmark on a message. Returns { starred } reflecting the
/// new state.
export function toggleStar(userId, messageId, chatId) {
  if (org.isStarred.get(userId, messageId)) {
    org.starDelete.run(userId, messageId);
    return { starred: false };
  }
  org.starInsert.run(userId, messageId, chatId, now());
  return { starred: true };
}

export function isMessageStarred(userId, messageId) {
  return !!org.isStarred.get(userId, messageId);
}

/// Every message [userId] has saved, newest first, rendered for them.
export function listStarred(userId, limit = 200) {
  return org.starList
    .all(userId, now(), Math.min(limit, 500))
    .map((row) => messageView(row, userId));
}

/// Upsert (or clear, when text is empty) a per-chat draft for [userId].
export function setDraft(userId, chatId, text) {
  const t = (text || '').toString();
  if (!t.trim()) {
    org.draftDelete.run(userId, chatId);
    return '';
  }
  org.draftUpsert.run(userId, chatId, t, now());
  return t;
}

export function getDraft(userId, chatId) {
  const row = org.draftGet.get(userId, chatId);
  return row ? row.text : '';
}

// Edit history (0.28.0 "Kontext"): each edit snapshots the *previous* body so a
// reader can audit how a message changed. The live body stays on the row.
const edits = {
  insert: db.prepare(
    'INSERT INTO message_edits (id, message_id, body, edited_at) VALUES (?, ?, ?, ?)'
  ),
  list: db.prepare(
    'SELECT body, edited_at FROM message_edits WHERE message_id = ? ORDER BY edited_at ASC, id ASC'
  ),
  count: db.prepare('SELECT COUNT(*) AS n FROM message_edits WHERE message_id = ?'),
};

export function editMessage(id, body) {
  const prev = m.byId.get(id);
  const ts = now();
  tx(() => {
    // Snapshot the old text before overwriting (skip no-op saves).
    if (prev && (prev.body || '') !== body) {
      edits.insert.run(uid(), id, prev.body || '', ts);
    }
    m.edit.run(body, ts, id);
  });
  return m.byId.get(id);
}

/// Every prior version of a message, oldest first ({ body, editedAt }). The
/// message's current body is *not* included — the caller already has it.
export function listMessageEdits(messageId) {
  return edits.list.all(messageId).map((r) => ({ body: r.body, editedAt: r.edited_at }));
}

function editCountOf(messageId) {
  return edits.count.get(messageId).n;
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

// 0.30.0 "Finden & Fokus": full-history search across every chat the user
// belongs to. Backed by an FTS5 index (ranked + highlightable) when available,
// with a LIKE fallback (chatRepo never hard-fails if FTS5 is missing). On top of
// free text the query understands a few filter operators — German or English:
//   von:/from:<name>   sender display-name contains <name>
//   typ:/type:<kind>   message kind (foto/bild→image, video, datei→file, …)
//   nach:/after:<date> on/after a YYYY-MM-DD day
//   vor:/before:<date> strictly before a YYYY-MM-DD day
// so "von:anna typ:foto urlaub" finds Anna's photos mentioning "urlaub".

// Map a filter word to a stored message `type`. Accepts German + English.
const TYPE_ALIASES = {
  text: 'text', image: 'image', foto: 'image', photo: 'image', bild: 'image',
  video: 'video', gif: 'gif', audio: 'audio', voice: 'voice', sprachnachricht: 'voice',
  sprache: 'voice', file: 'file', datei: 'file', dokument: 'file', location: 'location',
  ort: 'location', standort: 'location', poll: 'poll', umfrage: 'poll',
  event: 'event', termin: 'event', tasklist: 'tasklist', aufgabe: 'tasklist',
  aufgaben: 'tasklist', liste: 'tasklist', checkliste: 'tasklist',
};

// Parse a YYYY-MM-DD (local) day into its start-of-day epoch ms, or null.
function dayStart(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Split a raw query into { text, from, type, after, before }. */
export function parseSearchQuery(raw) {
  const out = { text: '', from: '', type: null, after: null, before: null };
  const rest = [];
  for (const tok of String(raw || '').trim().split(/\s+/)) {
    const m = /^([a-zA-ZäöüÄÖÜ]+):(.*)$/.exec(tok);
    if (!m) { rest.push(tok); continue; }
    const key = m[1].toLowerCase();
    const val = m[2];
    if ((key === 'von' || key === 'from') && val) out.from = val;
    else if ((key === 'typ' || key === 'type') && TYPE_ALIASES[val.toLowerCase()]) out.type = TYPE_ALIASES[val.toLowerCase()];
    else if ((key === 'nach' || key === 'after') && dayStart(val) != null) out.after = dayStart(val);
    else if ((key === 'vor' || key === 'before') && dayStart(val) != null) out.before = dayStart(val);
    else rest.push(tok); // unknown operator → treat literally
  }
  out.text = rest.join(' ').trim();
  return out;
}

// Turn free text into a safe FTS5 MATCH expression: keep only letters/digits/_,
// prefix-match each token, AND them together. Returns '' when nothing usable is
// left (e.g. an emoji-only query) so the caller can fall back to LIKE.
function ftsMatch(text) {
  const terms = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}*`);
  return terms.join(' ');
}

export function searchMessages(userId, q, { limit = 30, chatId = null } = {}) {
  const f = parseSearchQuery(q);
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const hasFilter = f.from || f.type || f.after != null || f.before != null;
  // Need *something* to search on: either free text or at least one filter.
  if (f.text.length < 2 && !hasFilter) return [];

  // Shared WHERE fragments + bound params (same for FTS and LIKE paths).
  const where = [
    "m.deleted_at IS NULL",
    "m.type != 'system'",
    '(m.expires_at IS NULL OR m.expires_at > @nowTs)',
    'NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.message_id = m.id AND h.user_id = @uid)',
  ];
  const params = { uid: userId, nowTs: now(), cap };
  if (chatId) { where.push('m.chat_id = @chatId'); params.chatId = chatId; }
  else { where.push('EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = @uid)'); }
  if (f.type) { where.push('m.type = @type'); params.type = f.type; }
  if (f.after != null) { where.push('m.created_at >= @after'); params.after = f.after; }
  if (f.before != null) { where.push('m.created_at < @before'); params.before = f.before; }
  if (f.from) {
    where.push("EXISTS (SELECT 1 FROM users u WHERE u.id = m.sender_id AND u.display_name LIKE @from ESCAPE '\\')");
    params.from = `%${f.from.replace(/[\\%_]/g, '\\$&')}%`;
  }

  const match = f.text.length >= 2 ? ftsMatch(f.text) : '';

  // FTS path: ranked by relevance (bm25) with a highlighted snippet.
  if (ftsAvailable && match) {
    try {
      const sql = `
        SELECT m.*, snippet(messages_fts, 0, '', '', '…', 10) AS _snip
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH @match
          AND ${where.join(' AND ')}
        ORDER BY bm25(messages_fts), m.created_at DESC
        LIMIT @cap`;
      const rows = db.prepare(sql).all({ ...params, match });
      for (const r of rows) { r.searchSnippet = r._snip || null; delete r._snip; }
      return rows;
    } catch {
      // Malformed MATCH or an FTS hiccup → fall through to the LIKE path.
    }
  }

  // LIKE fallback (also the only path when the query is filter-only or FTS is
  // unavailable). Newest first; no relevance ranking.
  const likeClauses = [...where];
  if (f.text.length >= 2) {
    likeClauses.push("m.body LIKE @like ESCAPE '\\'");
    params.like = `%${f.text.replace(/[\\%_]/g, '\\$&')}%`;
  }
  const sql = `
    SELECT m.* FROM messages m
    WHERE ${likeClauses.join(' AND ')}
    ORDER BY m.created_at DESC
    LIMIT @cap`;
  return db.prepare(sql).all(params);
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
    // How many earlier versions exist (drives the "bearbeitet"-history viewer).
    editCount: msg.deleted_at ? 0 : editCountOf(msg.id),
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
    // 0.33.0 "Pläne & Aufgaben": event (RSVP) and task-list payloads.
    event: msg.type === 'event' && !msg.deleted_at ? eventView(msg.id, viewerId) : null,
    tasklist: msg.type === 'tasklist' && !msg.deleted_at ? taskListView(msg.id) : null,
    // 0.27.0: chat-wide pin state + this viewer's personal bookmark.
    pinned: msg.deleted_at ? false : isMessagePinned(msg.id),
    starred: msg.deleted_at ? false : isMessageStarred(viewerId, msg.id),
  };
}
