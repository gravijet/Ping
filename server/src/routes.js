import express, { Router } from 'express';
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireAdmin,
} from './auth.js';
import { config } from './config.js';
import { normalizePhone } from './phone.js';
import { detectImageMime, saveAvatar, readAvatar, deleteAvatar } from './avatars.js';
import {
  parse,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  securitySchema,
  messageBodySchema,
  messageSendSchema,
  statusSchema,
  directChatSchema,
  lookupSchema,
  matchSchema,
  createGroupChatSchema,
  adminCreateSchema,
  adminUpdateSchema,
  adminBroadcastSchema,
} from './validation.js';
import {
  createUser,
  getUserByPhone,
  getUserByEmail,
  getUserById,
  updateProfile,
  setAvatar,
  setEmail,
  setPassword,
  setName,
  setAdmin,
  deleteUser,
  countUsers,
  countChats,
  countGroups,
  countMessages,
  countActiveStatuses,
  countAdmins,
  listUsers,
  matchContacts,
  blockUser,
  unblockUser,
  hasBlocked,
  listBlockedIds,
  publicUser,
  privateUser,
  adminUser,
} from './repo.js';
import {
  getOrCreateDirectChat,
  createGroupChat,
  getChat,
  isMember,
  getMemberIds,
  getPeerIds,
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
  detachCreatedChats,
} from './chatRepo.js';
import {
  saveUpload,
  getUploadMeta,
  readUpload,
  isInlineMime,
  kindForMime,
} from './uploads.js';
import { detectImageMime as sniffImage } from './avatars.js';
import {
  createStatus,
  getStatus,
  deleteStatus,
  activeStatusesForUser,
  markStatusViewed,
  statusView,
  statusViewers,
} from './statusRepo.js';
import { broadcastToChat, sendToUser, isOnline, onlineUserIds } from './hub.js';

export const router = Router();

// Wrap async handlers so thrown errors hit the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// A constant bcrypt hash to compare against when no user is found, keeping
// login timing roughly constant whether or not an account exists.
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';

// Notify everyone who shares a chat with this user about a profile change.
function broadcastProfile(user) {
  const view = publicUser(user);
  for (const chat of getUserChats(user.id)) {
    broadcastToChat(chat.id, 'user-updated', { user: view }, user.id);
  }
}

// ---- Auth ------------------------------------------------------------------

// Register straight away — phone, email and password, no verification step.
router.post(
  '/auth/register',
  h(async (req, res) => {
    const { phone, email, password, displayName } = parse(registerSchema, req.body);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({
        error:
          'Diese Handynummer können wir nicht erkennen. Probier es im Format +49 170 1234567.',
      });
    }
    if (getUserByPhone(normalized)) {
      return res
        .status(409)
        .json({ error: 'Diese Handynummer ist schon registriert.' });
    }
    if (getUserByEmail(email)) {
      return res
        .status(409)
        .json({ error: 'Diese E-Mail-Adresse ist schon registriert.' });
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({ phone: normalized, email, passwordHash, displayName });
    res.status(201).json({ token: signToken(user), user: privateUser(user) });
  })
);

// Log in with email or phone + password.
router.post(
  '/auth/login',
  h(async (req, res) => {
    const { login, password } = parse(loginSchema, req.body);
    const normalized = normalizePhone(login);
    const user = (normalized && getUserByPhone(normalized)) || getUserByEmail(login);
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, DUMMY_HASH);
    if (!user || !ok) {
      return res
        .status(401)
        .json({ error: 'Nummer/E-Mail oder Passwort stimmt nicht.' });
    }
    res.json({ token: signToken(user), user: privateUser(user) });
  })
);

// ---- Current user ----------------------------------------------------------

router.get(
  '/me',
  requireAuth,
  h(async (req, res) => {
    res.json({ user: privateUser(req.user) });
  })
);

router.patch(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const data = parse(updateProfileSchema, req.body);
    const updated = updateProfile(req.user.id, data);
    broadcastProfile(updated);
    res.json({ user: privateUser(updated) });
  })
);

// Change the email and/or password.
router.patch(
  '/me/security',
  requireAuth,
  h(async (req, res) => {
    const { email, password, currentPassword } = parse(securitySchema, req.body);
    const me = req.user;

    if (email !== undefined) {
      const existing = getUserByEmail(email);
      if (existing && existing.id !== me.id) {
        return res
          .status(409)
          .json({ error: 'Diese E-Mail-Adresse wird schon verwendet.' });
      }
    }
    if (password !== undefined) {
      const ok = currentPassword
        ? await verifyPassword(currentPassword, me.password_hash)
        : false;
      if (!ok) {
        return res
          .status(403)
          .json({ error: 'Zum Ändern brauchen wir dein aktuelles Passwort.' });
      }
    }

    let updated = me;
    if (email !== undefined) updated = setEmail(me.id, email);
    if (password !== undefined) {
      updated = setPassword(me.id, await hashPassword(password));
    }
    res.json({ user: privateUser(updated) });
  })
);

// Upload a profile picture (raw image bytes in the request body).
router.post(
  '/me/avatar',
  requireAuth,
  express.raw({ type: () => true, limit: config.maxAvatarBytes }),
  h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'Kein Bild empfangen.' });
    }
    const mime = detectImageMime(buf);
    if (!mime) {
      return res
        .status(400)
        .json({ error: 'Nur JPG-, PNG- oder WebP-Bilder werden unterstützt.' });
    }
    saveAvatar(req.user.id, buf);
    const updated = setAvatar(req.user.id, mime);
    broadcastProfile(updated);
    res.json({ user: privateUser(updated) });
  })
);

router.delete(
  '/me/avatar',
  requireAuth,
  h(async (req, res) => {
    deleteAvatar(req.user.id);
    const updated = setAvatar(req.user.id, null);
    broadcastProfile(updated);
    res.json({ user: privateUser(updated) });
  })
);

// Self-service account deletion. Irreversible, so we require the account
// password as confirmation. Cascades remove memberships and receipts; the
// user's messages stay (sender becomes null) so other people's chats aren't
// torn apart mid-thread.
router.delete(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const me = req.user;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ok = password ? await verifyPassword(password, me.password_hash) : false;
    if (!ok) {
      return res
        .status(403)
        .json({ error: 'Zum Löschen deines Kontos brauchen wir dein Passwort.' });
    }
    // Collect everyone who shares a chat with us before we tear the rows down.
    const peers = new Set();
    for (const chat of getUserChats(me.id)) {
      for (const memberId of getMemberIds(chat.id)) {
        if (memberId !== me.id) peers.add(memberId);
      }
    }
    deleteAvatar(me.id);
    detachCreatedChats(me.id); // hand off / drop chats we created first.
    deleteUser(me.id); // FK cascade: memberships + message_status; messages kept.
    // Let peers refresh: our bubbles now show as a deleted account.
    const tombstone = {
      id: me.id,
      displayName: 'Gelöschtes Konto',
      avatarColor: '#78909C',
      about: '',
      hasAvatar: false,
      avatarVersion: 0,
      lastSeen: null,
    };
    for (const peerId of peers) {
      sendToUser(peerId, 'user-updated', { user: tombstone });
    }
    res.status(204).end();
  })
);

// ---- Finding people --------------------------------------------------------

// Exact lookup by phone or email (used for manual "start chat" / group add).
router.post(
  '/users/lookup',
  requireAuth,
  h(async (req, res) => {
    const { phone } = parse(lookupSchema, req.body);
    const n = normalizePhone(phone);
    if (!n) {
      return res
        .status(400)
        .json({ error: 'Diese Handynummer können wir nicht erkennen.' });
    }
    const user = getUserByPhone(n);
    if (!user) {
      return res
        .status(404)
        .json({ error: 'Diese Person ist (noch) nicht bei Ping.' });
    }
    res.json({ user: { ...publicUser(user), online: isOnline(user.id) } });
  })
);

// Privacy-preserving contact discovery: send normalized phones / emails, get
// back only those that are registered. The uploaded lists are never stored.
router.post(
  '/contacts/match',
  requireAuth,
  h(async (req, res) => {
    const { phones = [] } = parse(matchSchema, req.body);
    const normPhones = phones.map((p) => normalizePhone(p)).filter(Boolean);
    const rows = matchContacts(normPhones, [], req.user.id);

    const phoneSet = new Set(normPhones);
    // Echo back which of *their own* phone numbers matched, so the client can
    // map each hit to the device contact it came from.
    const users = rows.map((u) => ({
      user: { ...publicUser(u), online: isOnline(u.id) },
      phone: phoneSet.has(u.phone) ? u.phone : null,
    }));
    res.json({ users });
  })
);

router.get(
  '/users/:id/avatar',
  requireAuth,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user || !user.avatar_mime) {
      return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    }
    const buf = readAvatar(user.id);
    if (!buf) return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    res.set('Content-Type', user.avatar_mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buf);
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

// Start (or reopen) a direct chat by user id, phone number or email.
router.post(
  '/chats/direct',
  requireAuth,
  h(async (req, res) => {
    const { userId, phone } = parse(directChatSchema, req.body);
    let other = null;
    if (userId) other = getUserById(userId);
    if (!other && phone) {
      const n = normalizePhone(phone);
      if (!n) return res.status(400).json({ error: 'Diese Handynummer können wir nicht erkennen.' });
      other = getUserByPhone(n);
    }
    if (!other) {
      return res
        .status(404)
        .json({ error: 'Diese Person ist (noch) nicht bei Ping. Lade sie ein!' });
    }
    if (other.id === req.user.id) {
      return res.status(400).json({ error: 'Mit dir selbst kannst du nicht chatten.' });
    }
    const chat = getOrCreateDirectChat(req.user.id, other.id);
    sendToUser(other.id, 'chat-created', { chat: chatView(chat, other.id) });
    res.status(201).json({ chat: chatView(chat, req.user.id) });
  })
);

router.post(
  '/chats/group',
  requireAuth,
  h(async (req, res) => {
    const { name, memberIds = [] } = parse(createGroupChatSchema, req.body);
    const valid = [...new Set(memberIds)].filter((m) => m !== req.user.id && getUserById(m));
    const chat = createGroupChat({ name, ownerId: req.user.id, memberIds: valid });
    const sys = createMessage({
      chatId: chat.id,
      senderId: req.user.id,
      type: 'system',
      body: `${req.user.display_name} hat die Gruppe „${name}" erstellt.`,
    });
    for (const memberId of getMemberIds(chat.id)) {
      sendToUser(memberId, 'chat-created', { chat: chatView(chat, memberId) });
    }
    res.status(201).json({
      chat: chatView(chat, req.user.id),
      firstMessage: messageView(sys, req.user.id),
    });
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
    const { body, type = 'text', attachment, replyTo: replyRaw } = parse(
      messageSendSchema,
      req.body || {}
    );
    const replyTo = replyRaw ? replyRaw.toString() : null;
    if (replyTo) {
      const target = getMessage(replyTo);
      if (!target || target.chat_id !== req.chat.id) {
        return res.status(400).json({ error: 'Die zitierte Nachricht gehört nicht zu diesem Chat.' });
      }
    }
    // In a direct chat you can't message someone who has blocked you.
    if (req.chat.type === 'direct') {
      const otherId = getMemberIds(req.chat.id).find((mId) => mId !== req.user.id);
      if (otherId && hasBlocked(otherId, req.user.id)) {
        return res
          .status(403)
          .json({ error: 'Du kannst dieser Person gerade nicht schreiben.' });
      }
    }
    const att = attachment
      ? {
          ...attachment,
          kind:
            attachment.kind ||
            kindForMime(attachment.mime || '', attachment.name || ''),
        }
      : null;
    const msg = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      type,
      body: (body || '').trim(),
      attachment: att,
      replyTo,
    });
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

// ---- Attachments -----------------------------------------------------------

// Upload raw bytes for a message/status attachment. Images are sniffed from
// their magic bytes (never the header); other types are stored with their
// declared mime and always served back with nosniff + a download disposition.
router.post(
  '/uploads',
  requireAuth,
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'Keine Datei empfangen.' });
    }
    let mime = (req.headers['content-type'] || 'application/octet-stream')
      .toString()
      .split(';')[0]
      .trim()
      .toLowerCase();
    const sniffed = sniffImage(buf); // jpeg / png / webp
    const isGif = buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8';
    if (mime.startsWith('image/') || sniffed || isGif) {
      if (sniffed) mime = sniffed;
      else if (isGif) mime = 'image/gif';
      else {
        return res
          .status(400)
          .json({ error: 'Dieses Bildformat wird nicht unterstützt.' });
      }
    }
    const name = req.headers['x-filename']
      ? decodeURIComponent(req.headers['x-filename'].toString()).slice(0, 200)
      : null;
    const meta = saveUpload({ buf, mime, name, ownerId: req.user.id });
    res.status(201).json({ upload: meta });
  })
);

router.get(
  '/uploads/:id',
  requireAuth,
  h(async (req, res) => {
    const meta = getUploadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    const buf = readUpload(meta.id);
    if (!buf) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    res.set('Content-Type', meta.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=86400');
    const disp = isInlineMime(meta.mime) ? 'inline' : 'attachment';
    res.set(
      'Content-Disposition',
      `${disp}; filename="${(meta.name || 'datei').replace(/"/g, '')}"`
    );
    res.send(buf);
  })
);

// ---- Status updates ("stories") -------------------------------------------

router.post(
  '/status',
  requireAuth,
  h(async (req, res) => {
    const { type = 'text', body = '', attachment, bgColor } = parse(
      statusSchema,
      req.body || {}
    );
    const att = attachment
      ? { ...attachment, kind: attachment.kind || 'image' }
      : null;
    const row = createStatus({
      userId: req.user.id,
      type,
      body: (body || '').trim(),
      attachment: att,
      bgColor: bgColor || null,
    });
    for (const peerId of getPeerIds(req.user.id)) {
      sendToUser(peerId, 'status-added', { userId: req.user.id });
    }
    res.status(201).json({ status: statusView(row, req.user.id) });
  })
);

router.get(
  '/status',
  requireAuth,
  h(async (req, res) => {
    const mine = activeStatusesForUser(req.user.id).map((s) =>
      statusView(s, req.user.id)
    );
    const others = [];
    for (const peerId of getPeerIds(req.user.id)) {
      const rows = activeStatusesForUser(peerId);
      if (rows.length === 0) continue;
      const items = rows.map((s) => statusView(s, req.user.id));
      others.push({
        user: { ...publicUser(getUserById(peerId)), online: isOnline(peerId) },
        items,
        hasUnseen: items.some((i) => !i.seen),
        updatedAt: rows[rows.length - 1].created_at,
      });
    }
    // Unseen rings first, then most recently updated.
    others.sort((a, b) =>
      a.hasUnseen === b.hasUnseen
        ? b.updatedAt - a.updatedAt
        : a.hasUnseen
          ? -1
          : 1
    );
    res.json({ mine, others });
  })
);

router.post(
  '/status/:id/view',
  requireAuth,
  h(async (req, res) => {
    const s = getStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Status nicht gefunden.' });
    if (s.user_id !== req.user.id) markStatusViewed(s.id, req.user.id);
    res.json({ ok: true });
  })
);

router.get(
  '/status/:id/viewers',
  requireAuth,
  h(async (req, res) => {
    const s = getStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Status nicht gefunden.' });
    if (s.user_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: 'Nur der Ersteller sieht, wer den Status angesehen hat.' });
    }
    res.json({ viewers: statusViewers(s.id) });
  })
);

router.delete(
  '/status/:id',
  requireAuth,
  h(async (req, res) => {
    const s = getStatus(req.params.id);
    if (!s) return res.status(404).json({ error: 'Status nicht gefunden.' });
    if (s.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Du kannst nur eigene Status löschen.' });
    }
    deleteStatus(s.id);
    res.status(204).end();
  })
);

// ---- Blocking --------------------------------------------------------------

router.get(
  '/blocks',
  requireAuth,
  h(async (req, res) => {
    res.json({ blocked: listBlockedIds(req.user.id) });
  })
);

router.post(
  '/users/:id/block',
  requireAuth,
  h(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res
        .status(400)
        .json({ error: 'Dich selbst kannst du nicht blockieren.' });
    }
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    blockUser(req.user.id, target.id);
    res.json({ ok: true, blocked: true });
  })
);

router.post(
  '/users/:id/unblock',
  requireAuth,
  h(async (req, res) => {
    unblockUser(req.user.id, req.params.id);
    res.json({ ok: true, blocked: false });
  })
);

// ---- Admin portal API (admin token or a signed-in admin user) --------------

router.get(
  '/admin/stats',
  requireAdmin,
  h(async (_req, res) => {
    res.json({
      users: countUsers(),
      online: onlineUserIds().length,
      admins: countAdmins(),
      chats: countChats(),
      groups: countGroups(),
      messages: countMessages(),
      statuses: countActiveStatuses(),
    });
  })
);

// Push a live announcement to everyone who is currently connected.
router.post(
  '/admin/broadcast',
  requireAdmin,
  h(async (req, res) => {
    const { title, body } = parse(adminBroadcastSchema, req.body);
    const ids = onlineUserIds();
    for (const id of ids) {
      sendToUser(id, 'announcement', { title: title || 'Ping', body });
    }
    res.json({ ok: true, delivered: ids.length });
  })
);

router.get(
  '/admin/users',
  requireAdmin,
  h(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    const users = listUsers(q).map((u) => ({
      ...adminUser(u),
      online: isOnline(u.id),
    }));
    res.json({ users });
  })
);

router.post(
  '/admin/users',
  requireAdmin,
  h(async (req, res) => {
    const { phone, email, password, displayName, isAdmin } = parse(
      adminCreateSchema,
      req.body
    );
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ error: 'Ungültige Handynummer.' });
    }
    if (getUserByPhone(normalized)) {
      return res.status(409).json({ error: 'Diese Handynummer ist schon registriert.' });
    }
    if (getUserByEmail(email)) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse ist schon registriert.' });
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({
      phone: normalized,
      email,
      passwordHash,
      displayName,
      isAdmin: !!isAdmin,
    });
    res.status(201).json({ user: adminUser(user) });
  })
);

router.patch(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const { displayName, password, isAdmin } = parse(adminUpdateSchema, req.body);
    let user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    if (displayName !== undefined) user = setName(user.id, displayName);
    if (isAdmin !== undefined) user = setAdmin(user.id, isAdmin);
    if (password !== undefined) {
      user = setPassword(user.id, await hashPassword(password));
    }
    res.json({ user: adminUser(user) });
  })
);

router.delete(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    deleteAvatar(user.id);
    detachCreatedChats(user.id);
    deleteUser(user.id);
    res.status(204).end();
  })
);
