import os from 'node:os';
import crypto from 'node:crypto';
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
import { windowsInfo } from './download.js';
import { createLink, approveLink, pollLink, cancelLink } from './linkRepo.js';
import { normalizePhone } from './phone.js';
import { verifyFirebaseIdToken } from './firebaseAuth.js';
import { requestCode, verifyCode } from './otp.js';
import {
  detectImageMime,
  saveAvatar,
  readAvatar,
  deleteAvatar,
  saveBanner,
  readBanner,
  deleteBanner,
} from './avatars.js';
import {
  parse,
  registerSchema,
  loginSchema,
  linkApproveSchema,
  requestCodeSchema,
  verifyCodeSchema,
  resetPasswordSchema,
  privacySchema,
  searchQuerySchema,
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
  pollCreateSchema,
  pollVoteSchema,
  expireTimerSchema,
  adminCreateSchema,
  adminUpdateSchema,
  adminBroadcastSchema,
  officialMessageSchema,
  adminStatusSchema,
  pushTokenSchema,
  messageStorageSchema,
  postCreateSchema,
  postUpdateSchema,
  remoteConfigSchema,
  scheduleSchema,
  joinSchema,
  callLogSchema,
  apiKeyCreateSchema,
} from './validation.js';
import { getRemoteConfig, setRemoteConfig } from './configRepo.js';
import {
  createScheduled,
  listScheduled,
  getScheduled,
  deleteScheduled,
  scheduledView,
} from './scheduledRepo.js';
import {
  createUser,
  OFFICIAL_USER_ID,
  ensureOfficialUser,
  allActiveUserIds,
  getUserByPhone,
  getUserByEmail,
  getUserById,
  updateProfile,
  setAvatar,
  setBanner,
  setEmail,
  setPassword,
  setName,
  setAbout,
  setAdmin,
  setDisabled,
  setPremium,
  setMessageStorage,
  setShowLastSeen,
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
  setArchived,
  setChatLocked,
  setChatExpire,
  setInviteCode,
  getChatByInviteCode,
  searchMessages,
  updateGroupMeta,
  setChatAvatar,
  getUserChats,
  chatView,
  createMessage,
  getMessage,
  editMessage,
  deleteMessage,
  hideMessageFor,
  createPoll,
  votePoll,
  toggleReaction,
  getHistory,
  messageView,
  markChatRead,
  messageReceipts,
  detachCreatedChats,
  adminListChats,
  adminDeleteChat,
  adminChatMessages,
  adminChatMembers,
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
  adminListStatuses,
} from './statusRepo.js';
import {
  createScheduledBroadcast,
  listScheduledBroadcasts,
  getScheduledBroadcast,
  deleteScheduledBroadcast,
  scheduledBroadcastView,
} from './scheduledBroadcastRepo.js';
import { dispatchBroadcast } from './broadcast.js';
import {
  recordCall,
  listCalls,
  deleteCall,
  clearCalls,
  callView,
} from './callsRepo.js';
import {
  broadcastToChat,
  sendToUser,
  isOnline,
  onlineUserIds,
  disconnectUser,
} from './hub.js';
import { sendPushToUsers, pushEnabled } from './push.js';
import { deliverMessage, pushMessage } from './deliver.js';
import { listBackups, backupNow, backupFilePath } from './backup.js';
import {
  savePushToken,
  removeUserPushToken,
  allPushTokens,
  devicesForUser,
} from './pushRepo.js';
import {
  createPost,
  updatePost,
  deletePost,
  getPostById,
  getPublicPostBySlug,
  listPublicPosts,
  adminListPosts,
  countPublishedPosts,
  postView,
} from './postsRepo.js';
import { recordAudit, listAudit } from './auditRepo.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  API_SCOPES,
} from './apiKeysRepo.js';

export const router = Router();

// Wrap async handlers so thrown errors hit the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Best-effort client IP (Cloudflare passes the real address in CF-Connecting-IP;
// fall back to the socket address for local/dev/tests).
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.ip || '';
}

// Record one privileged admin action. The actor is the signed-in admin user's
// name when available, otherwise the shared portal token. Never throws.
function audit(req, action, target = '', detail = '') {
  recordAudit({
    actor: req.user ? req.user.display_name : 'Portal-Token',
    action,
    target,
    detail,
    ip: clientIp(req),
  });
}

// A constant bcrypt hash to compare against when no user is found, keeping
// login timing roughly constant whether or not an account exists.
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';

// createUser can still trip the UNIQUE constraints when two registrations race
// between the duplicate check and the INSERT. Surface that as the same 409 the
// check would have produced instead of a generic 500. Returns null after
// writing the response.
function tryCreateUser(args, res) {
  try {
    return createUser(args);
  } catch (e) {
    const msg = e?.message || '';
    if (/UNIQUE/i.test(msg) && msg.includes('phone')) {
      res.status(409).json({ error: 'Diese Handynummer ist schon registriert.' });
      return null;
    }
    if (/UNIQUE/i.test(msg) && msg.includes('email')) {
      res.status(409).json({ error: 'Diese E-Mail-Adresse ist schon registriert.' });
      return null;
    }
    throw e;
  }
}

// Notify everyone who shares a chat with this user about a profile change.
function broadcastProfile(user) {
  const view = publicUser(user);
  for (const chat of getUserChats(user.id)) {
    broadcastToChat(chat.id, 'user-updated', { user: view }, user.id);
  }
}

// Push the user's own (private) account view to all of their devices, so changes
// an admin makes — name, email, about, admin flag, … — take effect live without
// a manual refresh. Combined with broadcastProfile this keeps everyone in sync.
function broadcastSelf(user) {
  sendToUser(user.id, 'self-updated', { user: privateUser(user) });
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
    case 'poll':
      return '📊 Umfrage';
    default:
      return 'Neue Nachricht';
  }
}

// Push to offline, non-muted chat members. Delegates to the shared primitive in
// deliver.js so the live route, the official-message path and the scheduled-
// message sweeper all push identically.
function pushForMessage(chat, msg, senderId) {
  pushMessage(chat, msg, senderId);
}

// Deliver a real, persisted message from the official "Ping Team" account into a
// user's private channel. The channel is a normal direct chat that we mark
// read-only (locked), so it shows up like any other conversation but the user
// can't reply — the WhatsApp-broadcast model. Reused for both single-user admin
// DMs and the broadcast-to-everyone. Returns true on delivery.
function deliverOfficialMessage(targetUserId, { body, type = 'text', attachment = null }) {
  if (targetUserId === OFFICIAL_USER_ID) return false;
  const target = getUserById(targetUserId);
  if (!target) return false;
  const chat = getOrCreateDirectChat(OFFICIAL_USER_ID, targetUserId);
  if (!chat.locked) setChatLocked(chat.id, true);
  const msg = createMessage({
    chatId: chat.id,
    senderId: OFFICIAL_USER_ID,
    type,
    body: (body || '').trim(),
    attachment,
  });
  // Make sure the channel exists on the recipient's device, then deliver live.
  const freshChat = getChat(chat.id);
  sendToUser(targetUserId, 'chat-created', { chat: chatView(freshChat, targetUserId) });
  sendToUser(targetUserId, 'message', { message: messageView(msg, targetUserId) });
  pushForMessage(freshChat, msg, OFFICIAL_USER_ID);
  return true;
}

// ---- Public content (newsroom, changelog, live stats) ---------------------

// The marketing site (and the in-app "Neuigkeiten" view) read these. Only
// published posts are returned; drafts stay in the admin portal.
router.get(
  '/news',
  h(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    res.json({ posts: listPublicPosts('news', limit) });
  })
);

router.get(
  '/news/:slug',
  h(async (req, res) => {
    const row = getPublicPostBySlug(req.params.slug);
    if (!row || row.kind !== 'news') {
      return res.status(404).json({ error: 'Diesen Beitrag gibt es nicht.' });
    }
    res.json({ post: postView(row) });
  })
);

router.get(
  '/changelog',
  h(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    res.json({ posts: listPublicPosts('changelog', limit) });
  })
);

// Non-sensitive aggregate counters for the landing page's live stat band, plus
// a tiny system snapshot for the public status page. No per-user data.
router.get(
  '/public/stats',
  h(async (_req, res) => {
    res.json({
      version: config.version,
      users: countUsers(),
      messages: countMessages(),
      chats: countChats(),
      groups: countGroups(),
      statuses: countActiveStatuses(),
      online: onlineUserIds().length,
      news: countPublishedPosts('news'),
      changelog: countPublishedPosts('changelog'),
      uptimeSec: Math.round(process.uptime()),
      time: Date.now(),
    });
  })
);

// Server-driven runtime config (feature flags, limits, an app-wide notice, the
// minimum supported build). Public + non-sensitive; the app caches it so much
// can change without shipping a new APK.
router.get(
  '/config',
  h(async (_req, res) => {
    res.json(getRemoteConfig());
  })
);

// Latest Windows desktop build, for the Windows shell's background auto-updater.
// Lives under /api (not /download) so it stays same-origin reachable on the web
// app host. `url` is absolute because the .exe itself is served from the apex
// host (/download/windows is not an /api pass-through route). Returns 204 when
// no build has been published yet — the shell treats that as "nothing newer".
router.get(
  '/desktop/version',
  h(async (_req, res) => {
    const win = windowsInfo();
    if (!win || !win.version) return res.status(204).end();
    res.json({
      version: win.version,
      url: `${config.publicUrl}/download/windows`,
      size: win.size,
      updatedAt: win.updatedAt,
    });
  })
);

// ---- Auth ------------------------------------------------------------------

// Send a one-time SMS code to a phone number (server-side verification). With
// the default 'log' SMS provider the code comes back in `devCode` so the flow is
// testable without a paid gateway; wire up SMS_PROVIDER=twilio|http to send real
// texts. See server/.env.example.
router.post(
  '/auth/request-code',
  h(async (req, res) => {
    const { phone, purpose = 'register' } = parse(requestCodeSchema, req.body);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({
        error:
          'Diese Handynummer können wir nicht erkennen. Probier es im Format +43 660 1234567.',
      });
    }
    // Don't waste an SMS on a doomed flow: registering needs a free number,
    // resetting a password needs an existing account. (Registration already
    // reveals whether a number is taken, so this leaks nothing new.)
    const existing = getUserByPhone(normalized);
    if (purpose === 'register' && existing) {
      return res
        .status(409)
        .json({ error: 'Diese Handynummer ist schon registriert. Melde dich an.' });
    }
    if (purpose === 'reset' && !existing) {
      return res
        .status(404)
        .json({ error: 'Zu dieser Handynummer gibt es kein Ping-Konto.' });
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

// Forgot password: after proving phone ownership via the SMS code flow
// (request-code purpose:'reset' → verify-code → verifyToken), set a new
// password and sign the user straight in.
router.post(
  '/auth/reset-password',
  h(async (req, res) => {
    const { phone, verifyToken, password } = parse(resetPasswordSchema, req.body);
    const normalized = normalizePhone(phone);
    const verified = verifyPhoneToken(verifyToken);
    if (!normalized || !verified || normalizePhone(verified) !== normalized) {
      return res.status(401).json({
        error: 'Die Verifizierung ist ungültig oder abgelaufen. Fordere einen neuen Code an.',
      });
    }
    const user = getUserByPhone(normalized);
    if (!user) {
      return res
        .status(404)
        .json({ error: 'Zu dieser Handynummer gibt es kein Ping-Konto.' });
    }
    if (user.disabled) {
      return res.status(403).json({ error: 'Dieses Konto wurde gesperrt.' });
    }
    const updated = setPassword(user.id, await hashPassword(password));
    res.json({ token: signToken(updated), user: privateUser(updated) });
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
    const user = tryCreateUser(
      { phone: normalized, email, passwordHash, displayName },
      res
    );
    if (!user) return;
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

// ---- Desktop device linking (scan a QR like WhatsApp Web) ------------------
// The desktop app has no phone number of its own; instead it shows a QR that a
// signed-in phone scans to hand it a session. See linkRepo.js for the security
// model. These live under /auth so they share the stricter auth rate limiter.

// Desktop: begin a link. Returns the public `code` (rendered into the QR) plus
// the private linkId/pollSecret the desktop keeps to claim the token.
router.post(
  '/auth/link/start',
  h(async (_req, res) => {
    const link = createLink();
    res.json({
      linkId: link.linkId,
      pollSecret: link.pollSecret,
      code: link.code,
      expiresAt: link.expiresAt,
    });
  })
);

// Desktop: poll for approval. Only the matching (linkId, pollSecret) pair can
// read the minted token, and it can be claimed exactly once.
router.get(
  '/auth/link/poll',
  h(async (req, res) => {
    const linkId = typeof req.query.linkId === 'string' ? req.query.linkId : '';
    const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
    const result = pollLink(linkId, secret);
    if (result.status === 'approved') {
      const user = getUserById(result.userId);
      if (!user || user.disabled) {
        return res.json({ status: 'expired' });
      }
      return res.json({
        status: 'approved',
        token: result.sessionToken,
        user: privateUser(user),
      });
    }
    res.json({ status: result.status });
  })
);

// Phone (signed in): approve a scanned QR. Mints a real session token for the
// approving user and attaches it to the pending link.
router.post(
  '/auth/link/approve',
  requireAuth,
  h(async (req, res) => {
    const { code, deviceLabel } = parse(linkApproveSchema, req.body);
    const result = approveLink(code, {
      userId: req.user.id,
      sessionToken: signToken(req.user),
      deviceLabel,
    });
    if (result.error === 'expired') {
      return res.status(410).json({
        error: 'Dieser QR-Code ist abgelaufen. Erzeuge am PC einen neuen.',
      });
    }
    if (result.error === 'used') {
      return res
        .status(409)
        .json({ error: 'Dieser QR-Code wurde bereits verwendet.' });
    }
    res.json({ ok: true });
  })
);

// Desktop: drop a pending link (QR screen closed before approval).
router.post(
  '/auth/link/cancel',
  h(async (req, res) => {
    const linkId = typeof req.body?.linkId === 'string' ? req.body.linkId : '';
    const secret = typeof req.body?.pollSecret === 'string' ? req.body.pollSecret : '';
    cancelLink(linkId, secret);
    res.json({ ok: true });
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

// Upload a profile background ("banner"); raw image bytes in the request body.
router.post(
  '/me/banner',
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
        .json({ error: 'Nur JPG-, PNG-, WebP- oder GIF-Bilder werden unterstützt.' });
    }
    saveBanner(req.user.id, buf);
    const updated = setBanner(req.user.id, mime);
    broadcastProfile(updated);
    res.json({ user: privateUser(updated) });
  })
);

router.delete(
  '/me/banner',
  requireAuth,
  h(async (req, res) => {
    deleteBanner(req.user.id);
    const updated = setBanner(req.user.id, null);
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

// Serve a user's profile background image (auth-gated, like avatars).
router.get(
  '/users/:id/banner',
  requireAuth,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user || !user.banner_mime) {
      return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    }
    const buf = readBanner(user.id);
    if (!buf) return res.status(404).json({ error: 'Kein Bild vorhanden.' });
    res.set('Content-Type', user.banner_mime);
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
    // The official "Ping Team" channel is always read-only, even when the user
    // opens it before the team has ever messaged them.
    if (other.id === OFFICIAL_USER_ID && !chat.locked) {
      setChatLocked(chat.id, true);
      chat.locked = 1;
    }
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
    // Non-numeric query params fall back to the defaults instead of producing
    // NaN (which would silently return an empty history).
    const beforeRaw = Number(req.query.before);
    const limitRaw = Number(req.query.limit);
    const before = Number.isFinite(beforeRaw) ? beforeRaw : undefined;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 40;
    const messages = getHistory(req.chat.id, {
      before,
      limit,
      viewerId: req.user.id,
    }).map((m) => messageView(m, req.user.id));
    res.json({ messages });
  })
);

// When the chat has a disappearing-messages timer, new messages get a TTL.
function messageExpiry(chat) {
  const seconds = chat.expire_seconds || 0;
  return seconds > 0 ? Date.now() + seconds * 1000 : null;
}

router.post(
  '/chats/:id/messages',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    // Read-only channel (official "Ping Team" broadcast): members can't post.
    if (req.chat.locked) {
      return res
        .status(403)
        .json({ error: 'Dieser Kanal ist schreibgeschützt.' });
    }
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
    // In a direct chat, blocking cuts the line in both directions: you can't
    // message someone who blocked you, and not someone you blocked yourself.
    if (req.chat.type === 'direct') {
      const otherId = getMemberIds(req.chat.id).find((mId) => mId !== req.user.id);
      if (otherId && hasBlocked(otherId, req.user.id)) {
        return res
          .status(403)
          .json({ error: 'Du kannst dieser Person gerade nicht schreiben.' });
      }
      if (otherId && hasBlocked(req.user.id, otherId)) {
        return res.status(403).json({
          error: 'Du hast diese Person blockiert. Hebe die Blockierung auf, um zu schreiben.',
        });
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
      expiresAt: messageExpiry(req.chat),
    });
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(msg, memberId) });
    }
    pushForMessage(req.chat, msg, req.user.id);
    res.status(201).json({ message: messageView(msg, req.user.id) });
  })
);

// ---- WebRTC calls ----
// ICE servers for the client's RTCPeerConnection: a STUN server always, plus a
// TURN server (with credentials) when one is configured. Auth-gated so the TURN
// credentials aren't handed out publicly.
router.get(
  '/ice',
  requireAuth,
  h(async (_req, res) => {
    const servers = [{ urls: config.ice.stun }];
    if (config.ice.turnUrl) {
      servers.push({
        urls: config.ice.turnUrl,
        username: config.ice.turnUser,
        credential: config.ice.turnPass,
      });
    }
    res.json({ iceServers: servers });
  })
);

// ---- Group invite links (communities) ----
const newInviteCode = () => crypto.randomBytes(6).toString('base64url');

// Current invite link for a group (any member may view it to share).
router.get(
  '/chats/:id/invite',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.type !== 'group') {
      return res.status(400).json({ error: 'Einladungslinks gibt es nur für Gruppen.' });
    }
    const code = req.chat.invite_code || null;
    res.json({ code, url: code ? `${config.publicUrl}/join/${code}` : null });
  })
);

// Create or rotate the invite link (owner only).
router.post(
  '/chats/:id/invite',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.type !== 'group') {
      return res.status(400).json({ error: 'Einladungslinks gibt es nur für Gruppen.' });
    }
    if (!requireGroupOwner(req, res)) return;
    const code = newInviteCode();
    setInviteCode(req.chat.id, code);
    res.json({ code, url: `${config.publicUrl}/join/${code}` });
  })
);

// Revoke the invite link (owner only).
router.delete(
  '/chats/:id/invite',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.type !== 'group') {
      return res.status(400).json({ error: 'Einladungslinks gibt es nur für Gruppen.' });
    }
    if (!requireGroupOwner(req, res)) return;
    setInviteCode(req.chat.id, null);
    res.status(204).end();
  })
);

// Join a group by its invite code. Idempotent: re-joining just returns the chat.
router.post(
  '/chats/join',
  requireAuth,
  h(async (req, res) => {
    const { code } = parse(joinSchema, req.body || {});
    const chat = getChatByInviteCode(code.trim());
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ error: 'Dieser Einladungslink ist ungültig.' });
    }
    if (isMember(chat.id, req.user.id)) {
      return res.json({ chat: chatView(chat, req.user.id), joined: false });
    }
    addMember(chat.id, req.user.id);
    const sys = createMessage({
      chatId: chat.id,
      senderId: req.user.id,
      type: 'system',
      body: `${req.user.display_name} ist über einen Einladungslink beigetreten.`,
    });
    sendToUser(req.user.id, 'chat-created', { chat: chatView(chat, req.user.id) });
    for (const memberId of getMemberIds(chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
    }
    res.status(201).json({ chat: chatView(chat, req.user.id), joined: true });
  })
);

// ---- Scheduled messages ("send later") ----
const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000; // a year out, at most

router.post(
  '/chats/:id/schedule',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.locked) {
      return res.status(403).json({ error: 'Dieser Kanal ist schreibgeschützt.' });
    }
    const { body, type = 'text', attachment, replyTo: replyRaw, sendAt } = parse(
      scheduleSchema,
      req.body || {}
    );
    if (sendAt <= Date.now() + 5000) {
      return res.status(400).json({ error: 'Der Sendezeitpunkt muss in der Zukunft liegen.' });
    }
    if (sendAt > Date.now() + MAX_SCHEDULE_MS) {
      return res.status(400).json({ error: 'Der Sendezeitpunkt liegt zu weit in der Zukunft.' });
    }
    const replyTo = replyRaw ? replyRaw.toString() : null;
    if (replyTo) {
      const target = getMessage(replyTo);
      if (!target || target.chat_id !== req.chat.id) {
        return res.status(400).json({ error: 'Die zitierte Nachricht gehört nicht zu diesem Chat.' });
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
    const row = createScheduled({
      chatId: req.chat.id,
      senderId: req.user.id,
      type,
      body: (body || '').trim(),
      attachment: att,
      replyTo,
      sendAt,
    });
    res.status(201).json({ scheduled: scheduledView(row) });
  })
);

router.get(
  '/chats/:id/scheduled',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    res.json({
      scheduled: listScheduled(req.chat.id, req.user.id).map(scheduledView),
    });
  })
);

router.delete(
  '/chats/:id/scheduled/:sid',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const row = getScheduled(req.params.sid);
    if (!row || row.chat_id !== req.chat.id || row.sender_id !== req.user.id) {
      return res.status(404).json({ error: 'Diese geplante Nachricht gibt es nicht.' });
    }
    deleteScheduled(row.id);
    res.status(204).end();
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

// Create a poll in a chat. The poll is a normal message of type 'poll' whose
// question/options/votes ride along in messageView.poll, so all the existing
// realtime plumbing (message + message-updated events) just works.
router.post(
  '/chats/:id/polls',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.locked) {
      return res.status(403).json({ error: 'Dieser Kanal ist schreibgeschützt.' });
    }
    const { question, options, multi = false } = parse(pollCreateSchema, req.body);
    const msg = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      type: 'poll',
      body: '',
      expiresAt: messageExpiry(req.chat),
    });
    createPoll({
      messageId: msg.id,
      chatId: req.chat.id,
      question,
      options,
      multi,
    });
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(msg, memberId) });
    }
    pushForMessage(req.chat, msg, req.user.id);
    res.status(201).json({ message: messageView(msg, req.user.id) });
  })
);

// Vote in a poll (toggles the option; single-choice polls move the vote).
// Everyone in the chat sees the new counts live via message-updated.
router.post(
  '/chats/:id/messages/:msgId/vote',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id || msg.deleted_at || msg.type !== 'poll') {
      return res.status(404).json({ error: 'Diese Umfrage gibt es nicht.' });
    }
    const { option } = parse(pollVoteSchema, req.body);
    if (!votePoll(msg.id, req.user.id, option)) {
      return res.status(400).json({ error: 'Diese Antwortoption gibt es nicht.' });
    }
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message-updated', { message: messageView(msg, memberId) });
    }
    res.json({ message: messageView(msg, req.user.id) });
  })
);

// "Für mich löschen": hide a message on this account only. Unlike DELETE (für
// alle) this works on anyone's messages and leaves the chat untouched for
// everyone else.
router.post(
  '/chats/:id/messages/:msgId/hide',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    const msg = getMessage(req.params.msgId);
    if (!msg || msg.chat_id !== req.chat.id) {
      return res.status(404).json({ error: 'Diese Nachricht gibt es nicht.' });
    }
    hideMessageFor(msg.id, req.user.id);
    res.json({ ok: true });
  })
);

// Turn the disappearing-messages timer for a chat on/off. In groups only the
// owner may change it; in a direct chat either side can (like WhatsApp).
router.post(
  '/chats/:id/expire',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    if (req.chat.locked) {
      return res.status(403).json({ error: 'Dieser Kanal ist schreibgeschützt.' });
    }
    if (
      req.chat.type === 'group' &&
      getMemberRole(req.chat.id, req.user.id) !== 'owner'
    ) {
      return res.status(403).json({ error: 'Das dürfen nur Gruppen-Admins.' });
    }
    const { seconds } = parse(expireTimerSchema, req.body);
    const updated = setChatExpire(req.chat.id, seconds);
    const sys = createMessage({
      chatId: req.chat.id,
      senderId: req.user.id,
      type: 'system',
      body:
        seconds > 0
          ? `${req.user.display_name} hat selbstlöschende Nachrichten aktiviert (${expireLabel(seconds)}).`
          : `${req.user.display_name} hat selbstlöschende Nachrichten deaktiviert.`,
    });
    for (const memberId of getMemberIds(req.chat.id)) {
      sendToUser(memberId, 'message', { message: messageView(sys, memberId) });
    }
    broadcastChatUpdate(updated);
    res.json({ chat: chatView(updated, req.user.id) });
  })
);

// Human label for a disappearing-messages duration (used in system messages).
function expireLabel(seconds) {
  if (seconds % 86400 === 0 && seconds >= 86400) {
    const d = seconds / 86400;
    return d === 1 ? '24 Stunden' : `${d} Tage`;
  }
  if (seconds % 3600 === 0 && seconds >= 3600) {
    const hours = seconds / 3600;
    return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
  }
  const min = Math.max(1, Math.round(seconds / 60));
  return min === 1 ? '1 Minute' : `${min} Minuten`;
}

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

// Archive / unarchive a chat for the calling user only (it moves into the
// collapsed "Archiviert" section on their device; other members see nothing).
router.post(
  '/chats/:id/archive',
  requireAuth,
  memberGuard,
  h(async (req, res) => {
    setArchived(req.chat.id, req.user.id, !!req.body?.archived);
    res.json({ ok: true, archived: !!req.body?.archived });
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
    // A malformed (non-URI-encoded) header must not 500 the upload — fall back
    // to the raw value instead.
    let name = null;
    const rawName = req.headers['x-filename'];
    if (rawName) {
      try {
        name = decodeURIComponent(rawName.toString()).slice(0, 200);
      } catch {
        name = rawName.toString().slice(0, 200);
      }
    }
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
    const peerIds = getPeerIds(req.user.id).filter((id) => id !== req.user.id);
    for (const peerId of peerIds) {
      sendToUser(peerId, 'status-added', { userId: req.user.id });
    }
    // Notify peers who aren't currently connected, on a quieter status channel so
    // it never feels as loud as a direct message.
    const poster = getUserById(req.user.id);
    const offlinePeers = peerIds.filter((id) => !isOnline(id));
    if (offlinePeers.length > 0) {
      sendPushToUsers(offlinePeers, {
        title: poster?.display_name || 'Ping',
        body: 'hat einen neuen Status geteilt',
        channelId: 'ping_status',
        data: { type: 'status', userId: req.user.id, route: 'status' },
      }).catch(() => {});
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
    // The official "Ping Team" account is visible to everyone, even without a
    // shared chat, so add it alongside the viewer's real peers (de-duped below).
    const peerIds = new Set(getPeerIds(req.user.id));
    peerIds.delete(req.user.id);
    if (req.user.id !== OFFICIAL_USER_ID) peerIds.add(OFFICIAL_USER_ID);
    for (const peerId of peerIds) {
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
    // Viewers whose accounts were deleted in the meantime are dropped.
    res.json({ viewers: statusViewers(s.id).filter((v) => v.user) });
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

// ---- WebRTC calls ----------------------------------------------------------

/** Build the ICE server list from config: public STUN plus a configured TURN. */
function iceServers() {
  const servers = [{ urls: config.ice.stun }];
  if (config.ice.turnUrl) {
    // Offer the TURN endpoint over both UDP/TCP (the url as configured) and, when
    // a plain turn: url is given, a TLS turns: variant on 5349 for locked-down
    // networks that only allow 443/TLS out.
    const urls = [config.ice.turnUrl];
    servers.push({
      urls,
      username: config.ice.turnUser,
      credential: config.ice.turnPass,
    });
  }
  return servers;
}

// ICE (STUN/TURN) servers for a call. Auth-gated so credentials aren't public.
router.get(
  '/ice',
  requireAuth,
  h(async (_req, res) => {
    res.json({ iceServers: iceServers() });
  })
);

// Record a finished call in the caller's/callee's own log. Idempotent per
// (user, callId) so re-posting (retry) updates rather than duplicates.
router.post(
  '/calls',
  requireAuth,
  h(async (req, res) => {
    const { peerId, callId, direction, video, outcome, duration } = parse(
      callLogSchema,
      req.body || {}
    );
    if (peerId === req.user.id) {
      return res.status(400).json({ error: 'Ungültiger Gesprächspartner.' });
    }
    const peer = getUserById(peerId);
    if (!peer) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    const row = recordCall({
      userId: req.user.id,
      peerId,
      callId,
      direction,
      video: !!video,
      outcome,
      duration: duration || 0,
    });
    res.status(201).json({ call: callView(row) });
  })
);

// The current user's call history (newest first), peers' deleted accounts skipped.
router.get(
  '/calls',
  requireAuth,
  h(async (req, res) => {
    const calls = listCalls(req.user.id)
      .map(callView)
      .filter((c) => c.peer);
    res.json({ calls });
  })
);

router.delete(
  '/calls/:id',
  requireAuth,
  h(async (req, res) => {
    deleteCall(req.user.id, req.params.id);
    res.status(204).end();
  })
);

router.delete(
  '/calls',
  requireAuth,
  h(async (req, res) => {
    const cleared = clearCalls(req.user.id);
    res.json({ ok: true, cleared });
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

// ---- Privacy settings -------------------------------------------------------

// Toggle whether other people may see this user's "zuletzt online". Presence
// (online right now) stays visible — only the timestamp is hidden.
router.post(
  '/me/privacy',
  requireAuth,
  h(async (req, res) => {
    const { showLastSeen } = parse(privacySchema, req.body);
    const updated = setShowLastSeen(req.user.id, showLastSeen);
    broadcastProfile(updated);
    res.json({ user: privateUser(updated) });
  })
);

// ---- Global message search --------------------------------------------------

// Search the full history of every chat the user belongs to. Returns the
// newest matches first; the client maps each hit to its chat for display.
router.get(
  '/messages/search',
  requireAuth,
  h(async (req, res) => {
    const q = parse(searchQuerySchema, (req.query.q || '').toString());
    const messages = searchMessages(req.user.id, q).map((m) =>
      messageView(m, req.user.id)
    );
    res.json({ messages });
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
      const messages = getHistory(chat.id, { limit: 10000, viewerId: uid }).map(
        (m) => messageView(m, uid)
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

// ---- Developer API keys (self-service) -------------------------------------
// A signed-in user manages the keys that external integrations use to talk to
// /api/v1 on their behalf. The plaintext secret is returned exactly once, on
// creation; afterwards only its prefix is ever shown.

router.get(
  '/dev/keys',
  requireAuth,
  h(async (req, res) => {
    res.json({ keys: listApiKeys(req.user.id), scopes: API_SCOPES });
  })
);

router.post(
  '/dev/keys',
  requireAuth,
  h(async (req, res) => {
    const { name, scopes } = parse(apiKeyCreateSchema, req.body || {});
    // A small cap keeps a single account from minting unbounded keys.
    if (listApiKeys(req.user.id).length >= 25) {
      return res.status(409).json({ error: 'Du hast zu viele API-Schlüssel. Lösche zuerst einen.' });
    }
    const created = createApiKey({ userId: req.user.id, name: name || '', scopes });
    res.status(201).json({ key: created });
  })
);

router.delete(
  '/dev/keys/:id',
  requireAuth,
  h(async (req, res) => {
    const ok = revokeApiKey(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Diesen API-Schlüssel gibt es nicht.' });
    res.status(204).end();
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
  h(async (req, res) => {
    const day = 86_400_000;
    const tNow = Date.now();
    // The dashboard can ask for a 7/14/30-day window for the trend charts.
    const days = Math.min(Math.max(Number(req.query.days) || 7, 7), 30);
    res.json({
      range: { days },
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
        newUsers30d: countUsersSince(tNow - 30 * day),
        messages24h: countMessagesSince(tNow - day),
        messages7d: countMessagesSince(tNow - 7 * day),
        messages30d: countMessagesSince(tNow - 30 * day),
        news: countPublishedPosts('news'),
        changelog: countPublishedPosts('changelog'),
      },
      charts: {
        usersPerDay: usersPerDay(days),
        messagesPerDay: messagesPerDay(days),
      },
      system: systemHealth(),
    });
  })
);

// Append-only audit trail of admin actions. Filter with ?q= and cap with ?limit=.
router.get(
  '/admin/audit',
  requireAdmin,
  h(async (req, res) => {
    res.json({
      entries: listAudit({ q: (req.query.q || '').toString(), limit: req.query.limit }),
    });
  })
);

function systemHealth() {
  const mem = process.memoryUsage();
  return {
    version: config.version,
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    smsProvider: config.smsProvider,
    // Whether FCM is actually configured (service-account present), not just
    // whether the token table exists.
    pushEnabled: pushEnabled(),
    pushTokens: allPushTokens().length,
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
    const { title, body, route, scheduledAt } = parse(adminBroadcastSchema, req.body);
    // Scheduled for a real point in the future → queue it for the sweep instead
    // of sending now. A timestamp in the past just falls through to "send now".
    if (scheduledAt && scheduledAt > Date.now() + 5000) {
      const row = createScheduledBroadcast({
        title: title || '',
        body,
        route: route || '',
        runAt: scheduledAt,
      });
      audit(req, 'broadcast.schedule', title || '(ohne Titel)', new Date(scheduledAt).toISOString());
      return res.status(201).json({ ok: true, scheduled: scheduledBroadcastView(row) });
    }
    const { delivered, pushed } = await dispatchBroadcast({ title, body, route });
    audit(req, 'broadcast.send', title || '(ohne Titel)', `${delivered} live · ${pushed} Push`);
    res.json({ ok: true, delivered, pushed });
  })
);

// Recent broadcasts (for the portal's "sent" history).
router.get(
  '/admin/broadcasts',
  requireAdmin,
  h(async (_req, res) => res.json({ broadcasts: listBroadcasts(30) }))
);

// Pending scheduled broadcasts (not yet fired), soonest first.
router.get(
  '/admin/scheduled-broadcasts',
  requireAdmin,
  h(async (_req, res) =>
    res.json({ scheduled: listScheduledBroadcasts().map(scheduledBroadcastView) })
  )
);

// Cancel a scheduled broadcast before it fires.
router.delete(
  '/admin/scheduled-broadcasts/:id',
  requireAdmin,
  h(async (req, res) => {
    const row = getScheduledBroadcast(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diese geplante Durchsage gibt es nicht.' });
    deleteScheduledBroadcast(req.params.id);
    audit(req, 'broadcast.cancel', row.title || '(ohne Titel)', '');
    res.status(204).end();
  })
);

// ---- Admin: status moderation ----------------------------------------------

// Every status currently visible to users (all authors), newest first.
router.get(
  '/admin/statuses',
  requireAdmin,
  h(async (_req, res) => res.json({ statuses: adminListStatuses() }))
);

// Remove a single status (abuse / mistake). Online users refresh their tab.
router.delete(
  '/admin/statuses/:id',
  requireAdmin,
  h(async (req, res) => {
    const row = getStatus(req.params.id);
    if (!row) return res.status(404).json({ error: 'Diesen Status gibt es nicht.' });
    deleteStatus(req.params.id);
    for (const id of onlineUserIds()) {
      sendToUser(id, 'status-removed', { statusId: req.params.id, userId: row.user_id });
    }
    audit(req, 'status.delete', row.user_id, row.type);
    res.status(204).end();
  })
);

// ---- Admin: newsroom + changelog (content management) ----------------------

// List posts (drafts included). Filter by ?kind=news|changelog.
router.get(
  '/admin/posts',
  requireAdmin,
  h(async (req, res) => {
    const kind = ['news', 'changelog'].includes(req.query.kind) ? req.query.kind : '';
    res.json({ posts: adminListPosts(kind) });
  })
);

router.post(
  '/admin/posts',
  requireAdmin,
  h(async (req, res) => {
    const data = parse(postCreateSchema, req.body);
    const post = createPost(data);
    audit(req, 'post.create', post.title, `${post.kind}${post.published ? ' · live' : ' · Entwurf'}`);
    res.status(201).json({ post: postView(post) });
  })
);

router.patch(
  '/admin/posts/:id',
  requireAdmin,
  h(async (req, res) => {
    if (!getPostById(req.params.id)) {
      return res.status(404).json({ error: 'Diesen Beitrag gibt es nicht.' });
    }
    const data = parse(postUpdateSchema, req.body);
    const post = updatePost(req.params.id, data);
    audit(req, 'post.update', post.title, Object.keys(data).join(', '));
    res.json({ post: postView(post) });
  })
);

router.delete(
  '/admin/posts/:id',
  requireAdmin,
  h(async (req, res) => {
    const existing = getPostById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Diesen Beitrag gibt es nicht.' });
    }
    deletePost(req.params.id);
    audit(req, 'post.delete', existing.title, existing.kind);
    res.status(204).end();
  })
);

// ---- Admin: runtime config ----
router.get(
  '/admin/config',
  requireAdmin,
  h(async (_req, res) => {
    res.json(getRemoteConfig());
  })
);

router.put(
  '/admin/config',
  requireAdmin,
  h(async (req, res) => {
    const patch = parse(remoteConfigSchema, req.body);
    const next = setRemoteConfig(patch);
    audit(req, 'config.update', '', Object.keys(patch).join(', '));
    res.json(next);
  })
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
    res.json({
      messages: adminChatMessages(req.params.id, 50),
      members: adminChatMembers(req.params.id),
    });
  })
);

router.delete(
  '/admin/chats/:id',
  requireAdmin,
  h(async (req, res) => {
    const existing = getChat(req.params.id);
    const ok = adminDeleteChat(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Diesen Chat gibt es nicht.' });
    audit(req, 'chat.delete', req.params.id, existing ? existing.type : '');
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
  h(async (req, res) => {
    const file = backupNow();
    audit(req, 'backup.create', file ? file.split('/').pop() : '', '');
    res.json({ ok: !!file, file: file ? file.split('/').pop() : null });
  })
);

// Download a single snapshot. The filename is strictly validated (see
// backupFilePath) so this can't be used to read arbitrary files.
router.get(
  '/admin/backups/:name',
  requireAdmin,
  h(async (req, res) => {
    const full = backupFilePath(req.params.name);
    if (!full) return res.status(404).json({ error: 'Backup nicht gefunden.' });
    res.download(full, req.params.name);
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
    const user = tryCreateUser(
      { phone: normalized, email, passwordHash, displayName, isAdmin: !!isAdmin },
      res
    );
    if (!user) return;
    audit(req, 'user.create', displayName, isAdmin ? 'Admin' : 'Nutzer');
    res.status(201).json({ user: adminUser(user) });
  })
);

// Detailed view of one user (activity counters, devices + online state).
router.get(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    res.json({
      user: { ...adminUser(user), online: isOnline(user.id) },
      activity: userActivity(user.id),
      devices: devicesForUser(user.id),
    });
  })
);

// Registered push devices for a user (admin device/session management).
router.get(
  '/admin/users/:id/devices',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    res.json({ devices: devicesForUser(user.id) });
  })
);

// Revoke a single device: drop its push token so it stops receiving
// notifications. The token is sent in the body so it never lands in a URL/log.
router.post(
  '/admin/users/:id/devices/revoke',
  requireAdmin,
  h(async (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    const token = (req.body && req.body.token ? String(req.body.token) : '').trim();
    if (!token) return res.status(400).json({ error: 'Kein Gerät angegeben.' });
    removeUserPushToken(user.id, token);
    audit(req, 'user.device.revoke', user.display_name, token.slice(-8));
    res.json({ ok: true, devices: devicesForUser(user.id) });
  })
);

router.patch(
  '/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    // The official "Ping Team" system account is protected — it can't be renamed,
    // demoted, banned or otherwise edited away.
    if (req.params.id === OFFICIAL_USER_ID) {
      return res.status(403).json({ error: 'Das Ping-Team-Konto ist geschützt.' });
    }
    const { displayName, password, isAdmin, email, about, disabled, premium } =
      parse(adminUpdateSchema, req.body);
    let user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    if (email !== undefined) {
      const existing = getUserByEmail(email);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: 'Diese E-Mail-Adresse wird schon verwendet.' });
      }
      user = setEmail(user.id, email);
    }
    // Track what changed so we only emit the live updates that matter. A premium
    // grant changes the public badge, so it counts as a profile change too.
    const profileChanged =
      displayName !== undefined || about !== undefined || premium !== undefined;
    const nowDisabled = disabled === true && !user.disabled;

    if (displayName !== undefined) user = setName(user.id, displayName);
    if (about !== undefined) user = setAbout(user.id, about);
    if (isAdmin !== undefined) user = setAdmin(user.id, isAdmin);
    if (disabled !== undefined) user = setDisabled(user.id, disabled);
    if (premium !== undefined) user = setPremium(user.id, premium);
    if (password !== undefined) {
      user = setPassword(user.id, await hashPassword(password));
    }

    // Make the change take effect immediately on every connected device:
    //  • profile edits (name/about) → peers refresh their cached copy,
    //  • any account change → the user's own app updates `me` live,
    //  • disabling → kick every live session so access stops at once.
    if (profileChanged) broadcastProfile(user);
    broadcastSelf(user);
    if (nowDisabled) disconnectUser(user.id, 'disabled');

    // Record exactly which fields an admin touched (never the new values).
    const changed = [];
    if (displayName !== undefined) changed.push('name');
    if (email !== undefined) changed.push('email');
    if (about !== undefined) changed.push('about');
    if (password !== undefined) changed.push('passwort');
    if (isAdmin !== undefined) changed.push(isAdmin ? '+admin' : '-admin');
    if (disabled !== undefined) changed.push(disabled ? 'gesperrt' : 'entsperrt');
    if (premium !== undefined) changed.push(premium ? '+premium' : '-premium');
    audit(req, 'user.update', user.display_name, changed.join(', '));

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
    const { title, body, route } = parse(adminBroadcastSchema, req.body);
    sendToUser(user.id, 'announcement', { title: title || 'Ping', body, route });
    const pushed = await sendPushToUsers([user.id], {
      title: title || 'Ping',
      body,
      data: { type: 'announcement', ...(route ? { route } : {}) },
    });
    audit(req, 'user.message', user.display_name, 'Banner');
    res.json({ ok: true, pushed });
  })
);

// Send a real, persisted DM to one user from the official "Ping Team" channel.
// Unlike /message (a transient popup) this lands as a normal chat message the
// user keeps — but in a read-only channel, so they can't reply.
router.post(
  '/admin/users/:id/dm',
  requireAdmin,
  h(async (req, res) => {
    ensureOfficialUser();
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    const { body } = parse(officialMessageSchema, req.body);
    const ok = deliverOfficialMessage(user.id, { body });
    audit(req, 'user.dm', user.display_name, 'Ping-Team-Chat');
    res.json({ ok });
  })
);

// Send a private one-way message to every user (WhatsApp-style broadcast): each
// user gets the message in their own read-only "Ping Team" channel.
router.post(
  '/admin/broadcast-dm',
  requireAdmin,
  h(async (req, res) => {
    ensureOfficialUser();
    const { body } = parse(officialMessageSchema, req.body);
    let delivered = 0;
    for (const id of allActiveUserIds()) {
      if (deliverOfficialMessage(id, { body })) delivered++;
    }
    recordBroadcast({ title: 'Direktnachricht', body, delivered, pushed: 0 });
    audit(req, 'broadcast.dm', 'alle', `${delivered} Nutzer`);
    res.json({ ok: true, delivered });
  })
);

// Upload media for an official status/message from the admin portal. The portal
// authenticates with the admin token (not a user JWT), so it can't use the
// user-only /uploads route — this admin-gated twin stores the file under the
// official account so it can be attached to /admin/status.
router.post(
  '/admin/upload',
  requireAdmin,
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  h(async (req, res) => {
    ensureOfficialUser();
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'Keine Datei empfangen.' });
    }
    let mime = (req.headers['content-type'] || 'application/octet-stream')
      .toString()
      .split(';')[0]
      .trim()
      .toLowerCase();
    const sniffed = sniffImage(buf);
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
    let name = null;
    const rawName = req.headers['x-filename'];
    if (rawName) {
      try {
        name = decodeURIComponent(rawName.toString()).slice(0, 200);
      } catch {
        name = rawName.toString().slice(0, 200);
      }
    }
    const meta = saveUpload({ buf, mime, name, ownerId: OFFICIAL_USER_ID });
    res.status(201).json({ upload: meta });
  })
);

// Post an official status ("story") from the Ping Team that every user sees.
router.post(
  '/admin/status',
  requireAdmin,
  h(async (req, res) => {
    ensureOfficialUser();
    const { type = 'text', body = '', attachment, bgColor } = parse(
      adminStatusSchema,
      req.body || {}
    );
    const att = attachment
      ? { ...attachment, kind: attachment.kind || (type === 'video' ? 'video' : 'image') }
      : null;
    const row = createStatus({
      userId: OFFICIAL_USER_ID,
      type,
      body: (body || '').trim(),
      attachment: att,
      bgColor: bgColor || null,
    });
    // Official statuses are visible to everyone, so nudge every connected user
    // to refresh their Status tab.
    for (const id of onlineUserIds()) {
      sendToUser(id, 'status-added', { userId: OFFICIAL_USER_ID });
    }
    audit(req, 'status.post', 'alle', type);
    res.status(201).json({ status: statusView(row, OFFICIAL_USER_ID) });
  })
);

// Export all users as CSV (for backups / GDPR / spreadsheets).
router.get(
  '/admin/users.csv',
  requireAdmin,
  h(async (_req, res) => {
    const rows = listUsers('').map((u) => adminUser(u));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const header = 'id,name,phone,email,admin,disabled,created_at,last_seen';
    const lines = rows.map((u) =>
      [u.id, u.displayName, u.phone, u.email, u.isAdmin, u.disabled, iso(u.createdAt), iso(u.lastSeen)]
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
    if (req.params.id === OFFICIAL_USER_ID) {
      return res.status(403).json({ error: 'Das Ping-Team-Konto ist geschützt.' });
    }
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Diesen Nutzer gibt es nicht.' });
    // Gather everyone who shares a chat with them before we tear the rows down,
    // so we can show their bubbles as a deleted account afterwards.
    const peers = new Set();
    for (const chat of getUserChats(user.id)) {
      for (const memberId of getMemberIds(chat.id)) {
        if (memberId !== user.id) peers.add(memberId);
      }
    }
    deleteAvatar(user.id);
    detachCreatedChats(user.id);
    deleteUser(user.id);
    // End the deleted user's sessions and let their peers refresh.
    disconnectUser(user.id, 'deleted');
    const tombstone = {
      id: user.id,
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
    audit(req, 'user.delete', user.display_name, user.email || '');
    res.status(204).end();
  })
);
