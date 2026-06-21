import { randomBytes } from 'node:crypto';
import { db, now } from './db.js';
import { uid } from './repo.js';

// Webhooks / bots (0.34.0). An incoming webhook lets an external service post a
// message into a chat by POSTing to /api/hooks/<token>; an outgoing webhook
// mirrors chat messages to an external URL. Tokens are URL-safe secrets; the
// token is shown once on creation and never echoed in listings.

const s = {
  insert: db.prepare(`
    INSERT INTO webhooks (id, chat_id, owner_id, name, token, direction, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM webhooks WHERE id = ?'),
  byToken: db.prepare("SELECT * FROM webhooks WHERE token = ? AND revoked_at IS NULL AND direction = 'in'"),
  forChat: db.prepare('SELECT * FROM webhooks WHERE chat_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'),
  outForChat: db.prepare("SELECT * FROM webhooks WHERE chat_id = ? AND revoked_at IS NULL AND direction = 'out'"),
  revoke: db.prepare('UPDATE webhooks SET revoked_at = ? WHERE id = ?'),
  touch: db.prepare('UPDATE webhooks SET last_used_at = ? WHERE id = ?'),
};

const newToken = () => randomBytes(24).toString('base64url');

export function createWebhook({ chatId, ownerId, name, direction = 'in', url = null }) {
  const id = uid();
  const token = newToken();
  s.insert.run(id, chatId, ownerId, name, token, direction, url, now());
  // The plaintext token is returned exactly once.
  return { ...webhookView(s.byId.get(id)), token };
}

export const getWebhookByToken = (token) => s.byToken.get(token);
export const getWebhook = (id) => s.byId.get(id);
export const touchWebhook = (id) => s.touch.run(now(), id);
export const outgoingWebhooksFor = (chatId) => s.outForChat.all(chatId);

export function revokeWebhook(id) {
  s.revoke.run(now(), id);
}

export function webhookView(w) {
  return {
    id: w.id,
    name: w.name,
    direction: w.direction,
    url: w.url || null,
    createdAt: w.created_at,
    lastUsedAt: w.last_used_at || null,
  };
}

export const listWebhooks = (chatId) => s.forChat.all(chatId).map(webhookView);
