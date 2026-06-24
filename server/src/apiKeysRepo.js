import crypto from 'node:crypto';
import { db, now, safeJson } from './db.js';
import { uid } from './repo.js';

// ---- Developer API keys ----------------------------------------------------
//
// External integrations talk to /api/v1 with a secret bearer token instead of a
// user's session JWT. A key is minted for, and acts on behalf of, one Ping
// account (the developer's own). We only ever persist a sha256 hash of the
// secret, so a database leak can't be replayed as a working key — the plaintext
// is returned exactly once, at creation time.

// The scopes a key can be granted. Keep this list short and meaningful; the
// docs page mirrors it.
export const API_SCOPES = Object.freeze([
  'profile', // read the key owner's own identity
  'chats:read', // list chats and read message history
  'messages:write', // send messages and open direct chats
]);

// A new key gets the common read+write set unless the caller narrows it.
export const DEFAULT_SCOPES = Object.freeze([
  'profile',
  'chats:read',
  'messages:write',
]);

// Every secret starts with this so it's recognisable in logs/config and so we
// can cheaply reject obviously-wrong tokens before hashing.
const KEY_PREFIX = 'ping_sk_';

const hashKey = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

const s = {
  insert: db.prepare(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  byHash: db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL'),
  byUser: db.prepare(
    'SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
  ),
  byId: db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ? AND revoked_at IS NULL'),
  touch: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
  revoke: db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ?'),
};

// Drop scopes we don't recognise; fall back to the default set when nothing
// valid is left, so a key is never created with zero usable permissions.
function sanitizeScopes(scopes) {
  const wanted = Array.isArray(scopes) ? scopes : [];
  const valid = [...new Set(wanted)].filter((sc) => API_SCOPES.includes(sc));
  return valid.length ? valid : [...DEFAULT_SCOPES];
}

// The owner-facing shape: never includes the secret or its hash.
export function apiKeyView(row) {
  return {
    id: row.id,
    name: row.name || '',
    // e.g. "ping_sk_a1b2…" — enough to recognise the key, useless on its own.
    prefix: row.prefix,
    scopes: safeJson(row.scopes, []),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

// Mint a key for [userId]. Returns the owner view *plus* the one-time plaintext
// secret under `key` — surface it to the caller and never store it.
export function createApiKey({ userId, name = '', scopes }) {
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const id = uid();
  const prefix = secret.slice(0, KEY_PREFIX.length + 4) + '…';
  const scopeList = sanitizeScopes(scopes);
  s.insert.run(id, userId, name.trim().slice(0, 60), prefix, hashKey(secret), JSON.stringify(scopeList), now());
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  return { ...apiKeyView(row), key: secret };
}

export function listApiKeys(userId) {
  return s.byUser.all(userId).map(apiKeyView);
}

// Soft-revoke: the key stops authenticating immediately but the row stays for an
// audit trail. Returns true when a live key was actually revoked.
export function revokeApiKey(userId, id) {
  const info = s.revoke.run(now(), id, userId);
  return info.changes > 0;
}

// Resolve a presented secret to its key row, or null. Records last_used_at at
// most once a minute to avoid a write on every single API request.
export function lookupApiKey(secret) {
  if (typeof secret !== 'string' || !secret.startsWith(KEY_PREFIX)) return null;
  const row = s.byHash.get(hashKey(secret));
  if (!row) return null;
  const ts = now();
  if (!row.last_used_at || ts - row.last_used_at > 60_000) {
    s.touch.run(ts, row.id);
    row.last_used_at = ts;
  }
  return { ...row, scopeList: safeJson(row.scopes, []) };
}
