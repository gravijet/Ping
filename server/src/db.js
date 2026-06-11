import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// One synchronous SQLite connection for the whole process. node:sqlite is
// built into Node 22 so there is no native module to compile — production
// deploys are a plain `npm ci`.
export const db = new DatabaseSync(config.dbFile);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    -- An account needs all three: phone (canonical E.164), email and password.
    phone          TEXT NOT NULL UNIQUE,
    email          TEXT NOT NULL,
    email_lc       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT NOT NULL,
    about          TEXT NOT NULL DEFAULT '',
    avatar_color   TEXT NOT NULL,
    -- Uploaded profile picture (optional). avatar_version busts client caches.
    avatar_mime    TEXT,
    avatar_version INTEGER NOT NULL DEFAULT 0,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    last_seen      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK (type IN ('direct','group')),
    name         TEXT,
    avatar_color TEXT NOT NULL,
    avatar_mime    TEXT,
    avatar_version INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    -- For direct chats this holds the sorted "a:b" user id pair so we can
    -- enforce a single conversation per pair via the unique index below.
    direct_key   TEXT,
    -- A read-only channel (e.g. the official "Ping Team" broadcast): only the
    -- server delivers messages into it; normal members can't reply.
    locked       INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_direct_key
    ON chats(direct_key) WHERE direct_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    joined_at  INTEGER NOT NULL,
    muted      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

  -- Messages carry text and/or an attachment. The attachment column is a small
  -- JSON blob ({ kind, url, mime, name, size, width, height, durationMs }); the
  -- bytes themselves live under uploads/ and are referenced by id.
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL DEFAULT 'text'
      CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location')),
    body       TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat
    ON messages(chat_id, created_at);

  -- Emoji reactions on a message. One row per (message, user, emoji); a user can
  -- react with several different emojis but only once each.
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

  -- Per-recipient delivery/read state. Sender is never a recipient row.
  CREATE TABLE IF NOT EXISTS message_status (
    message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    delivered_at INTEGER,
    read_at      INTEGER,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_status_user_chat
    ON message_status(user_id, chat_id);

  CREATE TABLE IF NOT EXISTS contacts (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, contact_id)
  );

  -- Stored bytes for message attachments. Served auth-gated via /api/uploads/:id.
  CREATE TABLE IF NOT EXISTS uploads (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    mime       TEXT NOT NULL,
    name       TEXT,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Ephemeral status updates ("stories"), visible to chat peers for 24h.
  CREATE TABLE IF NOT EXISTS statuses (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','video')),
    body       TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    bg_color   TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id, created_at);

  CREATE TABLE IF NOT EXISTS status_views (
    status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
    viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at INTEGER NOT NULL,
    PRIMARY KEY (status_id, viewer_id)
  );

  -- Block list: blocker no longer receives messages from blocked.
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  -- FCM device tokens for push notifications. A user may have several devices,
  -- and a device token is globally unique, so the token itself is the PK.
  CREATE TABLE IF NOT EXISTS push_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   TEXT NOT NULL DEFAULT 'android',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

  -- One-time SMS verification codes (server-side phone OTP). Keyed by the
  -- canonical E.164 number; only the hash of the code is stored.
  CREATE TABLE IF NOT EXISTS phone_codes (
    phone      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_sent  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- History of admin broadcasts, so the portal can show what was sent.
  CREATE TABLE IF NOT EXISTS broadcasts (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    delivered  INTEGER NOT NULL DEFAULT 0,
    pushed     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at);
`);

// ---- Migrations ------------------------------------------------------------

// Older databases (schema v1) had a messages table whose `type` only allowed
// 'text'/'system' and had no `attachment` column. Rebuild it in place so media
// messages work without losing any history. New databases already match.
function migrate() {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  const hasAttachment = cols.some((c) => c.name === 'attachment');
  if (hasAttachment) return;

  // The 12-step ALTER procedure: toggle FKs off, swap the table, turn them back
  // on. message_status / replies keep pointing at the same message ids.
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, reply_to, created_at, edited_at, deleted_at)
        SELECT id, chat_id, sender_id, type, body, reply_to, created_at, edited_at, deleted_at
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

migrate();

// Add columns that newer features need to pre-existing tables. Each check is a
// no-op on fresh databases (the CREATE TABLE above already has the column).
function ensureColumns() {
  const chatCols = db.prepare('PRAGMA table_info(chats)').all().map((c) => c.name);
  if (!chatCols.includes('avatar_mime')) {
    db.exec('ALTER TABLE chats ADD COLUMN avatar_mime TEXT');
  }
  if (!chatCols.includes('avatar_version')) {
    db.exec('ALTER TABLE chats ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!chatCols.includes('description')) {
    db.exec("ALTER TABLE chats ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!chatCols.includes('locked')) {
    // Read-only channels (official "Ping Team" broadcasts): members can't reply.
    db.exec('ALTER TABLE chats ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
  }
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('message_storage')) {
    // 'server' = keep history (default); 'local' = purge a user's sent messages
    // from the server once every recipient has read them.
    db.exec(
      "ALTER TABLE users ADD COLUMN message_storage TEXT NOT NULL DEFAULT 'server'"
    );
  }
  if (!userCols.includes('disabled')) {
    // Admin "ban": a disabled account can't log in and existing sessions are
    // rejected.
    db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('show_last_seen')) {
    // Privacy: when 0, other people never see this user's "zuletzt online".
    db.exec('ALTER TABLE users ADD COLUMN show_last_seen INTEGER NOT NULL DEFAULT 1');
  }
  const memberCols = db.prepare('PRAGMA table_info(chat_members)').all().map((c) => c.name);
  if (!memberCols.includes('archived')) {
    // Per-user chat archiving: the chat moves into a collapsed "Archiviert"
    // section on that user's device only.
    db.exec('ALTER TABLE chat_members ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }
}
ensureColumns();

// Older databases capped status.type at ('text','image'); rebuild the table so
// video statuses are allowed. Rows are preserved (statuses are ephemeral anyway).
function migrateStatusType() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='statuses'")
    .get();
  if (!row || /'video'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE statuses_new (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','video')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        bg_color   TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO statuses_new
        SELECT id, user_id, type, body, attachment, bg_color, created_at, expires_at
        FROM statuses;
      DROP TABLE statuses;
      ALTER TABLE statuses_new RENAME TO statuses;
      CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id, created_at);
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateStatusType();

export function now() {
  return Date.now();
}

/// Run [fn] inside a single SQLite transaction (BEGIN/COMMIT, ROLLBACK on
/// throw). Used for multi-row writes (e.g. seeding receipt rows for a group
/// message) so they hit the disk as one atomic unit instead of N autocommits.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
