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
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    username_lc   TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color  TEXT NOT NULL,
    about         TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK (type IN ('direct','group')),
    name         TEXT,
    avatar_color TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    -- For direct chats this holds the sorted "a:b" user id pair so we can
    -- enforce a single conversation per pair via the unique index below.
    direct_key   TEXT
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

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','system')),
    body       TEXT NOT NULL,
    reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat
    ON messages(chat_id, created_at);

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
`);

export function now() {
  return Date.now();
}
