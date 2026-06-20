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

// ---- Official "Ping Team" account ------------------------------------------

// A fixed system account used as the sender of official admin messages and
// broadcasts (so they appear as a real, named "Ping Team" chat rather than an
// anonymous popup). It is never a real login: its phone is an unreachable
// sentinel (E.164 can't start with 0) and its password hash matches nothing.
export const OFFICIAL_USER_ID = 'ping-official';
const OFFICIAL_PHONE = '+000000000000';

// Create the official account once if it's missing. Idempotent and cheap, so it
// is safe to call on every server start.
export function ensureOfficialUser() {
  const existing = stmts.userById.get(OFFICIAL_USER_ID);
  if (existing) return existing;
  const ts = now();
  try {
    stmts.insertUserWithId.run(
      OFFICIAL_USER_ID,
      OFFICIAL_PHONE,
      'user@example.invalid',
      'user@example.invalid',
      // A random, non-bcrypt hash — bcrypt.compare against it always returns false.
      crypto.randomBytes(24).toString('hex'),
      'Ping Team',
      '#5C6BC0',
      'Offizielle Mitteilungen',
      1,
      ts,
      ts
    );
  } catch (e) {
    // A lost race or a pre-existing row with the reserved email/phone — never let
    // this stop the server from booting. Fall back to whatever exists.
    console.error('[official-user] konnte Ping-Team-Konto nicht anlegen:', e.message);
  }
  return stmts.userById.get(OFFICIAL_USER_ID);
}

// ---- Users -----------------------------------------------------------------

const stmts = {
  insertUser: db.prepare(`
    INSERT INTO users
      (id, phone, email, email_lc, password_hash, display_name, avatar_color,
       about, is_admin, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`),
  // Like insertUser but with an explicit id + about — used for the fixed
  // official "Ping Team" system account.
  insertUserWithId: db.prepare(`
    INSERT INTO users
      (id, phone, email, email_lc, password_hash, display_name, avatar_color,
       about, is_admin, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
  userByEmailLc: db.prepare('SELECT * FROM users WHERE email_lc = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  touchSeen: db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),
  updateProfile: db.prepare(
    'UPDATE users SET display_name = ?, about = ?, avatar_color = ? WHERE id = ?'
  ),
  setAvatar: db.prepare(
    'UPDATE users SET avatar_mime = ?, avatar_version = avatar_version + 1 WHERE id = ?'
  ),
  setEmail: db.prepare('UPDATE users SET email = ?, email_lc = ? WHERE id = ?'),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  setName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
  setMessageStorage: db.prepare('UPDATE users SET message_storage = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  // The official "Ping Team" system account is hidden from user counts and
  // listings — it isn't a real person.
  count: db.prepare("SELECT COUNT(*) AS n FROM users WHERE id != 'ping-official'"),
  allUsers: db.prepare(
    "SELECT * FROM users WHERE id != 'ping-official' ORDER BY created_at DESC LIMIT 500"
  ),
  searchAdmin: db.prepare(`
    SELECT * FROM users
    WHERE id != 'ping-official'
      AND (LOWER(display_name) LIKE ? ESCAPE '\\'
        OR LOWER(email) LIKE ? ESCAPE '\\'
        OR phone LIKE ? ESCAPE '\\')
    ORDER BY created_at DESC LIMIT 500`),
};

export function createUser({ phone, email, passwordHash, displayName, isAdmin = false }) {
  const id = uid();
  const ts = now();
  stmts.insertUser.run(
    id,
    phone,
    email,
    email.toLowerCase(),
    passwordHash,
    (displayName && displayName.trim()) || phone,
    pickAvatarColor(phone),
    isAdmin ? 1 : 0,
    ts,
    ts
  );
  return stmts.userById.get(id);
}

export const getUserByPhone = (phone) => stmts.userByPhone.get(phone);
export const getUserByEmail = (email) =>
  email ? stmts.userByEmailLc.get(email.toLowerCase()) : undefined;
export const getUserById = (id) => stmts.userById.get(id);
export const touchLastSeen = (id) => stmts.touchSeen.run(now(), id);

// Maps a camelCase profile field to its users-table column. Only keys listed
// here can be written through updateProfile, so a client can never set columns
// like is_admin or password_hash by smuggling extra keys past validation.
const PROFILE_COLUMNS = {
  displayName: 'display_name',
  about: 'about',
  avatarColor: 'avatar_color',
  accentColor: 'accent_color',
  pronouns: 'pronouns',
  birthday: 'birthday',
  city: 'city',
  moodEmoji: 'mood_emoji',
  moodText: 'mood_text',
  moodUntil: 'mood_until',
};

export function updateProfile(id, patch = {}) {
  const u = stmts.userById.get(id);
  if (!u) return null;
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    // accent_color and mood_until are nullable; everything else is text.
    params.push(patch[key] === null ? null : patch[key]);
  }
  // Links arrive as an array of { label, url } and are stored as JSON text.
  if (patch.links !== undefined) {
    sets.push('links = ?');
    params.push(Array.isArray(patch.links) ? JSON.stringify(patch.links) : '');
  }
  if (sets.length === 0) return u;
  params.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return stmts.userById.get(id);
}

export function setAvatar(id, mime) {
  stmts.setAvatar.run(mime, id);
  return stmts.userById.get(id);
}

// Set/clear the profile background image; bumps banner_version to bust caches.
export function setBanner(id, mime) {
  db.prepare(
    'UPDATE users SET banner_mime = ?, banner_version = banner_version + 1 WHERE id = ?'
  ).run(mime, id);
  return stmts.userById.get(id);
}

export function setEmail(id, email) {
  stmts.setEmail.run(email, email.toLowerCase(), id);
  return stmts.userById.get(id);
}

export function setPassword(id, passwordHash) {
  stmts.setPassword.run(passwordHash, id);
  return stmts.userById.get(id);
}

export function setAdmin(id, isAdmin) {
  stmts.setAdmin.run(isAdmin ? 1 : 0, id);
  return stmts.userById.get(id);
}

export function setName(id, displayName) {
  stmts.setName.run(displayName, id);
  return stmts.userById.get(id);
}

export function setMessageStorage(id, mode) {
  stmts.setMessageStorage.run(mode, id);
  return stmts.userById.get(id);
}

/** A user's message storage preference: 'server' (default) or 'local'. */
export function getMessageStorage(id) {
  const u = stmts.userById.get(id);
  return u?.message_storage || 'server';
}

export const deleteUser = (id) => stmts.deleteUser.run(id);
export const countUsers = () => stmts.count.get().n;

// Every real, active user id — used to fan an official broadcast DM out to the
// whole user base. Excludes the official account itself and disabled accounts.
const allActiveIdsStmt = db.prepare(
  "SELECT id FROM users WHERE id != 'ping-official' AND disabled = 0"
);
export const allActiveUserIds = () => allActiveIdsStmt.all().map((r) => r.id);

// Aggregate counters for the admin dashboard.
const adminStats = {
  chats: db.prepare('SELECT COUNT(*) AS n FROM chats'),
  groups: db.prepare("SELECT COUNT(*) AS n FROM chats WHERE type = 'group'"),
  messages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL'),
  statuses: db.prepare('SELECT COUNT(*) AS n FROM statuses WHERE expires_at > ?'),
  admins: db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != 'ping-official'"
  ),
};
export const countChats = () => adminStats.chats.get().n;
export const countGroups = () => adminStats.groups.get().n;
export const countMessages = () => adminStats.messages.get().n;
export const countActiveStatuses = () => adminStats.statuses.get(now()).n;
export const countAdmins = () => adminStats.admins.get().n;
export const listUsers = (q) => {
  if (q && q.trim()) {
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    return stmts.searchAdmin.all(like, like, like);
  }
  return stmts.allUsers.all();
};

export function setAbout(id, about) {
  db.prepare('UPDATE users SET about = ? WHERE id = ?').run(about, id);
  return stmts.userById.get(id);
}

export function setDisabled(id, disabled) {
  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  return stmts.userById.get(id);
}

/** Ping Premium: grant or revoke the premium badge (admin only). */
export function setPremium(id, premium) {
  db.prepare('UPDATE users SET premium = ? WHERE id = ?').run(premium ? 1 : 0, id);
  return stmts.userById.get(id);
}

/** Privacy: whether other people may see this user's "zuletzt online". */
export function setShowLastSeen(id, show) {
  db.prepare('UPDATE users SET show_last_seen = ? WHERE id = ?').run(show ? 1 : 0, id);
  return stmts.userById.get(id);
}

// ---- Identität & Schutz (0.32.0): usernames, privacy, sessions -------------

// Handles a user can never claim: reserved routes/words that would be confusing
// or impersonating. Compared case-insensitively against the lowercased handle.
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'ping', 'pingteam', 'ping-team', 'official', 'support',
  'help', 'team', 'system', 'root', 'me', 'self', 'you', 'null', 'undefined',
  'settings', 'account', 'login', 'logout', 'register', 'auth', 'api', 'about',
  'channel', 'channels', 'group', 'groups', 'chat', 'chats', 'user', 'users',
  'everyone', 'all', 'mod', 'moderator', 'staff', 'verified', 'premium',
]);

/** Whether [name] (already lowercased) is on the reserved list. */
export const isReservedUsername = (name) => RESERVED_USERNAMES.has(String(name || '').toLowerCase());

const identityStmts = {
  byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
  setUsernameSearchable: db.prepare('UPDATE users SET username_searchable = ? WHERE id = ?'),
  setPrivacyMessages: db.prepare('UPDATE users SET privacy_messages = ? WHERE id = ?'),
  setPrivacyGroups: db.prepare('UPDATE users SET privacy_groups = ? WHERE id = ?'),
  bumpEpoch: db.prepare('UPDATE users SET token_epoch = token_epoch + 1 WHERE id = ?'),
  // People directory: exact-username matches first, then name prefix matches.
  // Username matches honour the per-user "discoverable" switch; name matches are
  // always allowed (a name was never private). Self + official excluded by route.
  search: db.prepare(`
    SELECT * FROM users
    WHERE id != 'ping-official' AND disabled = 0
      AND (
        (username IS NOT NULL AND username_searchable = 1 AND username LIKE ? ESCAPE '\\')
        OR LOWER(display_name) LIKE ? ESCAPE '\\'
      )
    ORDER BY (username = ?) DESC, LENGTH(display_name) ASC, display_name COLLATE NOCASE
    LIMIT 30`),
};

/** Look up a user by their exact (lowercased) @username. */
export const getUserByUsername = (name) =>
  name ? identityStmts.byUsername.get(String(name).toLowerCase()) : undefined;

/** Whether [name] is free to claim by [exceptId] (its current owner may re-set it). */
export function isUsernameAvailable(name, exceptId = null) {
  const lc = String(name || '').toLowerCase();
  if (isReservedUsername(lc)) return false;
  const owner = identityStmts.byUsername.get(lc);
  return !owner || owner.id === exceptId;
}

/** Claim/replace (or clear, with null) the caller's username. Returns the row. */
export function setUsername(id, name) {
  identityStmts.setUsername.run(name ? String(name).toLowerCase() : null, id);
  return stmts.userById.get(id);
}

export function setUsernameSearchable(id, on) {
  identityStmts.setUsernameSearchable.run(on ? 1 : 0, id);
  return stmts.userById.get(id);
}

/** Set a privacy axis. [axis] is 'messages' or 'groups'; [value] 'everyone'|'contacts'. */
export function setPrivacy(id, axis, value) {
  const v = value === 'contacts' ? 'contacts' : 'everyone';
  if (axis === 'messages') identityStmts.setPrivacyMessages.run(v, id);
  else if (axis === 'groups') identityStmts.setPrivacyGroups.run(v, id);
  return stmts.userById.get(id);
}

/** Invalidate every existing session token for [id] ("überall abmelden"). */
export function bumpTokenEpoch(id) {
  identityStmts.bumpEpoch.run(id);
  return stmts.userById.get(id);
}

/** Search people by @username or display-name prefix for the people directory. */
export function searchPeople(q) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return [];
  const handle = term.replace(/^@+/, '');
  const esc = handle.replace(/[\\%_]/g, '\\$&');
  return identityStmts.search.all(`${esc}%`, `%${esc}%`, handle);
}

// ---- Admin analytics -------------------------------------------------------

const analytics = {
  usersSince: db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?'),
  usersBetween: db.prepare(
    'SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?'
  ),
  msgsSince: db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND deleted_at IS NULL'
  ),
  msgsBetween: db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND created_at < ? AND deleted_at IS NULL'
  ),
  pushTokens: db.prepare('SELECT COUNT(*) AS n FROM push_tokens'),
  blocks: db.prepare('SELECT COUNT(*) AS n FROM blocks'),
  uploads: db.prepare('SELECT COUNT(*) AS n FROM uploads'),
  uploadBytes: db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM uploads'),
  msgsByUser: db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND deleted_at IS NULL'
  ),
  chatsByUser: db.prepare(
    'SELECT COUNT(*) AS n FROM chat_members WHERE user_id = ?'
  ),
};

export const countUsersSince = (ts) => analytics.usersSince.get(ts).n;
export const countMessagesSince = (ts) => analytics.msgsSince.get(ts).n;
export const countPushTokens = () => analytics.pushTokens.get().n;
export const countBlocks = () => analytics.blocks.get().n;
export const countUploads = () => analytics.uploads.get().n;
export const totalUploadBytes = () => analytics.uploadBytes.get().n;

function startOfTodayUtc() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Daily buckets (oldest → newest) for the dashboard sparkline charts.
function perDay(stmt, days) {
  const dayMs = 86_400_000;
  const start = startOfTodayUtc();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = start - i * dayMs;
    out.push({ day: from, n: stmt.get(from, from + dayMs).n });
  }
  return out;
}
export const usersPerDay = (days = 7) => perDay(analytics.usersBetween, days);
export const messagesPerDay = (days = 7) => perDay(analytics.msgsBetween, days);

// Per-user activity summary for the admin user detail view.
export function userActivity(id) {
  return {
    messages: analytics.msgsByUser.get(id).n,
    chats: analytics.chatsByUser.get(id).n,
  };
}

// ---- Admin broadcast history ----------------------------------------------

const broadcastStmts = {
  insert: db.prepare(`
    INSERT INTO broadcasts (id, title, body, delivered, pushed, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  list: db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?'),
};

export function recordBroadcast({ title = '', body, delivered = 0, pushed = 0 }) {
  broadcastStmts.insert.run(uid(), title, body, delivered, pushed, now());
}
export const listBroadcasts = (limit = 30) =>
  broadcastStmts.list.all(limit).map((b) => ({
    id: b.id,
    title: b.title,
    body: b.body,
    delivered: b.delivered,
    pushed: b.pushed,
    createdAt: b.created_at,
  }));

// Privacy: match a batch of normalized phones / lowercased emails against
// registered users. Nothing is stored — this only runs in memory for this call.
export function matchContacts(phones, emails, exceptId) {
  const ph = [...new Set((phones || []).filter(Boolean))];
  const em = [...new Set((emails || []).map((e) => e.toLowerCase()).filter(Boolean))];
  if (ph.length === 0 && em.length === 0) return [];
  const clauses = [];
  const params = [exceptId];
  if (ph.length) {
    clauses.push(`phone IN (${ph.map(() => '?').join(',')})`);
    params.push(...ph);
  }
  if (em.length) {
    clauses.push(`email_lc IN (${em.map(() => '?').join(',')})`);
    params.push(...em);
  }
  const sql = `SELECT * FROM users WHERE id != ? AND (${clauses.join(' OR ')})`;
  return db.prepare(sql).all(...params);
}

// ---- Serialisation ---------------------------------------------------------

// Parse the stored links JSON into a clean array of { label, url }. Tolerates
// legacy/empty/garbage values (returns []).
export function parseLinks(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((l) => l && typeof l.url === 'string' && l.url.trim())
      .slice(0, 6)
      .map((l) => ({ label: (l.label || '').toString(), url: l.url.toString() }));
  } catch {
    return [];
  }
}

// The mood is temporary: once mood_until has passed it reads as cleared. Done
// lazily here so there's no background sweep to keep moods fresh.
function liveMood(u) {
  const expired = u.mood_until && u.mood_until <= now();
  if (expired || (!u.mood_emoji && !u.mood_text)) {
    return { emoji: '', text: '', until: null };
  }
  return {
    emoji: u.mood_emoji || '',
    text: u.mood_text || '',
    until: u.mood_until || null,
  };
}

// What anyone may see: name, avatar, presence. Never the phone or email — you
// can only reach people you already know (via contacts or exact lookup).
export function publicUser(u) {
  if (!u) return null;
  const official = u.id === OFFICIAL_USER_ID;
  const mood = liveMood(u);
  return {
    id: u.id,
    displayName: u.display_name,
    // Public @username (null until claimed) — powers /u/<name> deep links.
    username: u.username || null,
    avatarColor: u.avatar_color,
    // A personal accent colour (null when the user hasn't picked one).
    accentColor: u.accent_color || null,
    about: u.about,
    hasAvatar: !!u.avatar_mime,
    avatarVersion: u.avatar_version,
    // Rich profile fields shown on the profile page.
    hasBanner: !!u.banner_mime,
    bannerVersion: u.banner_version || 0,
    pronouns: u.pronouns || '',
    birthday: u.birthday || '',
    city: u.city || '',
    links: parseLinks(u.links),
    moodEmoji: mood.emoji,
    moodText: mood.text,
    moodUntil: mood.until,
    // Trust badges, surfaced next to the name across the app:
    //  • official → the unmistakable "Ping Team" seal (system account),
    //  • verified → a blue check for Ping staff/admins,
    //  • premium  → a gold badge for Ping Premium members.
    official,
    verified: !official && !!u.is_admin,
    premium: !!u.premium,
    // Hidden when the user turned "zuletzt online" off in their privacy
    // settings (the column may be missing on rows from very old exports).
    lastSeen: u.show_last_seen === 0 ? null : u.last_seen,
  };
}

// The richer view of your *own* account.
export function privateUser(u) {
  if (!u) return null;
  return {
    ...publicUser(u),
    // You always see your own last_seen, regardless of the privacy setting.
    lastSeen: u.last_seen,
    phone: u.phone,
    email: u.email,
    isAdmin: !!u.is_admin,
    messageStorage: u.message_storage || 'server',
    showLastSeen: u.show_last_seen !== 0,
    // Privacy controls (0.32.0). 'everyone' | 'contacts'.
    privacyMessages: u.privacy_messages || 'everyone',
    privacyGroups: u.privacy_groups || 'everyone',
    usernameSearchable: u.username_searchable !== 0,
  };
}

// Full view for the admin portal (gated behind the admin token).
export function adminUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    displayName: u.display_name,
    about: u.about,
    avatarColor: u.avatar_color,
    hasAvatar: !!u.avatar_mime,
    isAdmin: !!u.is_admin,
    premium: !!u.premium,
    disabled: !!u.disabled,
    createdAt: u.created_at,
    lastSeen: u.last_seen,
  };
}

// ---- Contacts (server-side favourites; optional) ---------------------------

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

// Whether two users already "know" each other — used to enforce the 'contacts'
// privacy tier. True when they share any chat, or when either has added the
// other as a contact. This deliberately errs toward connected so privacy never
// severs an existing conversation; it only blocks cold approaches by strangers.
const connectionStmts = {
  sharedChat: db.prepare(`
    SELECT 1 FROM chat_members m1
    JOIN chat_members m2 ON m1.chat_id = m2.chat_id
    WHERE m1.user_id = ? AND m2.user_id = ? LIMIT 1`),
  eitherContact: db.prepare(`
    SELECT 1 FROM contacts
    WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?) LIMIT 1`),
};
export function usersAreConnected(a, b) {
  if (!a || !b || a === b) return true;
  if (connectionStmts.sharedChat.get(a, b)) return true;
  return !!connectionStmts.eitherContact.get(a, b, b, a);
}

// ---- Blocking --------------------------------------------------------------

const blockStmts = {
  add: db.prepare(
    'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
  ),
  remove: db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?'),
  isBlocked: db.prepare(
    'SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?'
  ),
  listIds: db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?'),
};

export const blockUser = (blockerId, blockedId) =>
  blockStmts.add.run(blockerId, blockedId, now());
export const unblockUser = (blockerId, blockedId) =>
  blockStmts.remove.run(blockerId, blockedId);
// True when `blockerId` has blocked `blockedId`.
export const hasBlocked = (blockerId, blockedId) =>
  !!blockStmts.isBlocked.get(blockerId, blockedId);
export const listBlockedIds = (blockerId) =>
  blockStmts.listIds.all(blockerId).map((r) => r.blocked_id);
