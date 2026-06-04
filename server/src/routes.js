import { Router } from 'express';
import { hashPassword, verifyPassword, signToken, requireAuth } from './auth.js';
import {
  parse,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  messageBodySchema,
  createDirectChatSchema,
  createGroupChatSchema,
} from './validation.js';
import {
  createUser,
  getUserByUsername,
  getUserById,
  updateProfile,
  searchUsers,
  publicUser,
  addContact,
  removeContact,
  listContacts,
} from './repo.js';
import {
  getOrCreateDirectChat,
  createGroupChat,
  getChat,
  isMember,
  getMemberIds,
  addMember,
  removeMember,
  setMuted,
  getUserChats,
  chatView,
  createMessage,
  getMessage,
  editMessage,
  deleteMessage,
  getHistory,
  messageView,
  markChatRead,
} from './chatRepo.js';
import {
  broadcastToChat,
  sendToUser,
  isOnline,
} from './hub.js';

export const router = Router();

// Wrap async handlers so thrown errors hit the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Auth ------------------------------------------------------------------

router.post(
  '/auth/register',
  h(async (req, res) => {
    const { username, password, displayName } = parse(registerSchema, req.body);
    if (getUserByUsername(username)) {
      return res
        .status(409)
        .json({ error: 'Dieser Benutzername ist schon vergeben. Versuch einen anderen.' });
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({ username, displayName, passwordHash });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/auth/login',
  h(async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = getUserByUsername(username);
    // Always run a compare to keep timing roughly constant whether or not the
    // user exists, so you can't probe for valid usernames.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !ok) {
      return res
        .status(401)
        .json({ error: 'Benutzername oder Passwort stimmt nicht.' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// ---- Current user ----------------------------------------------------------

router.get(
  '/me',
  requireAuth,
  h(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

router.patch(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const data = parse(updateProfileSchema, req.body);
    const updated = updateProfile(req.user.id, data);
    const view = publicUser(updated);
    // Let peers see the new name/avatar live.
    for (const chat of getUserChats(req.user.id)) {
      broadcastToChat(chat.id, 'user-updated', { user: view }, req.user.id);
    }
    res.json({ user: view });
  })
);

// ---- User search & contacts ------------------------------------------------

router.get(
  '/users/search',
  requireAuth,
  h(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2) return res.json({ users: [] });
    const users = searchUsers(q, req.user.id).map(publicUser);
    res.json({ users: users.map((u) => ({ ...u, online: isOnline(u.id) })) });
  })
);

router.get(
  '/users/:id',
  requireAuth,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    res.json({ user: { ...publicUser(user), online: isOnline(user.id) } });
  })
);

router.get(
  '/contacts',
  requireAuth,
  h(async (req, res) => {
    const contacts = listContacts(req.user.id).map((u) => ({
      ...publicUser(u),
      online: isOnline(u.id),
    }));
    res.json({ contacts });
  })
);

router.post(
  '/contacts',
  requireAuth,
  h(async (req, res) => {
    const id = (req.body?.userId || '').toString();
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst hinzufügen.' });
    }
    const target = getUserById(id);
    if (!target) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    addContact(req.user.id, id);
    res.status(201).json({ contact: { ...publicUser(target), online: isOnline(id) } });
  })
);

router.delete(
  '/contacts/:id',
  requireAuth,
  h(async (req, res) => {
    removeContact(req.user.id, req.params.id);
    res.status(204).end();
  })
);

// ---- Chats -----------------------------------------------------------------

router.get(
  '/chats',
  requireAuth,
  h(async (req, res) => {
    const chats = getUserChats(req.user.id)
      .map((c) => chatView(c, req.user.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ chats });
  })
);

router.post(
  '/chats/direct',
  requireAuth,
  h(async (req, res) => {
    const { userId } = parse(createDirectChatSchema, req.body);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Mit dir selbst kannst du nicht chatten.' });
    }
    const other = getUserById(userId);
    if (!other) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    const chat = getOrCreateDirectChat(req.user.id, userId);
    const view = chatView(chat, req.user.id);
    // Make sure the other side gets the new chat pushed into their list.
    sendToUser(userId, 'chat-created', { chat: chatView(chat, userId) });
    res.status(201).json({ chat: view });
  })
);

router.post(
  '/chats/group',
  requireAuth,
  h(async (req, res) => {
    const { name, memberIds = [] } = parse(createGroupChatSchema, req.body);
    const valid = [...new Set(memberIds)].filter((m) => m !== req.user.id && getUserById(m));
    const chat = createGroupChat({ name, ownerId: req.user.id, memberIds: valid });
    // System message so the timeline starts with something meaningful.
    const sys = createMessage({
      chatId: chat.id,
      senderId: req.user.id,
      type: 'system',
      body: `${req.user.display_name} hat die Gruppe „${name}" erstellt.`,
    });
    for (const memberId of getMemberIds(chat.id)) {
      sendToUser(memberId, 'chat-created', { chat: chatView(chat, memberId) });
    }
    res.status(201).json({ chat: chatView(chat, req.user.id), firstMessage: messageView(sys, req.user.id) });
  })
);

// Guard: the caller must belong to the chat in the URL.
function memberGuard(req, res, next) {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Diesen Chat gibt es nicht.' });
  if (!isMember(chat.id, req.user.id)) {
    return res.status(403).json({ error: 'Du bist kein Mitglied dieses Chats.' });
  }
  req.chat = chat;
  next();
}

router.get(
  '/chats/:id',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    res.json({ chat: chatView(req.chat, req.user.id) });
  })
);

router.get(
  '/chats/:id/messages',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const before = req.query.before ? Number(req.query.before) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    const messages = getHistory(req.chat.id, { before, limit }).map((m) =>
      messageView(m, req.user.id)
    );
    res.json({ messages });
  })
);

router.post(
  '/chats/:id/messages',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const body = parse(messageBodySchema, req.body?.body);
    const replyTo = req.body?.replyTo ? req.body.replyTo.toString() : null;
    if (replyTo) {
      const target = getMessage(replyTo);
      if (!target || target.chat_id !== req.chat.id) {
        return res.status(400).json({ error: 'Die zitierte Nachricht gehört nicht zu diesem Chat.' });
      }
    }
    const msg = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      body,
      replyTo,
    });
    // Fan the new message out to everyone, each with their own view.
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(msg, memberId) });
    }
    res.status(201).json({ message: messageView(msg, req.user.id) });
  })
);

router.patch(
  '/chats/:id/messages/:msgId',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id) {
      return res.status(404).json({ error: 'Diese Nachricht gibt es nicht.' });
    }
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Du kannst nur deine eigenen Nachrichten bearbeiten.' });
    }
    if (msg.deleted_at) {
      return res.status(400).json({ error: 'Gelöschte Nachrichten lassen sich nicht bearbeiten.' });
    }
    const body = parse(messageBodySchema, req.body?.body);
    const updated = editMessage(msg.id, body);
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message-updated', { message: messageView(updated, memberId) });
    }
    res.json({ message: messageView(updated, req.user.id) });
  })
);

router.delete(
  '/chats/:id/messages/:msgId',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id) {
      return res.status(404).json({ error: 'Diese Nachricht gibt es nicht.' });
    }
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Du kannst nur deine eigenen Nachrichten löschen.' });
    }
    const updated = deleteMessage(msg.id);
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message-updated', { message: messageView(updated, memberId) });
    }
    res.json({ message: messageView(updated, req.user.id) });
  })
);

router.post(
  '/chats/:id/read',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    markChatRead(req.chat.id, req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/chats/:id/mute',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    setMuted(req.chat.id, req.user.id, !!req.body?.muted);
    res.json({ ok: true, muted: !!req.body?.muted });
  })
);

// Group management: add members, leave.
router.post(
  '/chats/:id/members',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.type !== 'group') {
      return res.status(400).json({ error: 'Mitglieder gibt es nur in Gruppen.' });
    }
    const ids = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const added = [];
    for (const id of ids) {
      const u = getUserById(id);
      if (u && !isMember(req.chat.id, id)) {
        addMember(req.chat.id, id);
        added.push(u);
        const sys = createMessage({
          chatId: req.chat.id,
          senderId: req.user.id,
          type: 'system',
          body: `${req.user.display_name} hat ${u.display_name} hinzugefügt.`,
        });
        sendToUser(id, 'chat-created', { chat: chatView(req.chat, id) });
        for (const memberId of getMemberIds(req.chat.id)) {
          sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
        }
      }
    }
    res.json({ added: added.map(publicUser) });
  })
);

router.post(
  '/chats/:id/leave',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.type !== 'group') {
      return res.status(400).json({ error: 'Aus Direktchats kannst du nicht austreten.' });
    }
    const sys = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      type: 'system',
      body: `${req.user.display_name} hat die Gruppe verlassen.`,
    });
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
    }
    removeMember(req.chat.id, req.user.id);
    sendToUser(req.user.id, 'chat-removed', { chatId: req.chat.id });
    res.json({ ok: true });
  })
);
