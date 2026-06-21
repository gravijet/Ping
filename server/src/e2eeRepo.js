import { db, now } from './db.js';

// Opt-in E2EE for DMs (0.34.0). The server is deliberately "blind": it only
// stores each user's *public* identity key and a per-chat enabled flag. Private
// keys never leave the device; message bodies for an encrypted chat are
// ciphertext the server can't read (enc=1). The safety number both sides compare
// is derived from the two public keys on the client — the server just hands them
// out.

const s = {
  upsertIdentity: db.prepare(`
    INSERT INTO e2ee_identities (user_id, public_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, updated_at = excluded.updated_at`),
  identity: db.prepare('SELECT * FROM e2ee_identities WHERE user_id = ?'),
  setSession: db.prepare(`
    INSERT INTO e2ee_sessions (chat_id, enabled, enabled_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET enabled = excluded.enabled, enabled_by = excluded.enabled_by, updated_at = excluded.updated_at`),
  session: db.prepare('SELECT * FROM e2ee_sessions WHERE chat_id = ?'),
};

export function publishIdentity(userId, publicKey) {
  s.upsertIdentity.run(userId, publicKey, now(), now());
  return { publicKey, updatedAt: now() };
}

export const getIdentity = (userId) => {
  const row = s.identity.get(userId);
  return row ? { userId, publicKey: row.public_key, updatedAt: row.updated_at } : null;
};

export function setSessionEnabled(chatId, enabled, byUserId) {
  s.setSession.run(chatId, enabled ? 1 : 0, byUserId, now());
  return isSessionEnabled(chatId);
}

export function isSessionEnabled(chatId) {
  const row = s.session.get(chatId);
  return !!row && !!row.enabled;
}

export function sessionView(chatId) {
  const row = s.session.get(chatId);
  return {
    enabled: !!row?.enabled,
    enabledBy: row?.enabled_by || null,
    updatedAt: row?.updated_at || null,
  };
}
