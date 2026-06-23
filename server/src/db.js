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
    invite_code  TEXT,
    -- ---- Channels / Communities (0.31.0) --------------------------------
    -- 'private' (default; classic group) or 'public' (a discoverable channel
    -- listed in the directory and joinable by anyone via its handle).
    visibility   TEXT NOT NULL DEFAULT 'private',
    -- Unique, URL-safe public name for a channel (e.g. "ping-news"). Null for
    -- ordinary groups/DMs. Powers the directory and /c/<handle> deep links.
    handle       TEXT,
    -- 1 = broadcast channel: only owners/admins may post; everyone else reads
    -- and reacts. (Distinct from the locked flag, which blocks all member sends.)
    broadcast    INTEGER NOT NULL DEFAULT 0,
    -- Free-form directory category ('Nachrichten', 'Technik', …); '' = none.
    category     TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_direct_key
    ON chats(direct_key) WHERE direct_key IS NOT NULL;
  -- NOTE: the channel handle/visibility indexes are created in ensureColumns()
  -- (not here), because on an existing database the handle/visibility columns
  -- only appear after the ALTER TABLE migrations run — creating the indexes in
  -- this block would reference columns that don't exist yet.

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
      CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist','sticker','board','game','livelocation')),
    body       TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted_at INTEGER,
    -- Disappearing messages: when set, the row is purged once this passes.
    expires_at INTEGER,
    -- ---- „Alles" (0.34.0) -----------------------------------------------
    -- Threads: a reply that belongs to a thread carries the root message id
    -- here; thread_count on the root is the running number of thread replies.
    thread_root  TEXT REFERENCES messages(id) ON DELETE SET NULL,
    thread_count INTEGER NOT NULL DEFAULT 0,
    -- View-once media: viewed_at is stamped on first open, after which the
    -- payload is stripped and the row scheduled for removal.
    view_once    INTEGER NOT NULL DEFAULT 0,
    viewed_at    INTEGER,
    -- Opt-in E2EE: 1 = body/attachment hold ciphertext the server can't read.
    enc          INTEGER NOT NULL DEFAULT 0
  );
  -- NOTE: the idx_messages_thread index is created in ensureColumns() (not here),
  -- because on an existing database thread_root only appears after the ALTER.
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

  -- 0.29.0 "Erinnerung & Schnellzugriff": message reminders. A user asks Ping to
  -- nudge them about a specific message at a chosen time. The maintenance sweep
  -- fires due rows (remind_at <= now AND fired_at IS NULL) over WS + push, stamps
  -- fired_at, and keeps the row briefly so the UI can show "erledigt" before it
  -- is purged. A denormalised snapshot (preview/chat title) lets the reminders
  -- pane render without re-fetching a message that may meanwhile have vanished.
  CREATE TABLE IF NOT EXISTS message_reminders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    preview    TEXT NOT NULL DEFAULT '',
    chat_title TEXT NOT NULL DEFAULT '',
    remind_at  INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    fired_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON message_reminders(remind_at) WHERE fired_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_reminders_user
    ON message_reminders(user_id, remind_at);

  -- 0.29.0 "Erinnerung & Schnellzugriff": quick replies (canned responses). A
  -- per-user library of reusable snippets the composer can insert with one tap,
  -- optionally addressed by a short "/shortcut". sort gives the user a stable,
  -- reorderable order.
  CREATE TABLE IF NOT EXISTS quick_replies (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shortcut   TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quick_replies_user
    ON quick_replies(user_id, sort);

  -- 0.30.0 "Finden & Fokus": per-user notification controls. One row per user,
  -- created lazily on first write. Quiet hours are stored as minutes-of-day in
  -- the server's local timezone with a 7-bit day mask (bit 0 = Monday); a manual
  -- "Fokus" toggle is an absolute epoch-ms expiry (0 = off). While silenced the
  -- server withholds *push* (live socket delivery is untouched) and may send a
  -- one-time auto-reply to incoming direct messages.
  CREATE TABLE IF NOT EXISTS user_focus (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    focus_until    INTEGER NOT NULL DEFAULT 0,
    quiet_enabled  INTEGER NOT NULL DEFAULT 0,
    quiet_start    INTEGER NOT NULL DEFAULT 1320, -- 22:00
    quiet_end      INTEGER NOT NULL DEFAULT 420,  -- 07:00
    quiet_days     INTEGER NOT NULL DEFAULT 127,  -- every day
    auto_reply     TEXT NOT NULL DEFAULT '',
    updated_at     INTEGER NOT NULL DEFAULT 0
  );

  -- Throttle table for focus auto-replies: at most one auto-reply per
  -- (focused user, peer) per cool-down window, so a chatty peer can't make the
  -- server fire dozens of canned replies.
  CREATE TABLE IF NOT EXISTS focus_autoreplies (
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, peer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_focus_autoreplies_sent ON focus_autoreplies(sent_at);

  -- ---- Identität & Schutz (0.32.0) -----------------------------------------
  --
  -- Two-factor authentication (TOTP, RFC 6238). One row per user. The row
  -- exists from the moment a setup begins; enabled flips to 1 only once the
  -- user has confirmed a code, so a half-finished setup never gates login.
  CREATE TABLE IF NOT EXISTS user_totp (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret       TEXT NOT NULL,         -- base32 shared secret
    enabled      INTEGER NOT NULL DEFAULT 0,
    confirmed_at INTEGER,               -- when the first valid code was entered
    created_at   INTEGER NOT NULL
  );

  -- One-time recovery codes, used when an authenticator is lost. Stored hashed
  -- (sha256) so a database leak can't replay them; used_at stamps consumption.
  CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, code_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

  -- A per-user security audit feed surfaced in the "Sicherheits-Center":
  -- logins, 2FA changes, password/email/username changes, privacy changes and
  -- "log out everywhere". Append-only; trimmed to the most recent rows per user
  -- by the maintenance sweep so it can't grow without bound.
  CREATE TABLE IF NOT EXISTS security_events (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,           -- 'login' | 'twofa_enabled' | ...
    detail     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    ua         TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_security_events_user
    ON security_events(user_id, created_at);

  -- ---- Pläne & Aufgaben (0.33.0) -------------------------------------------
  --
  -- Events ("Termine"). Like polls, an event is a normal message (type='event')
  -- whose structured payload lives here and rides along in messageView.event, so
  -- all the existing realtime plumbing just works. start_at is epoch-ms; an
  -- optional reminder fires at remind_at (set when remind_minutes > 0) once and is
  -- stamped reminded_at so the maintenance sweep can never re-fire it.
  CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    message_id    TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    location      TEXT NOT NULL DEFAULT '',
    start_at      INTEGER NOT NULL,
    remind_at     INTEGER,            -- when the pre-start nudge should fire (or NULL)
    reminded_at   INTEGER,            -- stamped once the nudge went out
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_chat ON events(chat_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_events_remind
    ON events(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

  -- One RSVP row per (event, user). status is 'going' | 'maybe' | 'declined'.
  CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );

  -- Task lists ("Aufgaben"). A collaborative checklist backed by a message
  -- (type='tasklist'); the items live in tasklist_items and ride along in
  -- messageView.tasklist. Anyone in the chat can tick items or add new ones.
  CREATE TABLE IF NOT EXISTS tasklists (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasklist_items (
    id          TEXT PRIMARY KEY,
    tasklist_id TEXT NOT NULL REFERENCES tasklists(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    done_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
    done_at     INTEGER,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasklist_items_list
    ON tasklist_items(tasklist_id, sort);

  -- ---- „Ausdruck & Werkbank" (0.35.0) — structured side-tables -------------

  -- Contact cards (type='contact'). Sharing a contact creates a message whose
  -- card payload lives here and rides along in messageView.contact. We keep a
  -- snapshot (name/username/phone/colour) so the card renders unchanged even if
  -- the referenced user later edits their profile or never was a Ping user;
  -- contact_user_id links to a live account when there is one (tap → open chat).
  CREATE TABLE IF NOT EXISTS message_contacts (
    id              TEXT PRIMARY KEY,
    message_id      TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sharer_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    display_name    TEXT NOT NULL,
    username        TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    avatar_color    TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL
  );

  -- Code snippets (type='code'). A monospace block with an optional language
  -- label + filename, rendered as a card with one-tap copy. The body lives here
  -- (not in messages.body) so the timeline preview stays a short teaser.
  CREATE TABLE IF NOT EXISTS message_code (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language    TEXT NOT NULL DEFAULT '',
    filename    TEXT NOT NULL DEFAULT '',
    code        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- ---- „Zusammen" (0.36.0) — coordinate money & time -----------------------

  -- Shared expenses ("Geteilte Kasse", type='expense'). One row per expense
  -- message; who-owes-what lives in expense_shares and rides along in
  -- messageView.expense. A 'settlement' is the same shape (payer pays one
  -- beneficiary), so the per-chat ledger uses a single net formula for both:
  --   net(u) = Σ(amount where payer=u) − Σ(share where share.user=u)
  -- Positive net = the group owes u; negative = u owes the group.
  CREATE TABLE IF NOT EXISTS expenses (
    id           TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,            -- total, in minor units
    currency     TEXT NOT NULL DEFAULT 'EUR',
    kind         TEXT NOT NULL DEFAULT 'expense', -- 'expense' | 'settlement'
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_chat ON expenses(chat_id, created_at);

  -- One row per (expense, participant): that participant's portion of the total.
  CREATE TABLE IF NOT EXISTS expense_shares (
    expense_id  TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_cents INTEGER NOT NULL,
    PRIMARY KEY (expense_id, user_id)
  );

  -- Availability polls ("Terminfindung", type='availpoll'). Propose several time
  -- slots; members mark yes/maybe/no per slot. The organiser locks a winning
  -- slot, which spawns a real 'event' message (event_message_id) and closes the
  -- poll. Options + votes live in the two tables below and ride along in
  -- messageView.availpoll.
  CREATE TABLE IF NOT EXISTS availpolls (
    id               TEXT PRIMARY KEY,
    message_id       TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    location         TEXT NOT NULL DEFAULT '',
    closed           INTEGER NOT NULL DEFAULT 0,
    chosen_option_id TEXT,                    -- the locked slot, once closed
    event_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS availpoll_options (
    id           TEXT PRIMARY KEY,
    availpoll_id TEXT NOT NULL REFERENCES availpolls(id) ON DELETE CASCADE,
    start_at     INTEGER NOT NULL,
    sort         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_availpoll_options_poll
    ON availpoll_options(availpoll_id, sort);

  -- One vote row per (option, user). vote is 'yes' | 'maybe' | 'no'.
  CREATE TABLE IF NOT EXISTS availpoll_votes (
    option_id  TEXT NOT NULL REFERENCES availpoll_options(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (option_id, user_id)
  );

  -- ---- „Alles" (0.34.0) — Mega-Release side-tables -------------------------

  -- Sticker packs + stickers. A sticker message (type='sticker') references a
  -- sticker id; the bytes live under uploads/ like any other attachment.
  CREATE TABLE IF NOT EXISTS sticker_packs (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    cover      TEXT,                 -- upload id of the pack cover sticker
    builtin    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stickers (
    id         TEXT PRIMARY KEY,
    pack_id    TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    upload_id  TEXT NOT NULL,        -- bytes in uploads/
    emoji      TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id, sort);

  -- Kanban boards (type='board'). Columns + cards live here and ride along in
  -- messageView.board, exactly like polls/tasklists.
  CREATE TABLE IF NOT EXISTS boards (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS board_columns (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS board_cards (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id  TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_board_columns_board ON board_columns(board_id, sort);
  CREATE INDEX IF NOT EXISTS idx_board_cards_col ON board_cards(column_id, sort);

  -- In-chat mini-games (type='game'). state is a small JSON blob the game
  -- module interprets (board, turn, winner …).
  CREATE TABLE IF NOT EXISTS games (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,        -- 'tictactoe' | 'connect4' | …
    state      TEXT NOT NULL,        -- JSON game state
    turn       TEXT REFERENCES users(id) ON DELETE SET NULL,
    winner     TEXT,                 -- user id, 'draw', or NULL while in play
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Live location: one active share per (user, chat); the row is updated in
  -- place as the position moves and purged once expires_at passes.
  CREATE TABLE IF NOT EXISTS live_locations (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    accuracy   REAL,
    heading    REAL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS idx_live_locations_chat ON live_locations(chat_id);

  -- Collaborative group notes / wiki pages (one or more per chat).
  CREATE TABLE IF NOT EXISTS chat_notes (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_notes_chat ON chat_notes(chat_id, updated_at);

  -- Per-user, per-chat appearance: wallpaper + accent. Device-agnostic (synced).
  CREATE TABLE IF NOT EXISTS chat_appearance (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    wallpaper  TEXT,                 -- preset id or upload id
    accent     TEXT,                 -- hex colour
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, chat_id)
  );

  -- Scheduled calls. A pre-call reminder fires once via the maintenance sweep,
  -- exactly like event reminders (remind_at / reminded_at).
  CREATE TABLE IF NOT EXISTS scheduled_calls (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    video       INTEGER NOT NULL DEFAULT 0,
    start_at    INTEGER NOT NULL,
    remind_at   INTEGER,
    reminded_at INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_calls_remind
    ON scheduled_calls(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

  -- Voice-note transcripts (on-prem Whisper). One row per voice message; status
  -- is 'pending' until the worker fills text in.
  CREATE TABLE IF NOT EXISTS voice_transcripts (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    text       TEXT NOT NULL DEFAULT '',
    lang       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Webhooks / bots. Incoming hooks post into a chat via a secret token;
  -- outgoing hooks (url set) mirror chat messages out. token is URL-safe.
  CREATE TABLE IF NOT EXISTS webhooks (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    direction   TEXT NOT NULL DEFAULT 'in',  -- 'in' | 'out'
    url         TEXT,                         -- target for outgoing hooks
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_webhooks_chat ON webhooks(chat_id);

  -- Opt-in E2EE: each user publishes a long-term public identity key; sessions
  -- record the agreed-on per-DM verification (safety number) state. Private
  -- keys never reach the server.
  CREATE TABLE IF NOT EXISTS e2ee_identities (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,        -- base64url SPKI / raw X25519 pubkey
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS e2ee_sessions (
    chat_id    TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    enabled    INTEGER NOT NULL DEFAULT 0,
    enabled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );

  -- Login approvals: a new device's pending login waits here until an existing
  -- device approves it (then a token is issued and the row consumed).
  CREATE TABLE IF NOT EXISTS login_approvals (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    device     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_approvals_user ON login_approvals(user_id, status);

  -- ════════════════════════════════════════════════════════════════════════
  -- „Universum" (0.38.0) — Mega-Release side-tables
  -- ════════════════════════════════════════════════════════════════════════

  -- Pillar A — structured message types (each backed by a normal message whose
  -- payload lives here and rides along in messageView). The messages.type CHECK
  -- is widened to admit them by migrateMessageTypes038() (FTS-aware) below.

  -- Whiteboard (type='whiteboard'): a collaborative drawing canvas. Strokes are a
  -- JSON array; new strokes append live over the socket ('whiteboard-stroke').
  CREATE TABLE IF NOT EXISTS whiteboards (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    strokes     TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- Collaborative doc (type='doc'): a shared mini-document. Last-write-wins with a
  -- monotonic version; edits broadcast 'message-updated'.
  CREATE TABLE IF NOT EXISTS docs (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    version     INTEGER NOT NULL DEFAULT 1,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- Shared playlist (type='playlist'): "Listen Together". Tracks are external
  -- links or upload refs; anyone in the chat can append.
  CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_list ON playlist_tracks(playlist_id, sort);

  -- Recipe card (type='recipe'): ingredients + steps as JSON arrays of strings.
  CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    servings    INTEGER NOT NULL DEFAULT 0,
    minutes     INTEGER NOT NULL DEFAULT 0,
    ingredients TEXT NOT NULL DEFAULT '[]',
    steps       TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL
  );

  -- Flashcard deck (type='flashcards'): a study deck with quiz/review modes.
  CREATE TABLE IF NOT EXISTS decks (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deck_cards (
    id          TEXT PRIMARY KEY,
    deck_id     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front       TEXT NOT NULL,
    back        TEXT NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id, sort);

  -- Form / survey (type='form'): multi-question (text|choice|rating). One response
  -- row per (form, user); answers is a JSON array aligned to questions.
  CREATE TABLE IF NOT EXISTS forms (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    questions   TEXT NOT NULL,
    anonymous   INTEGER NOT NULL DEFAULT 0,
    closed      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS form_responses (
    form_id     TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answers     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (form_id, user_id)
  );

  -- Bookmark / link collection (type='bookmark'): a read-later card of links.
  CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookmark_links (
    id          TEXT PRIMARY KEY,
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_bookmark_links_b ON bookmark_links(bookmark_id, sort);

  -- Pinned places (type='place'): a small map collection of named lat/lng pins.
  CREATE TABLE IF NOT EXISTS places (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS place_pins (
    id          TEXT PRIMARY KEY,
    place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_place_pins_place ON place_pins(place_id, sort);

  -- Watch party (type='watchparty'): synced video playback. position_ms/playing
  -- are pushed live ('watchparty-sync'); the row is the resumable source of truth.
  CREATE TABLE IF NOT EXISTS watch_parties (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL,
    position_ms INTEGER NOT NULL DEFAULT 0,
    playing     INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- Virtual gift (type='gift', Pillar E): an animated gift sent into a chat.
  CREATE TABLE IF NOT EXISTS gifts (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  -- Pillar B — voice rooms (persistent group audio rooms, ride on the mesh).
  CREATE TABLE IF NOT EXISTS voice_rooms (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    ended_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_voice_rooms_chat ON voice_rooms(chat_id, active);
  CREATE TABLE IF NOT EXISTS voice_room_members (
    room_id     TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'speaker',
    hand        INTEGER NOT NULL DEFAULT 0,
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );

  -- Pillar C — shareable invite links + a join-request queue (slow mode / approval).
  CREATE TABLE IF NOT EXISTS invite_links (
    code        TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses    INTEGER NOT NULL DEFAULT 0,
    uses        INTEGER NOT NULL DEFAULT 0,
    expires_at  INTEGER,
    revoked_at  INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invite_links_chat ON invite_links(chat_id);
  CREATE TABLE IF NOT EXISTS chat_join_requests (
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );

  -- Pillar E — achievements + per-chat daily streaks (Snapstreak-style).
  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    earned_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );
  CREATE TABLE IF NOT EXISTS streaks (
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    count      INTEGER NOT NULL DEFAULT 0,
    last_day   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (chat_id, user_id)
  );

  -- Pillar F — shared habit / streak tracker.
  CREATE TABLE IF NOT EXISTS habits (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    cadence     TEXT NOT NULL DEFAULT 'daily',
    created_at  INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_habits_chat ON habits(chat_id);
  CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (habit_id, user_id, day)
  );
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
  // ---- Channels / Communities (0.31.0) ------------------------------------
  if (!chatCols.includes('visibility')) {
    db.exec("ALTER TABLE chats ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
  }
  if (!chatCols.includes('handle')) {
    db.exec('ALTER TABLE chats ADD COLUMN handle TEXT');
  }
  if (!chatCols.includes('broadcast')) {
    db.exec('ALTER TABLE chats ADD COLUMN broadcast INTEGER NOT NULL DEFAULT 0');
  }
  if (!chatCols.includes('category')) {
    db.exec("ALTER TABLE chats ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  }
  // ---- „Universum" (0.38.0): communities, slow mode, join approval ----------
  // A group that belongs to a parent "community" hub points at it here; the hub
  // itself is just a group with kind='community'. NULL = a standalone chat.
  if (!chatCols.includes('parent_id')) {
    db.exec('ALTER TABLE chats ADD COLUMN parent_id TEXT REFERENCES chats(id) ON DELETE SET NULL');
  }
  if (!chatCols.includes('kind')) {
    db.exec("ALTER TABLE chats ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
  }
  // Slow mode: minimum seconds between a member's messages (0 = off).
  if (!chatCols.includes('slow_mode_s')) {
    db.exec('ALTER TABLE chats ADD COLUMN slow_mode_s INTEGER NOT NULL DEFAULT 0');
  }
  // Join approval: 1 = joining via an invite link queues a request an admin must
  // approve instead of joining immediately.
  if (!chatCols.includes('join_approval')) {
    db.exec('ALTER TABLE chats ADD COLUMN join_approval INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_chats_parent ON chats(parent_id) WHERE parent_id IS NOT NULL');
  // These indexes depend on the columns above, so (like the expires index) they
  // are created here rather than in the initial CREATE TABLE for old databases.
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_handle ON chats(handle COLLATE NOCASE) WHERE handle IS NOT NULL'
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_chats_public ON chats(visibility) WHERE visibility = 'public'"
  );
  // ---- Identität & Schutz (0.32.0): usernames, privacy, session epoch -------
  // A unique, public @username (lowercase, null until claimed). Powers people
  // search and /u/<name> deep links. Stored already-lowercased.
  if (!userCols.includes('username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
  // Who may open a *new* direct chat with this user: 'everyone' (default) or
  // 'contacts' (only people already in their contacts / sharing a chat).
  if (!userCols.includes('privacy_messages')) {
    db.exec("ALTER TABLE users ADD COLUMN privacy_messages TEXT NOT NULL DEFAULT 'everyone'");
  }
  // Who may add this user to a group: 'everyone' (default) or 'contacts'.
  if (!userCols.includes('privacy_groups')) {
    db.exec("ALTER TABLE users ADD COLUMN privacy_groups TEXT NOT NULL DEFAULT 'everyone'");
  }
  // Whether the user is discoverable by their @username in people search.
  if (!userCols.includes('username_searchable')) {
    db.exec('ALTER TABLE users ADD COLUMN username_searchable INTEGER NOT NULL DEFAULT 1');
  }
  // Monotonic session epoch. Every issued token carries the epoch it was signed
  // under; "überall abmelden" bumps this, instantly invalidating older tokens.
  if (!userCols.includes('token_epoch')) {
    db.exec('ALTER TABLE users ADD COLUMN token_epoch INTEGER NOT NULL DEFAULT 0');
  }
  // Unique on the lowercase username; depends on the column above, so created
  // here rather than in the initial CREATE TABLE block.
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL'
  );
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!msgCols.includes('expires_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER');
  }
  // The partial index can only exist once the column does (old DBs gain it via
  // the ALTER above), so it is created here rather than in the initial schema.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL'
  );

  // ---- „Alles" (0.34.0): new columns on pre-existing tables ----------------
  // Threads, view-once and E2EE add columns to messages. migrateMessageTypes034
  // (below) rebuilds the table copying these, so they must exist *before* it
  // runs — hence here in ensureColumns(), which runs first.
  if (!msgCols.includes('thread_root')) {
    db.exec('ALTER TABLE messages ADD COLUMN thread_root TEXT REFERENCES messages(id) ON DELETE SET NULL');
  }
  if (!msgCols.includes('thread_count')) {
    db.exec('ALTER TABLE messages ADD COLUMN thread_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!msgCols.includes('view_once')) {
    db.exec('ALTER TABLE messages ADD COLUMN view_once INTEGER NOT NULL DEFAULT 0');
  }
  if (!msgCols.includes('viewed_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN viewed_at INTEGER');
  }
  if (!msgCols.includes('enc')) {
    db.exec('ALTER TABLE messages ADD COLUMN enc INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_root, created_at) WHERE thread_root IS NOT NULL'
  );
  // 0.34.0: account-level default disappearing timer (seconds; 0 = off). Applied
  // to every *new* chat the user starts (per-chat expire_seconds already exists).
  if (!userCols.includes('default_ttl')) {
    db.exec('ALTER TABLE users ADD COLUMN default_ttl INTEGER NOT NULL DEFAULT 0');
  }
  // Per-member chat lock + hide (personal; not shown until unlocked).
  const cmCols034 = db.prepare('PRAGMA table_info(chat_members)').all().map((c) => c.name);
  if (!cmCols034.includes('locked')) {
    db.exec('ALTER TABLE chat_members ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
  }
  if (!cmCols034.includes('hidden')) {
    db.exec('ALTER TABLE chat_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  }
  // Recurring events: RRULE-lite ('', 'daily', 'weekly', 'monthly').
  const eventCols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!eventCols.includes('recur')) {
    db.exec("ALTER TABLE events ADD COLUMN recur TEXT NOT NULL DEFAULT ''");
  }

  // ---- Fehlerberichte (error reports): triage state on client_errors -------
  // The crash table started life as a flat append-only ring. To turn it into a
  // developer-facing bug inbox (auto-collected reports that a fresh Claude
  // session triages and fixes) we add: a server-computed `fingerprint` so the
  // same crash collapses into one row, a `count`/`last_seen` for "seen N× until
  // T", an `app_version` for "which build", and a `status`/`resolved_at` so a
  // fixed report drops out of the inbox (and re-opens if it recurs).
  const ceCols = db.prepare('PRAGMA table_info(client_errors)').all().map((c) => c.name);
  if (!ceCols.includes('fingerprint')) {
    db.exec('ALTER TABLE client_errors ADD COLUMN fingerprint TEXT');
  }
  if (!ceCols.includes('count')) {
    db.exec('ALTER TABLE client_errors ADD COLUMN count INTEGER NOT NULL DEFAULT 1');
  }
  if (!ceCols.includes('last_seen')) {
    db.exec('ALTER TABLE client_errors ADD COLUMN last_seen INTEGER');
    // Legacy rows predate the column: seed it from created_at so they sort sanely.
    db.exec('UPDATE client_errors SET last_seen = created_at WHERE last_seen IS NULL');
  }
  if (!ceCols.includes('status')) {
    db.exec("ALTER TABLE client_errors ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  }
  if (!ceCols.includes('app_version')) {
    db.exec('ALTER TABLE client_errors ADD COLUMN app_version TEXT');
  }
  if (!ceCols.includes('resolved_at')) {
    db.exec('ALTER TABLE client_errors ADD COLUMN resolved_at INTEGER');
  }
  // One row per distinct crash. Pre-existing rows have NULL fingerprint; SQLite
  // treats NULLs as distinct so the unique index tolerates them, and the upsert
  // in telemetryRepo only ever conflicts on a real (non-NULL) fingerprint.
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_client_errors_fp ON client_errors(fingerprint)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_client_errors_status ON client_errors(status, last_seen)'
  );

  // ---- „Feinschliff" (0.37.0): small additive columns + one side table ------
  // All flag-gated, all purely additive (no messages.type widening → the
  // external-content FTS5 index is left untouched, no rebuild).
  const cm037 = db.prepare('PRAGMA table_info(chat_members)').all().map((c) => c.name);
  // autoTranslate: per-member target language for incoming messages ('' = off).
  if (!cm037.includes('auto_translate')) {
    db.exec("ALTER TABLE chat_members ADD COLUMN auto_translate TEXT NOT NULL DEFAULT ''");
  }
  // pollQuiz: the correct option index turns a poll into a quiz (NULL = plain poll).
  const pollCols = db.prepare('PRAGMA table_info(polls)').all().map((c) => c.name);
  if (!pollCols.includes('correct_option')) {
    db.exec('ALTER TABLE polls ADD COLUMN correct_option INTEGER');
  }
  // recurringReminders: '', 'daily' or 'weekly' — the sweep re-schedules on fire.
  const remCols = db.prepare('PRAGMA table_info(message_reminders)').all().map((c) => c.name);
  if (!remCols.includes('recur')) {
    db.exec("ALTER TABLE message_reminders ADD COLUMN recur TEXT NOT NULL DEFAULT ''");
  }
  // sendEffects (messages.effect) is added *after* the message-type migrations
  // below — they rebuild `messages` and would otherwise drop a column added here.
  // smartFolders: declarative auto-sort rules attached to an existing chat_folder.
  db.exec(`
    CREATE TABLE IF NOT EXISTS folder_rules (
      folder_id  TEXT PRIMARY KEY REFERENCES chat_folders(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'all',
      keyword    TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_folder_rules_user ON folder_rules(user_id)');
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

// 0.33.0 "Pläne & Aufgaben": allow the 'event' and 'tasklist' message types.
// Same in-place rebuild as migrateMessageTypes(), but FTS-aware: the rebuild
// drops the old `messages` table (and with it the messages_fts triggers), so we
// drop the now-orphaned FTS index too and let setupFts() (which runs right after)
// recreate it + its triggers and backfill from the new table. Without this the
// full-text index would silently stop updating after the migration.
function migrateMessageTypesPlans() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'event'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist')),
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
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
      -- The FTS triggers lived on the old table and are gone; drop the orphaned
      -- index so setupFts() rebuilds it (triggers + backfill) from scratch.
      DROP TABLE IF EXISTS messages_fts;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypesPlans();

// 0.34.0 "Alles": allow the 'sticker', 'board', 'game' and 'livelocation'
// message types, and carry the new thread/view-once/enc columns through the
// rebuild. FTS-aware exactly like migrateMessageTypesPlans(): dropping the old
// `messages` table removes the messages_fts triggers, so we drop the orphaned
// index and let setupFts() (next) rebuild it + backfill. The thread/view-once/
// enc columns are added by ensureColumns() above, so they exist here to copy.
function migrateMessageTypes034() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'sticker'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist','sticker','board','game','livelocation')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER,
        expires_at INTEGER,
        thread_root  TEXT REFERENCES messages(id) ON DELETE SET NULL,
        thread_count INTEGER NOT NULL DEFAULT 0,
        view_once    INTEGER NOT NULL DEFAULT 0,
        viewed_at    INTEGER,
        enc          INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, attachment, reply_to, created_at,
         edited_at, deleted_at, expires_at, thread_root, thread_count,
         view_once, viewed_at, enc)
        SELECT id, chat_id, sender_id, type, body, attachment, reply_to,
               created_at, edited_at, deleted_at, expires_at, thread_root,
               thread_count, view_once, viewed_at, enc
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_thread
        ON messages(thread_root, created_at) WHERE thread_root IS NOT NULL;
      DROP TABLE IF EXISTS messages_fts;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypes034();

// 0.35.0 "Ausdruck & Werkbank": widen the type CHECK once more to admit the
// 'contact' (Kontaktkarte) and 'code' (Code-Snippet) message types. Same
// FTS-aware table rebuild as migrateMessageTypes034(): dropping `messages`
// removes the messages_fts triggers, so we drop the orphaned index and let
// setupFts() (next) rebuild + backfill it. Idempotent — keyed on the new types
// not yet appearing in the live CHECK clause.
function migrateMessageTypes035() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'contact'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist','sticker','board','game','livelocation','contact','code')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER,
        expires_at INTEGER,
        thread_root  TEXT REFERENCES messages(id) ON DELETE SET NULL,
        thread_count INTEGER NOT NULL DEFAULT 0,
        view_once    INTEGER NOT NULL DEFAULT 0,
        viewed_at    INTEGER,
        enc          INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, attachment, reply_to, created_at,
         edited_at, deleted_at, expires_at, thread_root, thread_count,
         view_once, viewed_at, enc)
        SELECT id, chat_id, sender_id, type, body, attachment, reply_to,
               created_at, edited_at, deleted_at, expires_at, thread_root,
               thread_count, view_once, viewed_at, enc
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_thread
        ON messages(thread_root, created_at) WHERE thread_root IS NOT NULL;
      DROP TABLE IF EXISTS messages_fts;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypes035();

// 0.36.0 "Zusammen": widen the type CHECK once more to admit the 'expense'
// (Geteilte Kasse) and 'availpoll' (Terminfindung) message types. Same FTS-aware
// table rebuild as migrateMessageTypes035(): dropping `messages` removes the
// messages_fts triggers, so we drop the orphaned index and let setupFts() (next)
// rebuild + backfill it. Idempotent — keyed on 'expense' not yet appearing in
// the live CHECK clause.
function migrateMessageTypes036() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'expense'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist','sticker','board','game','livelocation','contact','code','expense','availpoll')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER,
        expires_at INTEGER,
        thread_root  TEXT REFERENCES messages(id) ON DELETE SET NULL,
        thread_count INTEGER NOT NULL DEFAULT 0,
        view_once    INTEGER NOT NULL DEFAULT 0,
        viewed_at    INTEGER,
        enc          INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, attachment, reply_to, created_at,
         edited_at, deleted_at, expires_at, thread_root, thread_count,
         view_once, viewed_at, enc)
        SELECT id, chat_id, sender_id, type, body, attachment, reply_to,
               created_at, edited_at, deleted_at, expires_at, thread_root,
               thread_count, view_once, viewed_at, enc
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_thread
        ON messages(thread_root, created_at) WHERE thread_root IS NOT NULL;
      DROP TABLE IF EXISTS messages_fts;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypes036();

// 0.37.0 "Feinschliff": sendEffects column on messages. Added *after* the
// message-type migrations above (each rebuilds `messages` from a fixed column
// list, which would drop a column added in ensureColumns). Purely additive — no
// type-CHECK change, so the external-content FTS5 index is untouched.
(() => {
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('effect')) {
    db.exec("ALTER TABLE messages ADD COLUMN effect TEXT NOT NULL DEFAULT ''");
  }
})();

// 0.38.0 "Universum": the biggest type-CHECK widening yet — admit eleven new
// structured/media types at once: whiteboard, doc, playlist, recipe, flashcards,
// form, bookmark, place, videonote, watchparty, gift. Same FTS-aware table
// rebuild as migrateMessageTypes036(): dropping `messages` removes the
// messages_fts triggers, so we drop the orphaned index and let setupFts() (next)
// rebuild + backfill it. Runs *after* the effect IIFE above so the rebuild keeps
// the `effect` column. Idempotent — keyed on 'whiteboard' not yet in the CHECK.
function migrateMessageTypes038() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (!row || /'whiteboard'/.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE messages_new (
        id         TEXT PRIMARY KEY,
        chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL DEFAULT 'text'
          CHECK (type IN ('text','system','image','gif','video','audio','voice','file','location','poll','event','tasklist','sticker','board','game','livelocation','contact','code','expense','availpoll','whiteboard','doc','playlist','recipe','flashcards','form','bookmark','place','videonote','watchparty','gift')),
        body       TEXT NOT NULL DEFAULT '',
        attachment TEXT,
        reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER,
        deleted_at INTEGER,
        expires_at INTEGER,
        thread_root  TEXT REFERENCES messages(id) ON DELETE SET NULL,
        thread_count INTEGER NOT NULL DEFAULT 0,
        view_once    INTEGER NOT NULL DEFAULT 0,
        viewed_at    INTEGER,
        enc          INTEGER NOT NULL DEFAULT 0,
        effect       TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO messages_new
        (id, chat_id, sender_id, type, body, attachment, reply_to, created_at,
         edited_at, deleted_at, expires_at, thread_root, thread_count,
         view_once, viewed_at, enc, effect)
        SELECT id, chat_id, sender_id, type, body, attachment, reply_to,
               created_at, edited_at, deleted_at, expires_at, thread_root,
               thread_count, view_once, viewed_at, enc, effect
        FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expires
        ON messages(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_thread
        ON messages(thread_root, created_at) WHERE thread_root IS NOT NULL;
      DROP TABLE IF EXISTS messages_fts;
    `);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
migrateMessageTypes038();

// 0.38.0: round-video-note flag on messages. Added *after* migrateMessageTypes038
// (which rebuilds from a fixed column list and would drop a column added earlier).
// Purely additive — no type-CHECK change, FTS untouched.
(() => {
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('round')) {
    db.exec('ALTER TABLE messages ADD COLUMN round INTEGER NOT NULL DEFAULT 0');
  }
})();

// ---- Full-text search (FTS5) ----------------------------------------------
//
// 0.30.0 "Finden & Fokus": an external-content FTS5 index over messages.body so
// global search is ranked (bm25) and can highlight matches (snippet()) instead
// of a plain substring LIKE scan. The index is kept in sync entirely by triggers
// — createMessage/editMessage/deleteMessage/purge all funnel through INSERT,
// UPDATE and DELETE on `messages`, so nothing in the repo layer has to know the
// index exists. FTS5 is compiled into Node's bundled SQLite, but we still probe
// for it and degrade gracefully to the LIKE path (chatRepo.searchMessages) if a
// build ever ships without it, so search never hard-fails.
export let ftsAvailable = false;
function setupFts() {
  try {
    const existing = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .get();
    if (!existing) {
      // Probe FTS5 on a throwaway table first so a missing module can't leave a
      // half-built schema behind.
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x); DROP TABLE _fts_probe;');
      db.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          body,
          content='messages',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
        END;
        CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
        END;
        CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
          INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
        END;
      `);
      // Backfill the index from the existing history in one pass.
      db.exec('INSERT INTO messages_fts(rowid, body) SELECT rowid, body FROM messages;');
    }
    ftsAvailable = true;
  } catch (e) {
    ftsAvailable = false;
    console.warn('[db] FTS5 nicht verfügbar, Suche nutzt LIKE-Fallback:', e.message);
  }
}
setupFts();

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
