import crypto from 'node:crypto';
import { db, now } from './db.js';

export function uid() {
  return crypto.randomUUID();
}

// A small palette of vibrant Material colors used for auto-generated avatars.
const AVATAR_COLORS = [
  '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
  '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
  '#9CCC65', '#FFA726', '#FF7043', '#8D6E63', '#78909C',
];

export function pickAvatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ---- Users -----------------------------------------------------------------

const stmts = {
  insertUser: db.prepare(`
    INSERT INTO users (id, username, username_lc, display_name, password_hash,
                       avatar_color, about, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`),
  userByUsernameLc: db.prepare('SELECT * FROM users WHERE username_lc = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  touchSeen: db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),
  updateProfile: db.prepare(
    'UPDATE users SET display_name = ?, about = ?, avatar_color = ? WHERE id = ?'
  ),
  searchUsers: db.prepare(`
    SELECT * FROM users
    WHERE username_lc LIKE ? AND id != ?
    ORDER BY username_lc LIMIT 25`),
};

export function createUser({ username, displayName, passwordHash }) {
  const id = uid();
  const ts = now();
  stmts.insertUser.run(
    id,
    username,
    username.toLowerCase(),
    displayName || username,
    passwordHash,
    pickAvatarColor(username.toLowerCase()),
    ts,
    ts
  );
  return stmts.userById.get(id);
}

export const getUserByUsername = (u) => stmts.userByUsernameLc.get(u.toLowerCase());
export const getUserById = (id) => stmts.userById.get(id);
export const touchLastSeen = (id) => stmts.touchSeen.run(now(), id);

export function updateProfile(id, { displayName, about, avatarColor }) {
  const u = stmts.userById.get(id);
  if (!u) return null;
  stmts.updateProfile.run(
    displayName ?? u.display_name,
    about ?? u.about,
    avatarColor ?? u.avatar_color,
    id
  );
  return stmts.userById.get(id);
}

export function searchUsers(query, exceptId) {
  const like = `%${query.toLowerCase().replace(/[%_]/g, '\\$&')}%`;
  return stmts.searchUsers.all(like, exceptId);
}

// Strip secrets before sending a user over the wire.
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    about: u.about,
    lastSeen: u.last_seen,
  };
}

// ---- Contacts --------------------------------------------------------------

const contactStmts = {
  add: db.prepare(
    'INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)'
  ),
  remove: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),
  list: db.prepare(`
    SELECT u.* FROM contacts c JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? ORDER BY u.display_name COLLATE NOCASE`),
};

export const addContact = (userId, contactId) =>
  contactStmts.add.run(userId, contactId, now());
export const removeContact = (userId, contactId) =>
  contactStmts.remove.run(userId, contactId);
export const listContacts = (userId) => contactStmts.list.all(userId);
