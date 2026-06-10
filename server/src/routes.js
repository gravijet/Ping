import os from 'node:os';
import express, { Router } from 'express';
import {
  hashPassword,
  verifyPassword,
  signToken,
  signPhoneToken,
  verifyPhoneToken,
  requireAuth,
  requireAdmin,
} from './auth.js';
import { config } from './config.js';
import { normalizePhone } from './phone.js';
import { verifyFirebaseIdToken } from './firebaseAuth.js';
import { requestCode, verifyCode } from './otp.js';
import { detectImageMime, saveAvatar, readAvatar, deleteAvatar } from './avatars.js';
import {
  parse,
  registerSchema,
  loginSchema,
  requestCodeSchema,
  verifyCodeSchema,
  updateProfileSchema,
  securitySchema,
  messageBodySchema,
  messageSendSchema,
  statusSchema,
  directChatSchema,
  lookupSchema,
  matchSchema,
  createGroupChatSchema,
  reactionSchema,
  adminCreateSchema,
  adminUpdateSchema,
  adminBroadcastSchema,
  pushTokenSchema,
  messageStorageSchema,
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
  setAbout,
  setAdmin,
  setDisabled,
  setMessageStorage,
  deleteUser,
  countUsers,
  countChats,
  countGroups,
  countMessages,
  countActiveStatuses,
  countAdmins,
  countUsersSince,
  countMessagesSince,
  countPushTokens,
  countBlocks,
  countUploads,
  totalUploadBytes,
  usersPerDay,
  messagesPerDay,
  userActivity,
  recordBroadcast,
  listBroadcasts,
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
  getMembers,
  getMemberRole,
  getPeerIds,
  addMember,
  removeMember,
  setMuted,
  updateGroupMeta,
  setChatAvatar,
  getUserChats,
  chatView,
  createMessage,
  getMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  getHistory,
  messageView,
  markChatRead,
  messageReceipts,
  detachCreatedChats,
  adminListChats,
  adminDeleteChat,
  adminChatMessages,
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
import { sendPushToUsers } from './push.js';
import { listBackups, backupNow } from './backup.js';
import {
  savePushToken,
  removeUserPushToken,
  allPushTokens,
} from './pushRepo.js';

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

// A short, notification-friendly preview of a message (no message body leaks
// for media — just an icon + label, matching the in-app preview style).
function messagePreview(msg) {
  const text = (msg.body || '').trim();
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const att = msg.attachment
    ? typeof msg.attachment === 'string'
      ? JSON.parse(msg.attachment)
      : msg.attachment
    : null;
  const kind = att?.kind || msg.type;
  switch (kind) {
    case 'image':
      return '📷 Foto';
    case 'gif':
      return '🎬 GIF';
    case 'video':
      return '🎥 Video';
    case 'voice':
    case 'audio':
      return '🎤 Sprachnachricht';
    case 'file':
      return '📎 Datei';
    default:
      return 'Neue Nachricht';
  }
}

// Send a push to chat members who don't have the app open (no live socket) and
// haven't muted the chat — so a new message still pings their phone. The sender
// and anyone currently connected over WebSocket are skipped (they already get
// it live / are looking at the app). Fire-and-forget.
function pushForMessage(chat, msg, senderId) {
  const sender = getUserById(senderId);
  const isGroup = chat.type === 'group';
  const targets = getMembers(chat.id)
    .filter((m) => m.user_id !== senderId && !m.muted && !isOnline(m.user_id))
    .map((m) => m.user_id);
  if (targets.length === 0) return;
  const senderName = sender?.display_name || 'Ping';
  const preview = messagePreview(msg);
  const title = isGroup ? chat.name || 'Gruppe' : senderName;
  const body = isGroup ? `${senderName}: ${preview}` : preview;
  sendPushToUsers(targets, {
    title,
    body,
    data: {
      type: 'message',
      chatId: chat.id,
      messageId: msg.id,
      senderId,
    },
  }).catch(() => {});
}

// ---- Auth ------------------------------------------------------------------

// Send a one-time SMS code to a phone number (server-side verification). With
// the default 'log' SMS provider the code comes back in `devCode` so the flow is
// testable without a paid gateway; wire up SMS_PROVIDER=twilio|http to send real
// texts. See server/.env.example.
router.post(
  '/auth/request-code',
  h(async (req, res) => {
    const { phone } = parse(requestCodeSchema, req.body);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({
        error:
          'Diese Handynummer können wir nicht erkennen. Probier es im Format +43 660 1234567.',
      });
    }
    const result = await requestCode(normalized);
    if (!result.ok) {
      return res.status(429).json({
        error: `Bitte warte ${result.retryInSec}s, bevor du einen neuen Code anforderst.`,
        retryInSec: result.retryInSec,
      });
    }
    res.json({
      ok: true,
      phone: normalized,
      expiresIn: result.expiresInSec,
      ...(result.devCode ? { devCode: result.devCode } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    });
  })
);

// Check an SMS code and, on success, hand back a short-lived verification token
// that /auth/register accepts as proof the number belongs to this device.
router.post(
  '/auth/verify-code',
  h(async (req, res) => {
    const { phone, code } = parse(verifyCodeSchema, req.body);
    const normalized = normalizePhone(phone);
    if (!normalized || !verifyCode(normalized, code)) {
      return res
        .status(400)
        .json({ error: 'Der Code stimmt nicht oder ist abgelaufen.' });
    }
    res.json({ ok: true, phone: normalized, verifyToken: signPhoneToken(normalized) });
  })
);

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
    // Proof that the number really belongs to this device. Two accepted forms:
    //   1. A server verification token from the SMS OTP flow (/auth/verify-code).
    //   2. A Firebase phone-auth ID token (Play Integrity-backed on Android).
    // Whether proof is mandatory is controlled by REQUIRE_PHONE_VERIFICATION.
    const verifyTokenStr =
      typeof req.body?.verifyToken === 'string' ? req.body.verifyToken : null;
    const firebaseIdToken =
      typeof req.body?.firebaseIdToken === 'string'
        ? req.body.firebaseIdToken
        : null;
    let phoneVerified = false;
    if (verifyTokenStr) {
      const vphone = verifyPhoneToken(verifyTokenStr);
      if (!vphone || normalizePhone(vphone) !== normalized) {
        return res.status(400).json({
          error: 'Die verifizierte Nummer passt nicht zur angegebenen Nummer.',
        });
      }
      phoneVerified = true;
    } else if (firebaseIdToken) {
      try {
        const payload = await verifyFirebaseIdToken(firebaseIdToken);
        const verified = normalizePhone(payload.phone_number || '');
        if (!verified || verified !== normalized) {
          return res.status(400).json({
            error: 'Die verifizierte Nummer passt nicht zur angegebenen Nummer.',
          });
        }
        phoneVerified = true;
      } catch {
        return res.status(401).json({
          error: 'Die Telefon-Verifizierung ist ungültig oder abgelaufen.',
        });
      }
    }
    if (!phoneVerified && config.requirePhoneVerification) {
      return res.status(401).json({
        error: 'Bitte verifiziere zuerst deine Telefonnummer.',
      });
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
    if (user.disabled) {
      return res.status(403).json({ error: 'Dieses Konto wurde gesperrt.' });
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
    // Everyone always has a "note to self" chat available by default.
    getOrCreateDirectChat(req.user.id, req.user.id);
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
    // A chat with yourself ("Notiz an mich") is allowed and useful — note,
    // forward, save things to yourself, just like WhatsApp.
    const chat = getOrCreateDirectChat(req.user.id, other.id);
    // For a real peer, let them know; for a self-chat this just syncs our own
    // other devices (idempotent on the client).
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

// For group-management actions: must be a group and the caller must be its
// owner (admin). Writes the error response and returns false when not allowed.
function requireGroupOwner(req, res) {
  if (req.chat.type !== 'group') {
    res.status(400).json({ error: 'Das geht nur in Gruppen.' });
    return false;
  }
  if (getMemberRole(req.chat.id, req.user.id) !== 'owner') {
    res.status(403).json({ error: 'Das dürfen nur Gruppen-Admins.' });
    return false;
  }
  return true;
}

// Push the freshened chat view to every member (clients upsert it).
function broadcastChatUpdate(chat) {
  for (const memberId of getMemberIds(chat.id)) {
    sendToUser(memberId, 'chat-created', { chat: chatView(chat, memberId) });
  }
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
    pushForMessage(req.chat, msg, req.user.id);
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

// Toggle an emoji reaction on a message. Broadcasts the updated message to the
// whole chat (reusing the standard message-updated event), so reaction chips
// appear live for everyone.
router.post(
  '/chats/:id/messages/:msgId/reactions',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id || msg.deleted_at) {
      return res.status(404).json({ error: 'Diese Nachricht gibt es nicht.' });
    }
    const { emoji } = parse(reactionSchema, req.body);
    const { added } = toggleReaction(msg.id, req.user.id, emoji);
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message-updated', { message: messageView(msg, memberId) });
    }
    res.json({ ok: true, added, message: messageView(msg, req.user.id) });
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

// "Message info": who received/read one of *your own* messages, and when.
// Only the author may see this (just like WhatsApp's message info).
router.get(
  '/chats/:id/messages/:msgId/receipts',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id) {
      return res.status(404).json({ error: 'Diese Nachricht gibt es nicht.' });
    }
    if (msg.sender_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: 'Die Lese-Info sieht nur der Absender.' });
    }
    const receipts = messageReceipts(msg.id)
      .map((r) => {
        const u = getUserById(r.user_id);
        return u
          ? { user: publicUser(u), deliveredAt: r.delivered_at, readAt: r.read_at }
          : null;
      })
      .filter(Boolean);
    res.json({ receipts });
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

// Rename a group and/or change its description (owner only).
router.patch(
  '/chats/:id',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (!requireGroupOwner(req, res)) return;
    const name =
      typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim()
        : undefined;
    if (name !== undefined && (name.length < 1 || name.length > 80)) {
      return res
        .status(400)
        .json({ error: 'Der Gruppenname muss 1–80 Zeichen haben.' });
    }
    if (description !== undefined && description.length > 500) {
      return res
        .status(400)
        .json({ error: 'Die Beschreibung darf höchstens 500 Zeichen haben.' });
    }
    const renamed = name !== undefined && name !== req.chat.name;
    const updated = updateGroupMeta(req.chat.id, { name, description });
    if (renamed) {
      const sys = createMessage({
        chatId: req.chat.id,
        senderId: req.user.id,
        type: 'system',
        body: `${req.user.display_name} hat die Gruppe in „${name}" umbenannt.`,
      });
      for (const memberId of getMemberIds(req.chat.id)) {
        sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
      }
    }
    broadcastChatUpdate(updated);
    res.json({ chat: chatView(updated, req.user.id) });
  })
);

// Set the group picture (owner only). Raw image bytes in the body.
router.post(
  '/chats/:id/avatar',
  requireAuth,
  memberGuard,
  express.raw({ type: () => true, limit: config.maxAvatarBytes }),
  h(async (req, res) => {
    if (!requireGroupOwner(req, res)) return;
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
    // Group avatars share the avatar store but live under a "chat_" key so they
    // can never collide with a user's avatar file.
    saveAvatar(`chat_${req.chat.id}`, buf);
    const updated = setChatAvatar(req.chat.id, mime);
    broadcastChatUpdate(updated);
    res.json({ chat: chatView(updated, req.user.id) });
  })
);

router.delete(
  '/chats/:id/avatar',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (!requireGroupOwner(req, res)) return;
    deleteAvatar(`chat_${req.chat.id}`);
    const updated = setChatAvatar(req.chat.id, null);
    broadcastChatUpdate(updated);
    res.json({ chat: chatView(updated, req.user.id) });
  })
);

// Serve a group picture (any member may view it).
router.get(
  '/chats/:id/avatar',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (!req.chat.avatar_mime) {
      return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    }
    const buf = readAvatar(`chat_${req.chat.id}`);
    if (!buf) return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    res.set('Content-Type', req.chat.avatar_mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  })
);

// Remove a member from a group (owner only).
router.delete(
  '/chats/:id/members/:userId',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (!requireGroupOwner(req, res)) return;
    const targetId = req.params.userId;
    if (targetId === req.user.id) {
      return res.status(400).json({
        error: 'Dich selbst kannst du nicht entfernen — verlasse die Gruppe.',
      });
    }
    if (!isMember(req.chat.id, targetId)) {
      return res.status(404).json({ error: 'Diese Person ist nicht in der Gruppe.' });
    }
    const target = getUserById(targetId);
    const sys = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      type: 'system',
      body: `${req.user.display_name} hat ${target?.display_name || 'jemanden'} entfernt.`,
    });
    // Notify everyone (incl. the soon-to-be-removed member) of the system note.
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
    }
    removeMember(req.chat.id, targetId);
    sendToUser(targetId, 'chat-removed', { chatId: req.chat.id });
    broadcastChatUpdate(req.chat);
    res.json({ ok: true });
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
      ? {
          ...attachment,
          kind: attachment.kind || (type === 'video' ? 'video' : 'image'),
        }
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

// ---- Message storage preference -------------------------------------------

// Switch between keeping message history on the server (default) and "nur
// lokal": the server purges your sent messages once every recipient has read
// them, and your device keeps the only copy.
router.post(
  '/me/message-storage',
  requireAuth,
  h(async (req, res) => {
    const { mode } = parse(messageStorageSchema, req.body);
    const updated = setMessageStorage(req.user.id, mode);
    res.json({ user: privateUser(updated) });
  })
);

// ---- Data export (personal backup) ----------------------------------------

// Download everything the signed-in user can see: their account plus every
// chat they're in with its message history. A personal, portable backup.
router.get(
  '/me/export',
  requireAuth,
  h(async (req, res) => {
    const uid = req.user.id;
    const chatsOut = [];
    for (const chat of getUserChats(uid)) {
      const messages = getHistory(chat.id, { limit: 10000 }).map((m) =>
        messageView(m, uid)
      );
      chatsOut.push({ chat: chatView(chat, uid), messages });
    }
    res.json({
      exportedAt: Date.now(),
      account: privateUser(getUserById(uid)),
      chats: chatsOut,
    });
  })
);

// ---- Push notification tokens ---------------------------------------------

// Register (or refresh) this device's FCM token so the server can push new
// messages / announcements when the app isn't open.
router.post(
  '/push/token',
  requireAuth,
  h(async (req, res) => {
    const { token, platform } = parse(pushTokenSchema, req.body);
    savePushToken(token, req.user.id, platform || 'android');
    res.json({ ok: true });
  })
);

// Drop a token (logout / notifications disabled). Removing by value is enough;
// scope it to the user so one account can't delete another's token.
router.delete(
  '/push/token',
  requireAuth,
  h(async (req, res) => {
    const { token } = parse(pushTokenSchema, req.body);
    removeUserPushToken(req.user.id, token);
    res.json({ ok: true });
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

// Rich dashboard payload: headline counters, 7-day activity series and live
// system health — everything the admin overview tab renders in one round-trip.
router.get(
  '/admin/overview',
  requireAdmin,
  h(async (_req, res) => {
    const day = 86_400_000;
    const tNow = Date.now();
    res.json({
      stats: {
        users: countUsers(),
        online: onlineUserIds().length,
        admins: countAdmins(),
        chats: countChats(),
        groups: countGroups(),
        messages: countMessages(),
        statuses: countActiveStatuses(),
        pushTokens: countPushTokens(),
        blocks: countBlocks(),
        uploads: countUploads(),
        uploadBytes: totalUploadBytes(),
        newUsers24h: countUsersSince(tNow - day),
        newUsers7d: countUsersSince(tNow - 7 * day),
        messages24h: countMessagesSince(tNow - day),
        messages7d: countMessagesSince(tNow - 7 * day),
      },
      charts: {
        usersPerDay: usersPerDay(7),
        messagesPerDay: messagesPerDay(7),
      },
      system: systemHealth(),
    });
  })
);

function systemHealth() {
  const mem = process.memoryUsage();
  return {
    version: '2.0.0',
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    smsProvider: config.smsProvider,
    pushEnabled: allPushTokens().length >= 0, // table exists; FCM gating is separate
    requirePhoneVerification: config.requirePhoneVerification,
  };
}

router.get(
  '/admin/system',
  requireAdmin,
  h(async (_req, res) => res.json({ system: systemHealth(), backups: listBackups().length }))
);

// Push a live announcement to everyone who is currently connected, AND a phone
// push notification to everyone who isn't (so admin messages reach people even
// when the app is closed).
router.post(
  '/admin/broadcast',
  requireAdmin,
  h(async (req, res) => {
    const { title, body } = parse(adminBroadcastSchema, req.body);
    const online = new Set(onlineUserIds());
    for (const id of online) {
      sendToUser(id, 'announcement', { title: title || 'Ping', body });
    }
    // Push to offline devices (online users already saw the live announcement).
    const offline = [
      ...new Set(allPushTokens().map((r) => r.user_id)),
    ].filter((id) => !online.has(id));
    const pushed = await sendPushToUsers(offline, {
      title: title || 'Ping',
      body,
      data: { type: 'announcement' },
    });
    recordBroadcast({ title: title || '', body, delivered: online.size, pushed });
    res.json({ ok: true, delivered: online.size, pushed });
  })
);

// Recent broadcasts (for the portal's "sent" history).
router.get(
  '/admin/broadcasts',
  requireAdmin,
  h(async (_req, res) => res.json({ broadcasts: listBroadcasts(30) }))
);

// ---- Admin: chat moderation ----
router.get(
  '/admin/chats',
  requireAdmin,
  h(async (req, res) => {
    const q = (req.query.q || '').toString();
    res.json({ chats: adminListChats(q) });
  })
);

router.get(
  '/admin/chats/:id/messages',
  requireAdmin,
  h(async (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Diesen Chat gibt es nicht.' });
    res.json({ messages: adminChatMessages(req.params.id, 50) });
  })
);

router.delete(
  '/admin/chats/:id',
  requireAdmin,
  h(async (req, res) => {
    const ok = adminDeleteChat(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Diesen Chat gibt es nicht.' });
    res.status(204).end();
  })
);

// List automatic DB backup snapshots, and trigger one on demand.
router.get(
  '/admin/backups',
  requireAdmin,
  h(async (_req, res) => res.json({ backups: listBackups() }))
);

router.post(
  '/admin/backups',
  requireAdmin,
  h(async (_req, res) => {
    const file = backupNow();
    res.json({ ok: !!file, file: file ? file.split('/').pop() : null });
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

// Detailed view of one user (activity counters + online state).
router.get(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    res.json({
      user: { ...adminUser(user), online: isOnline(user.id) },
      activity: userActivity(user.id),
    });
  })
);

router.patch(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const { displayName, password, isAdmin, email, about, disabled } = parse(
      adminUpdateSchema,
      req.body
    );
    let user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    if (email !== undefined) {
      const existing = getUserByEmail(email);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: 'Diese E-Mail-Adresse wird schon verwendet.' });
      }
      user = setEmail(user.id, email);
    }
    if (displayName !== undefined) user = setName(user.id, displayName);
    if (about !== undefined) user = setAbout(user.id, about);
    if (isAdmin !== undefined) user = setAdmin(user.id, isAdmin);
    if (disabled !== undefined) user = setDisabled(user.id, disabled);
    if (password !== undefined) {
      user = setPassword(user.id, await hashPassword(password));
    }
    res.json({ user: adminUser(user) });
  })
);

// Send a direct announcement to one user (live + push) — admin "nudge".
router.post(
  '/admin/users/:id/message',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    const { title, body } = parse(adminBroadcastSchema, req.body);
    sendToUser(user.id, 'announcement', { title: title || 'Ping', body });
    const pushed = await sendPushToUsers([user.id], {
      title: title || 'Ping',
      body,
      data: { type: 'announcement' },
    });
    res.json({ ok: true, pushed });
  })
);

// Export all users as CSV (for backups / GDPR / spreadsheets).
router.get(
  '/admin/users.csv',
  requireAdmin,
  h(async (_req, res) => {
    const rows = listUsers('').map((u) => adminUser(u));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,name,phone,email,admin,disabled,created_at,last_seen';
    const lines = rows.map((u) =>
      [u.id, u.displayName, u.phone, u.email, u.isAdmin, u.disabled, new Date(u.createdAt).toISOString(), new Date(u.lastSeen).toISOString()]
        .map(esc)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ping-users.csv"');
    res.send([header, ...lines].join('\n'));
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
