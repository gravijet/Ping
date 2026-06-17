import { Router } from 'express';
import { config } from './config.js';
import { lookupApiKey } from './apiKeysRepo.js';
import { parse, apiSendSchema, apiDirectSchema } from './validation.js';
import { normalizePhone } from './phone.js';
import {
  getUserById,
  getUserByPhone,
  getUserByEmail,
  publicUser,
  hasBlocked,
  OFFICIAL_USER_ID,
} from './repo.js';
import {
  getOrCreateDirectChat,
  getChat,
  isMember,
  getMemberIds,
  getUserChats,
  chatView,
  createMessage,
  getMessage,
  getHistory,
  messageView,
  setChatLocked,
} from './chatRepo.js';
import { kindForMime } from './uploads.js';
import { sendToUser } from './hub.js';
import { pushMessage } from './deliver.js';

// =============================================================================
// Public developer API — /api/v1
//
// A stable, documented surface for external integrations. It authenticates with
// a developer API key (Authorization: Bearer ping_sk_… or X-API-Key) rather
// than a user session JWT, and every request acts on behalf of the Ping account
// the key was minted for. The handlers deliberately reuse the same repositories
// and live-delivery primitives as the in-app routes, so a message sent through
// the API is indistinguishable from one sent by the app: it persists, fans out
// over WebSocket and triggers push notifications.
//
// Errors here speak English (the audience is developers) and always come back as
// { error: "…" } with a meaningful HTTP status — unlike the German, end-user
// facing copy in routes.js.
// =============================================================================

export const apiV1 = Router();

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Authentication --------------------------------------------------------

// Resolve the bearer token (or X-API-Key) to a key + its owning account.
function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const alt = (req.headers['x-api-key'] || '').toString().trim();
  const secret = bearer || alt;
  if (!secret) {
    return res
      .status(401)
      .json({ error: 'Missing API key. Send it as "Authorization: Bearer <key>".' });
  }
  const key = lookupApiKey(secret);
  if (!key) {
    return res.status(401).json({ error: 'Invalid or revoked API key.' });
  }
  const user = getUserById(key.user_id);
  if (!user) {
    return res.status(401).json({ error: 'The account behind this key no longer exists.' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: 'The account behind this key is disabled.' });
  }
  req.user = user;
  req.apiKey = key;
  next();
}

// Gate an endpoint behind a granted scope.
const requireScope = (scope) => (req, res, next) => {
  if (req.apiKey?.scopeList?.includes(scope)) return next();
  return res
    .status(403)
    .json({ error: `This API key is missing the required scope "${scope}".` });
};

apiV1.use(requireApiKey);

// ---- Identity --------------------------------------------------------------

// The account this key acts as. Includes the (private) phone number so an
// integration can confirm which identity it is wired up to.
apiV1.get(
  '/me',
  requireScope('profile'),
  h(async (req, res) => {
    res.json({ user: { ...publicUser(req.user), phone: req.user.phone } });
  })
);

// ---- Chats -----------------------------------------------------------------

// Must belong to the chat in :id. Mirrors routes.js's memberGuard but with an
// English, developer-facing error.
function memberGuard(req, res, next) {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'No such chat.' });
  if (!isMember(chat.id, req.user.id)) {
    return res.status(403).json({ error: 'This API key cannot access that chat.' });
  }
  req.chat = chat;
  next();
}

apiV1.get(
  '/chats',
  requireScope('chats:read'),
  h(async (req, res) => {
    // Everyone always has a "note to self" chat available by default.
    getOrCreateDirectChat(req.user.id, req.user.id);
    const chats = getUserChats(req.user.id)
      .map((c) => chatView(c, req.user.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ chats });
  })
);

apiV1.get(
  '/chats/:id',
  requireScope('chats:read'),
  memberGuard,
  h(async (req, res) => {
    res.json({ chat: chatView(req.chat, req.user.id) });
  })
);

apiV1.get(
  '/chats/:id/messages',
  requireScope('chats:read'),
  memberGuard,
  h(async (req, res) => {
    const beforeRaw = Number(req.query.before);
    const limitRaw = Number(req.query.limit);
    const before = Number.isFinite(beforeRaw) ? beforeRaw : undefined;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 40;
    const messages = getHistory(req.chat.id, { before, limit, viewerId: req.user.id }).map((m) =>
      messageView(m, req.user.id)
    );
    res.json({ messages });
  })
);

// Persist a message into [chat] from [user] and deliver it exactly like the app
// route does: live fan-out to every member's sockets plus push to the offline
// ones. Writes the response and returns true on success, false (after writing an
// error) when the chat is read-only or blocked.
function deliver(req, res, chat, payload) {
  if (chat.locked) {
    res.status(403).json({ error: 'This chat is read-only.' });
    return false;
  }
  const { body, type = 'text', attachment, replyTo: replyRaw } = payload;
  const replyTo = replyRaw ? replyRaw.toString() : null;
  if (replyTo) {
    const target = getMessage(replyTo);
    if (!target || target.chat_id !== chat.id) {
      res.status(400).json({ error: 'The quoted message does not belong to this chat.' });
      return false;
    }
  }
  if (chat.type === 'direct') {
    const otherId = getMemberIds(chat.id).find((mId) => mId !== req.user.id);
    if (otherId && hasBlocked(otherId, req.user.id)) {
      res.status(403).json({ error: 'You cannot message this person right now.' });
      return false;
    }
    if (otherId && hasBlocked(req.user.id, otherId)) {
      res.status(403).json({ error: 'You have blocked this person.' });
      return false;
    }
  }
  const att = attachment
    ? { ...attachment, kind: attachment.kind || kindForMime(attachment.mime || '', attachment.name || '') }
    : null;
  const seconds = chat.expire_seconds || 0;
  const msg = createMessage({
    chatId: chat.id,
    senderId: req.user.id,
    type,
    body: (body || '').trim(),
    attachment: att,
    replyTo,
    expiresAt: seconds > 0 ? Date.now() + seconds * 1000 : null,
  });
  for (const memberId of getMemberIds(chat.id)) {
    sendToUser(memberId, 'message', { message: messageView(msg, memberId) });
  }
  pushMessage(chat, msg, req.user.id);
  res.status(201).json({ message: messageView(msg, req.user.id) });
  return true;
}

apiV1.post(
  '/chats/:id/messages',
  requireScope('messages:write'),
  memberGuard,
  h(async (req, res) => {
    deliver(req, res, req.chat, parse(apiSendSchema, req.body || {}));
  })
);

// Open (or reopen) a direct chat with a user, addressed by id, phone or email.
// Idempotent — returns the existing chat when one is already open.
apiV1.post(
  '/chats/direct',
  requireScope('messages:write'),
  h(async (req, res) => {
    const other = resolveRecipient(parse(apiDirectSchema, req.body || {}));
    if (!other) return res.status(404).json({ error: 'No Ping user matches that identifier.' });
    const chat = getOrCreateDirectChat(req.user.id, other.id);
    if (other.id === OFFICIAL_USER_ID && !chat.locked) {
      setChatLocked(chat.id, true);
      chat.locked = 1;
    }
    sendToUser(other.id, 'chat-created', { chat: chatView(chat, other.id) });
    res.status(201).json({ chat: chatView(chat, req.user.id) });
  })
);

// Convenience: open the direct chat with `to` (id / phone / email) and post a
// message in one call — the common "send me/someone a message" integration.
apiV1.post(
  '/messages',
  requireScope('messages:write'),
  h(async (req, res) => {
    const payload = parse(apiSendSchema, req.body || {});
    const other = resolveRecipient({ to: payload.to });
    if (!other) return res.status(404).json({ error: 'No Ping user matches "to".' });
    const chat = getOrCreateDirectChat(req.user.id, other.id);
    if (other.id === OFFICIAL_USER_ID && !chat.locked) {
      setChatLocked(chat.id, true);
      chat.locked = 1;
    }
    // Make sure the chat exists on the recipient's device before the message.
    sendToUser(other.id, 'chat-created', { chat: chatView(chat, other.id) });
    deliver(req, res, getChat(chat.id), payload);
  })
);

// Map a { to } / { userId, phone, email } identifier to a user row, or null.
function resolveRecipient({ to, userId, phone, email } = {}) {
  const raw = (to ?? '').toString().trim();
  // A `to` value can be a user id, a phone number or an email; try each.
  if (raw) {
    const byId = getUserById(raw);
    if (byId) return byId;
    const n = normalizePhone(raw);
    if (n) {
      const byPhone = getUserByPhone(n);
      if (byPhone) return byPhone;
    }
    if (raw.includes('@')) {
      const byEmail = getUserByEmail(raw);
      if (byEmail) return byEmail;
    }
    return null;
  }
  if (userId) {
    const u = getUserById(userId.toString());
    if (u) return u;
  }
  if (phone) {
    const n = normalizePhone(phone.toString());
    if (n) {
      const u = getUserByPhone(n);
      if (u) return u;
    }
  }
  if (email) {
    const u = getUserByEmail(email.toString());
    if (u) return u;
  }
  return null;
}

// Surface the configured public base URL so docs/clients can self-describe.
apiV1.get(
  '/',
  h(async (_req, res) => {
    res.json({
      name: 'Ping Developer API',
      version: 'v1',
      docs: `${config.publicUrl}/api`,
    });
  })
);

// Unknown /api/v1 path — answer in English (and JSON) rather than falling
// through to the app's German end-user 404.
apiV1.use((_req, res) => res.status(404).json({ error: 'No such API endpoint.' }));
