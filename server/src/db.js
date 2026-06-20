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
    locked       INTEGER NOT NULL DEFAULT 0,
    -- A group's shareable join code (null = no invite link active).
    invite_code  TEXT
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
      CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll')),
    body       TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted_at INTEGER,
    -- Disappearing messages: when set, the row is purged once this passes.
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat
    ON messages(chat_id, created_at);
  -- The admin dashboard counts messages/users in time windows (created_at only,
  -- no chat). The composite index above is keyed on chat_id first, so it can't
  -- serve those scans — give each a dedicated created_at index.
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

  -- Polls: one row per poll message ("type = 'poll'"); the option texts live
  -- here as JSON, the votes in poll_votes (one row per user + option).
  CREATE TABLE IF NOT EXISTS polls (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    question   TEXT NOT NULL,
    options    TEXT NOT NULL,
    multi      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_index INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id, option_index)
  );

  -- "Für mich löschen": a message hidden for one user only. The row itself
  -- stays for everyone else; history queries filter on this table.
  CREATE TABLE IF NOT EXISTS hidden_messages (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_hidden_user ON hidden_messages(user_id);

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

  -- Web Push (browser) subscriptions — the W3C Push API counterpart of the FCM
  -- device tokens above. The push service's endpoint URL is globally unique, so
  -- it is the PK; p256dh + auth are the per-subscription encryption keys the
  -- server needs to seal each payload (see webpush.js).
  CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id);

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

  -- Broadcasts an admin composed now but scheduled for later. The maintenance
  -- sweep dispatches due ones (run_at <= now) exactly like a manual broadcast,
  -- then records them in the history above and deletes the row here.
  CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    route      TEXT NOT NULL DEFAULT '',
    run_at     INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_broadcasts_run ON scheduled_broadcasts(run_at);

  -- Public content the marketing site + in-app "Neuigkeiten" surface: newsroom
  -- articles and changelog entries. One table, distinguished by the kind column.
  -- Drafts (published = 0) are visible only in the admin portal.
  CREATE TABLE IF NOT EXISTS posts (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('news','changelog')),
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    -- Newsroom: an editorial category ("Produkt", "Unternehmen" …).
    category     TEXT NOT NULL DEFAULT '',
    -- Changelog: the release version this entry documents (e.g. "0.6.0").
    version      TEXT NOT NULL DEFAULT '',
    -- Changelog: the kind of change — 'feature' | 'improvement' | 'fix' | 'security'.
    tag          TEXT NOT NULL DEFAULT '',
    -- Optional cover image (an /api/uploads/<id> URL or any absolute https URL).
    cover        TEXT NOT NULL DEFAULT '',
    pinned       INTEGER NOT NULL DEFAULT 0,
    published    INTEGER NOT NULL DEFAULT 1,
    author       TEXT NOT NULL DEFAULT 'Ping Team',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    published_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_posts_kind
    ON posts(kind, published, created_at);

  -- Server-driven runtime configuration: feature flags, limits, an app-wide
  -- notice banner and a minimum supported build. A single JSON row the app reads
  -- at /api/config and caches, so a lot can change without shipping a new APK.
  CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Messages a user composed now but asked to send later. The maintenance sweep
  -- delivers due ones (send_at <= now) into the chat as normal messages.
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'text',
    body       TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    reply_to   TEXT,
    send_at    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(send_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_user ON scheduled_messages(chat_id, sender_id);

  -- Call log. One row per participant per call (so each side keeps its own
  -- direction/outcome). call_id is the shared WebRTC id; (user_id, call_id) is
  -- unique so a re-posted log just updates the existing entry.
  CREATE TABLE IF NOT EXISTS calls (
    id         TEXT PRIMARY KEY,
    call_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction  TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
    video      INTEGER NOT NULL DEFAULT 0,
    outcome    TEXT NOT NULL
      CHECK (outcome IN ('completed','missed','declined','canceled','failed')),
    duration   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_user_callid ON calls(user_id, call_id);
  CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id, created_at);

  -- Audit trail of admin actions (user edits, bans, deletions, broadcasts,
  -- config changes, content publishing …). Append-only accountability log shown
  -- in the admin portal so every privileged change is attributable.
  CREATE TABLE IF NOT EXISTS audit_log (
    id         TEXT PRIMARY KEY,
    actor      TEXT NOT NULL DEFAULT 'admin',
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

  -- Developer API keys. External integrations authenticate with a secret token
  -- (shown once at creation) that acts on behalf of [user_id]. We never store
  -- the secret itself — only its sha256 hash — plus a short prefix so the owner
  -- can tell their keys apart in a list. scopes is a JSON array of grant strings.
  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT '',
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    scopes       TEXT NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  -- Anonymous, opt-in client diagnostics. client_events keeps aggregate counts
  -- per (event name, day, app) — never per-user rows — so it can't grow without
  -- bound and carries no identity. client_errors keeps the most recent crash
  -- reports for debugging (pruned to a fixed cap on insert); the only id stored
  -- is the caller-supplied anonymous device id, never a user id.
  CREATE TABLE IF NOT EXISTS client_events (
    name  TEXT NOT NULL,
    day   TEXT NOT NULL,
    app   TEXT NOT NULL DEFAULT 'web',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (name, day, app)
  );
  CREATE INDEX IF NOT EXISTS idx_client_events_day ON client_events(day);

  CREATE TABLE IF NOT EXISTS client_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    app        TEXT NOT NULL DEFAULT 'web',
    aid        TEXT,
    context    TEXT,
    message    TEXT,
    stack      TEXT,
    ua         TEXT,
    url        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);

  -- Anonymous, opt-in device-fleet telemetry. A single tall, fully aggregated
  -- table: one counter per (day, app, metric, bucket). Clients never send raw
  -- readings — only coarse *buckets* (e.g. battery '40-59', android '14',
  -- net 'wifi', ram '6-8') — so there is nothing here to tie back to a person,
  -- and the row count is bounded by metrics × buckets × days. Powers the admin
  -- "Geräteflotte" dashboard (Android-version spread, network mix, RAM/battery
  -- distribution) without any per-user storage.
  CREATE TABLE IF NOT EXISTS device_metrics (
    day    TEXT NOT NULL,
    app    TEXT NOT NULL DEFAULT 'android',
    metric TEXT NOT NULL,
    bucket TEXT NOT NULL,
    count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, app, metric, bucket)
  );
  CREATE INDEX IF NOT EXISTS idx_device_metrics_day ON device_metrics(day);

  -- 0.27.0 "Ordnung & Ausdruck" ------------------------------------------------

  -- Pinned messages: a chat-wide list of important messages anyone in the chat
  -- sees as a banner. One row per (chat, message); pinned_by records who pinned
  -- it (for the system notice). Deleting the message cascades the pin away.
  CREATE TABLE IF NOT EXISTS pinned_messages (
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    pinned_at  INTEGER NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pinned_chat ON pinned_messages(chat_id, pinned_at);

  -- Saved/starred messages: a personal bookmark list that now syncs across a
  -- user's devices (previously local-only). One row per (user, message); chat_id
  -- is denormalised so "Gespeicherte Nachrichten" can group by conversation.
  CREATE TABLE IF NOT EXISTS starred_messages (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_starred_user ON starred_messages(user_id, created_at);

  -- Server-synced per-chat drafts: the unsent text a user has typed in a chat,
  -- so switching devices carries it over. One row per (user, chat); empty text
  -- deletes the row.
  CREATE TABLE IF NOT EXISTS chat_drafts (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    text       TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, chat_id)
  );

  -- Chat folders: user-defined groupings ("Arbeit", "Familie") shown as filter
  -- tabs above the chat list. A folder belongs to one user; chat membership is
  -- many-to-many via chat_folder_members.
  CREATE TABLE IF NOT EXISTS chat_folders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id, sort);

  CREATE TABLE IF NOT EXISTS chat_folder_members (
    folder_id TEXT NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
    chat_id   TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_folder_members_chat ON chat_folder_members(chat_id);

  -- 0.28.0 "Kontext": rich link previews. A shared, URL-keyed cache of the
  -- OpenGraph/HTML metadata behind a link so the same URL is fetched once for
  -- everyone. ok=0 rows are negative cache (the fetch failed / wasn't HTML) so
  -- we don't hammer a dead link on every render. Purged + refreshed by TTL.
  CREATE TABLE IF NOT EXISTS link_previews (
    url         TEXT PRIMARY KEY,
    ok          INTEGER NOT NULL DEFAULT 0,
    title       TEXT,
    description TEXT,
    image       TEXT,
    site_name   TEXT,
    final_url   TEXT,
    fetched_at  INTEGER NOT NULL
  );

  -- 0.28.0 "Kontext": message edit history. Each time a message is edited the
  -- *previous* body is snapshotted here, so a reader can audit how a message
  -- changed (the live body stays on the messages row). One row per prior version.
  CREATE TABLE IF NOT EXISTS message_edits (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    edited_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_message_edits_message
    ON message_edits(message_id, edited_at);
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
  if (!userCols.includes('premium')) {
    // Ping Premium: an admin-granted flag that surfaces a premium badge next to
    // the user's name everywhere. Cosmetic today; the hook for paid perks later.
    db.exec('ALTER TABLE users ADD COLUMN premium INTEGER NOT NULL DEFAULT 0');
  }
  // ---- Rich profile customization -----------------------------------------
  // A profile background ("banner") behind the avatar on the profile page.
  if (!userCols.includes('banner_mime')) {
    db.exec('ALTER TABLE users ADD COLUMN banner_mime TEXT');
  }
  if (!userCols.includes('banner_version')) {
    db.exec('ALTER TABLE users ADD COLUMN banner_version INTEGER NOT NULL DEFAULT 0');
  }
  // A personal accent colour used to theme the user's profile page + name ring.
  // Null/empty means "fall back to the auto-assigned avatar colour".
  if (!userCols.includes('accent_color')) {
    db.exec('ALTER TABLE users ADD COLUMN accent_color TEXT');
  }
  if (!userCols.includes('pronouns')) {
    db.exec("ALTER TABLE users ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''");
  }
  // JSON array of { label, url } shown as tappable chips on the profile page.
  if (!userCols.includes('links')) {
    db.exec("ALTER TABLE users ADD COLUMN links TEXT NOT NULL DEFAULT ''");
  }
  // 'YYYY-MM-DD' or 'MM-DD' (year optional, for people who only share the day).
  if (!userCols.includes('birthday')) {
    db.exec("ALTER TABLE users ADD COLUMN birthday TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('city')) {
    db.exec("ALTER TABLE users ADD COLUMN city TEXT NOT NULL DEFAULT ''");
  }
  // A temporary "mood"/status line (emoji + short text). mood_until is an
  // optional epoch-ms expiry after which it is treated as cleared (lazily, on
  // read — no sweep needed).
  if (!userCols.includes('mood_emoji')) {
    db.exec("ALTER TABLE users ADD COLUMN mood_emoji TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('mood_text')) {
    db.exec("ALTER TABLE users ADD COLUMN mood_text TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('mood_until')) {
    db.exec('ALTER TABLE users ADD COLUMN mood_until INTEGER');
  }
  const memberCols = db.prepare('PRAGMA table_info(chat_members)').all().map((c) => c.name);
  if (!memberCols.includes('archived')) {
    // Per-user chat archiving: the chat moves into a collapsed "Archiviert"
    // section on that user's device only.
    db.exec('ALTER TABLE chat_members ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }
  if (!chatCols.includes('expire_seconds')) {
    // Disappearing messages: new messages in this chat expire after this many
    // seconds (0 = off).
    db.exec('ALTER TABLE chats ADD COLUMN expire_seconds INTEGER NOT NULL DEFAULT 0');
  }
  if (!chatCols.includes('invite_code')) {
    // A group's shareable join code (null = no link). Anyone with the code can
    // join the group via POST /chats/join.
    db.exec('ALTER TABLE chats ADD COLUMN invite_code TEXT');
  }
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!msgCols.includes('expires_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER');
  }
  // The partial index can only exist once the column does (old DBs gain it via
  // the ALTER above), so it is created here rather than in the initial schema.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL'
  );
}
ensureColumns();

// Older databases don't allow the 'poll' message type yet (CHECK constraint).
// Rebuild the table in place — same 12-step procedure as migrate() above.
function migrateMessageTypes() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'poll'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER,
        expires_at INTEGER
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, attachment, reply_to, created_at,
         edited_at, deleted_at, expires_at)
        SELECT id, chat_id, sender_id, type, body, attachment, reply_to,
               created_at, edited_at, deleted_at, expires_at
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypes();

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
