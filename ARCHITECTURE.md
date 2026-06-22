# Ping — Architecture

Ping is a realtime messenger with three clients sharing one backend.

```
                         ┌─────────────────────────────────────────┐
                         │            ping-server (Node)            │
   Android (Flutter) ───▶│  Express REST  ·  WebSocket  ·  SQLite   │
   Windows (WebView2) ──▶│  helmet CSP · rate limits · Zod · JWT    │
   Ping Web (vanilla) ──▶│  FCM push · WebRTC signalling · backups  │
                         └─────────────────────────────────────────┘
```

## Components

### `server/` — the backend (Node 22, no build step)
- **Runtime:** Express 4 + `ws`, persisted to **SQLite** via the built-in
  `node:sqlite` (`DatabaseSync`) — `npm ci` only, nothing to compile.
- **Entry:** `src/index.js` builds the app (`createApp`), wires helmet CSP, CORS,
  three tiered rate limiters (`/api/auth`, `/api/admin`, general `/api`), mounts
  the web app, downloads and admin portal, then attaches the WebSocket hub.
- **Routing:** `src/routes.js` is the main REST surface; `src/apiV1.js` is the
  key-authenticated public developer API (`/api/v1`).
- **Realtime:** `src/hub.js` — auth'd WebSocket connections, presence, typing,
  receipts, message/-update fan-out, WebRTC call signalling.
- **Data:** `src/db.js` owns the schema (`CREATE TABLE IF NOT EXISTS` + a small
  in-place migration). Domain repos: `repo.js`, `chatRepo.js`, `configRepo.js`,
  `telemetryRepo.js`, `postsRepo.js`, … Each owns its prepared statements.
- **Validation:** `src/validation.js` — every request body is parsed with a Zod
  schema via `parse(schema, body)`, which throws a `400` on failure.
- **Config:** `src/config.js` reads env (`.env`); `configRepo.js` holds the
  server-driven *remote* config (feature flags, limits, notice, maintenance,
  min supported build) served at `GET /api/config`.
- **Static serving:** `src/webapp.js` serves the Ping Web client on the web
  subdomain (its own tight CSP, `worker-src 'self'` for the service worker),
  leaving `/api`, `/ws`, `/health` to the normal handlers (same-origin → no CORS).

### `server/public/webclient/` — Ping Web (vanilla JS, no build)
A modular ES-module SPA — no framework, no bundler. Served as static files.

| Module | Responsibility |
|--------|----------------|
| `app.js` | bootstrap, session lifecycle, shell, sockets→store glue, shortcuts |
| `api.js` | JWT REST client, authed blob URLs, request inspector ring buffer |
| `socket.js` | the realtime WebSocket (reconnect/backoff, `isConnected()`) |
| `store.js` | single source of truth + tiny pub/sub (`on`/`emit`) |
| `prefs.js` | device-side preferences (theme, accent, a11y, per-device chat state) |
| `ui.js` | DOM builder `el()`, icons, avatars, toasts, modals, menus |
| `chat.js` / `chats.js` | conversation pane + chat list |
| `flags.js` | feature flags (defaults → remote → local override) |
| `outbox.js` | persistent offline send-queue (queues message *sends*) |
| `idb.js` · `cache.js` | offline read-through cache (chat list + recent messages) in IndexedDB |
| `syncqueue.js` | persists & replays read/delivered acks across reconnects |
| `validate.js` | id guards for deep-link params (`?chat=`, `?u=`) |
| `telemetry.js` | privacy-first, opt-in diagnostics + crash + performance capture |
| `debug.js` | developer & diagnostics panel |
| `share.js` | Web-Share / clipboard sharing |
| `skeleton.js` | loading skeletons |
| `mentions.js` | @-mention tokeniser, "mentions me" detection, composer autocomplete |
| `drafts.js` | per-chat unsent message drafts (localStorage) |
| `activity.js` | activity / notifications feed + slide-over panel |
| `shortcuts.js` | keyboard-shortcut cheat sheet (the canonical binding list) |
| `themes.js` | Theme Studio: presets, custom accent, `ping-theme:` codes |
| `insights.js` | device-local usage insights (never transmitted) |
| `channels.js` | Communities: Entdecken directory, create/preview/edit dialogs, `?c=` deep links |
| `sw.js` | service worker (app-shell precache + runtime cache + update prompt) |

State flows one way: socket/REST events mutate the **store**, the store emits,
views re-render. UI is built with `el()` (text nodes, never `innerHTML`).

### `app/` — Flutter app (Android · Windows · Web)
- **Android:** the native Flutter client. Release builds are signed with a
  **stable keystore** (`android/key.properties` + `ping-release.jks`, gitignored)
  so in-app OTA updates install over existing installs.
- **Windows:** a thin **WebView2 shell** (`webview_windows`) pointed at Ping
  Web, plus tray/notifications/autostart — so it inherits every web improvement.
- **Web:** a Flutter web build also exists, but the live web subdomain serves the
  dedicated vanilla-JS client above.

## Request lifecycle (web client)
1. `app.js` boots, registers `sw.js`, installs telemetry, outbox, cache + sync-queue.
2. `GET /api/me` restores the session; the **cache hydrates** the last chat list
   from IndexedDB before the first paint; the shell renders; the socket connects.
3. REST loads chats/messages (reconciling the cache); socket events stream
   updates into the store, which the cache persists passively as they flow.
4. Sends `POST /api/chats/:id/messages`; on network failure the **outbox** queues
   and shows a pending bubble, flushing on reconnect. Read/delivered acks that
   can't reach a downed socket are parked in the **sync-queue** and replayed.

## Offline-first
The app stays useful with no network. Three independent layers cooperate:
**cache.js** (read-through IndexedDB store of the chat list + the newest ~80
messages per chat, replayed instantly on boot and on chat-open), **outbox.js**
(durable send-queue for outgoing messages), and **syncqueue.js** (deduped
read/delivered acks). The cache is scoped to one account via an `owner` record
and wiped on logout, so a shared device never leaks one account's data to the
next. All three degrade gracefully when IndexedDB/localStorage is unavailable.

## In-app updates (Android OTA)
The Android client self-updates from the same host that serves the marketing
site. The server exposes `GET /download/info` (universal build + per-ABI splits,
each with size, sha256 and a version code) and streams the APKs from
`server/public/downloads/`.

The app's `UpdateService` (`update_service_io.dart`) picks the split matching the
device's primary ABI (a much smaller download), compares version codes, and hands
the download to **Android's system `DownloadManager`** through the `ping/native`
MethodChannel (`MainActivity.kt`). Because DownloadManager runs in the system
process, the download **survives the app being backgrounded or killed**, shows a
system progress notification, and resumes across connectivity changes. The
in-flight id is persisted (`shared_preferences`), so reopening the update sheet
**rejoins** a running download or offers to install a finished one. Before
launching the installer, the downloaded bytes are verified against the manifest's
size + sha256; install goes through a grantable `content://` URI. An in-process
HTTP stream remains as a fallback when DownloadManager can't enqueue.

Downloads are **resumable**: `download.js` answers `Range:` requests with `206
Partial Content` (plus `Accept-Ranges`, `ETag`, `Last-Modified`) for the APK,
its splits and the Windows `.exe`. The updater also emits an anonymous OTA funnel
(`update_offered/started/downloaded/install_launched/failed`) to `/api/telemetry`.

## Diagnostics pipeline (opt-in)
`telemetry.js` keeps a **local** event/crash buffer for the debug panel. Only
when the user enables *Diagnose & Absturzberichte* does it `sendBeacon`
anonymous batches to `POST /api/telemetry` / `POST /api/client-error`
(`telemetryRepo.js` aggregates counts + caps crash storage). Admins read a
summary at `GET /api/admin/diagnostics`.

## Device intelligence (0.24.0)
A read-only hardware/OS layer. On Android, `MainActivity.kt` exposes diagnostics
methods over the existing `ping/native` MethodChannel — `deviceInfo`,
`batteryStatus`, `thermalStatus`, `networkType`, `storageInfo`, `memoryInfo`
(from `BatteryManager`/`PowerManager`/`ConnectivityManager`/`ActivityManager`/
`StatFs`, incl. the `os.version` kernel string) and a `vibrate` haptic. The
Dart `DeviceInfoService` wraps them into the typed, null-safe `DeviceStatus`
model (`models/device_status.dart`); the **Geräte & Diagnose** screen renders a
live view, and `shouldConserveData()` drives adaptive back-off (metered network /
battery-saver / low battery). The web client's `device.js` mirrors this via the
Battery/Network-Information/Storage browser APIs and gates idle prefetch on
Save-Data.

Both clients can emit one **bucketed** snapshot (coarse labels only — e.g.
battery `40-59`, android `14`, net `wifi`, ram `6-8`) to `POST
/api/telemetry/device`. `deviceStatsRepo.js` aggregates it into the
`device_metrics` table (a counter per day × app × metric × bucket — no per-user
rows, no identity), surfaced as `fleet` inside `GET /api/admin/diagnostics`.
Kill-switchable via the `deviceDiagnostics` / `adaptiveData` / `deviceTelemetry`
remote flags.

## Notifications & OS integration (0.25.0)
Ping reaches the user *outside* the app on every platform, through one server
fan-out (`sendPushToUsers` in `push.js`) that drives **both** transports:

- **FCM (Android)** — unchanged for announcements/status/calls. New-message
  pushes are now sent as **data messages** with `clientNotification: true`
  (title/body folded into `data`), so the Flutter side draws them itself and can
  attach **inline reply (`RemoteInput`)** + **mark-read** actions. The foreground
  path renders them directly; the background/terminated path renders them in the
  FCM background isolate. Action taps land in `notificationActionBackground`
  (`notification_service.dart`), a top-level isolate entry point that reads the
  persisted bearer token + base URL from `SharedPreferences` and POSTs the reply
  (`/chats/:id/messages`) or read (`/chats/:id/read`) over HTTPS — working even
  with the app closed. `MainActivity.setChatShortcuts` publishes dynamic launcher
  shortcuts; `PingTileService` is a Quick-Settings snooze tile whose state
  (`ping_snooze_until`, shared via `FlutterSharedPreferences`) is honoured at the
  single `NotificationService.showMessage` choke point.
- **Web Push (browser + Windows shell)** — `webpush.js` implements the standards
  directly on `node:crypto`: a fresh ECDH P-256 ephemeral key per message,
  `HKDF` → `AES-128-GCM` payload encryption (RFC 8291 / RFC 8188 `aes128gcm`) and
  an ES256 **VAPID** JWT (RFC 8292, raw `r‖s` signature) — no dependency. Browser
  subscriptions live in `web_push_subscriptions` (`webPushRepo.js`); the client
  (`webclient/webpush.js`) subscribes via the Push API and mirrors the auth token
  into an IndexedDB store the service worker reads. `sw.js` handles `push`
  (Öffnen / Als gelesen actions), `notificationclick` (focus + route, or
  mark-read with no tab open) and `pushsubscriptionchange` (auto re-subscribe).
  `navigator.setAppBadge()` shows the unread count on an installed PWA's OS icon.

VAPID keys (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) gate the whole web path; the
private key never leaves the server. Generate them with
`node -e "import('./src/webpush.js').then(m=>console.log(m.generateVapidKeys()))"`.

## On-device diagnostics — Android (0.26.0)
Unlike the web client's telemetry (which can batch anonymous counts to the
server), the Flutter app's 0.26.0 diagnostics are **strictly local** — there is
no upload path at all.
- **`crash_service.dart`** — a singleton ring buffer (50) of recent errors.
  `main()` runs the app inside `runZonedGuarded` (binding initialised in the same
  zone) and chains `FlutterError.onError` + `PlatformDispatcher.instance.onError`
  so framework and uncaught async errors are captured. Reports are persisted via
  `doc_store` and **redacted** (phone numbers, bearer/`token=` fragments,
  JWT-shaped triplets) before they touch disk. Surfaced in `diagnostics_screen.dart`.
- **`metrics_service.dart`** — opt-in (`PingSettings.collectMetrics`, default
  off) integer counters with rolling 30-day buckets, persisted via `doc_store`.
  `bump()` no-ops until enabled, so `AppState` call sites (send, open chat, call,
  status, app-open) are unconditional. Visualised by `insights_screen.dart` with
  a `CustomPaint` 7-day bar chart (no chart package).
- **`dev_panel_screen.dart`** — unlocked by seven taps on the version row
  (`devOptionsUnlocked`); a read-only feature-flag/remote-config inspector, the
  `showPerformanceOverlay` toggle (wired on `MaterialApp`), and build/device facts.
- **UX:** `widgets/skeleton.dart` (shimmer chat-list placeholder) and a custom
  fade-through `PageTransitionsBuilder` in `theme.dart`; both collapse to a static
  / instant form when *reduce motion* is on.

## Organising conversations (0.27.0)
Four additive, full-stack features that all follow the same shape: a small SQLite
table, REST endpoints behind `requireAuth` + `memberGuard`, a realtime WebSocket
event for live/cross-device sync, and UI on web + Android.
- **Pinned messages** — `pinned_messages(chat_id, message_id, pinned_by,
  pinned_at)`. `POST`/`DELETE /chats/:id/messages/:msgId/pin`, `GET
  /chats/:id/pins`; `messageView.pinned` + `chatView.pinnedCount`. The
  `chat-pins-updated` event carries the per-viewer-rendered pin list so banners
  update without a refetch. Cap `MAX_PINS_PER_CHAT = 50`.
- **Saved/starred** — `starred_messages(user_id, message_id, chat_id,
  created_at)`. `POST /chats/:id/messages/:msgId/star` (toggle), `GET
  /me/starred`; per-viewer `messageView.starred`; `starred-updated` echoes to the
  user's own devices. The Flutter app keeps its local `starredStore` for the
  offline Saved screen and mirrors toggles up; the web client seeds from the
  server on launch.
- **Drafts** — `chat_drafts(user_id, chat_id, text, updated_at)`. `PUT
  /chats/:id/draft` (empty clears); `chatView.draft` + `draft-updated`. Both
  clients debounce the upload (~700 ms) and keep working offline/local-first.
- **Folders** — `chat_folders` + `chat_folder_members` (`foldersRepo.js`).
  `GET/POST/PATCH/DELETE /me/folders`, `PUT /me/folders/:id/chats`;
  `folders-updated`. Chat assignment is intersected with the user's real
  memberships server-side. Cap `MAX_FOLDERS = 20`. Rendered as filter
  chips/tabs above the chat list, exclusive with the built-in quick filters.
- **In-chat search** — `GET /messages/search?chatId=…` reuses the LIKE search,
  constrained to one (membership-checked) chat.

## Channels / Communities (0.31.0)
Public, discoverable **broadcast channels** — kill-switchable via the remote flag
`communities`. A channel is *not* a new entity: it is a `type='group'` chat with
four additive `chats` columns — `visibility='public'`, a globally-unique
`handle`, `broadcast=1` and a directory `category`. That reuse means messages,
reactions, pins, FTS search and push all work unchanged the moment you follow one.

- **Schema** (`db.js`): the columns are in the initial schema *and* added to old
  databases by idempotent `ALTER TABLE`s in `ensureColumns()`. A partial unique
  index `idx_chats_handle (handle COLLATE NOCASE) WHERE handle IS NOT NULL` makes
  handles case-insensitively unique among channels while exempting ordinary
  chats; `idx_chats_public (visibility) WHERE visibility='public'` keeps the
  directory query cheap. These indexes live in `ensureColumns()` (not the initial
  block) so they never reference a column an old DB hasn't gained yet.
- **Repo** (`chatRepo.js`): `createChannel`, `getChannelByHandle`,
  `listChannelDirectory` (sub-count-ranked, `q` + `category` filtered),
  `channelCard`, `updateChannelMeta`, `subscriberCount`, `normalizeHandle`.
  `chatView` surfaces `isChannel/handle/broadcast/category/role/subscriberCount`
  and a derived **`canPost`** (false for a broadcast-channel subscriber); the full
  member list is omitted for non-owner subscribers to keep payloads small.
- **Routes**: `POST /channels` (409 on a taken handle), `GET /channels`
  (directory), `GET /channels/:handle` (deep-link lookup + owner), `POST
  /channels/:handle/join` (idempotent; pings the owner live), `PATCH /channels/:id`
  (owner-only). The send route gates a non-owner's post in a `broadcast` channel
  with a 403 (distinct from a read-only `locked` channel, which blocks everyone).
- **Web** (`channels.js`): the **Entdecken** directory pane, create dialog (live
  handle-availability check), preview/hero card, owner edit dialog and the
  `/?c=<handle>` deep link. The chat header shows a 📣 badge + subscriber count
  and swaps the composer for a read-only notice for subscribers.

## Identity & protection (0.32.0)
Account-level identity + security, kill-switchable via `usernames`, `twoFactor`
and `privacyControls`. Four pillars, all server-enforced.

- **Usernames** (`repo.js`, `db.js`): an additive `users.username` column (stored
  lowercased) with a partial unique index `idx_users_username … WHERE username IS
  NOT NULL`, created in `ensureColumns()` after the `ALTER`. `setUsername`,
  `getUserByUsername`, a reserved-name guard and `searchPeople` (exact-handle hits
  first, honouring each user's `username_searchable` switch) power
  `GET/PUT/DELETE /me/username`, `GET /me/username/check`,
  `GET /users/by-username/:handle` and `GET /people/search`. `publicUser` exposes
  `username`; the web resolves `?u=@name` deep links and offers `@`-search in the
  new-chat modal.
- **Two-factor auth (TOTP)** (`totp.js`, `twofaRepo.js`): a dependency-free RFC
  6238 engine on `node:crypto` (base32, HOTP/TOTP, constant-time verify with ±1
  drift, `otpauth://` builder). `user_totp` holds a *pending* secret until the
  first code confirms it (`enabled=1`); `recovery_codes` are sha256-hashed,
  single-use and consumed atomically. Flow: `/me/2fa/{setup,enable,disable,
  recovery}`; on login a 2FA account gets a short-lived
  `purpose:'2fa_challenge'` token (no session) redeemed at `POST /auth/login/2fa`
  with a TOTP **or** recovery code. The web has a setup wizard (QR via the same
  `vendor/qrcode.min.js` used for device-linking) + a login challenge screen; the
  Flutter login raises `TwoFactorRequiredException` and finishes via
  `loginTwoFactor()`.
- **Privacy** (`repo.js`): `privacy_messages` / `privacy_groups`
  (`everyone|contacts`) are checked at `/chats/direct` and `/chats/:id/members`
  using `usersAreConnected` (shared chat **or** a contact in either direction);
  group-add returns the `skipped` names. `username_searchable` gates people search.
- **Sessions & audit** (`auth.js`, `securityRepo.js`): every token carries a `tv`
  claim equal to the account's `token_epoch`; `requireAuth` rejects a stale epoch,
  and `POST /me/logout-all` bumps it to invalidate all other devices (a missing
  `tv` reads as `0`, so the deploy logs nobody out). `security_events` is an
  append-only feed with server-side German labels, surfaced at
  `GET /me/security-log` and trimmed to 100 rows/user by the maintenance sweep.
- **Web** (`security.js`): a lazily-loaded **Sicherheit** settings tab hosting the
  username claimer, 2FA wizard + recovery-code export, disable/rotate, "überall
  abmelden" and the audit feed; the **Datenschutz** tab gains the reach selectors.

## Zusammen — money & time (0.36.0)
Two more **structured message types** on the poll pattern, kill-switchable via
`splitExpenses` / `availabilityPolls`. `migrateMessageTypes036()` widens the
`messages.type` CHECK to admit `expense` + `availpoll` with the same FTS-aware
FK-off table swap (drops the orphaned `messages_fts` so `setupFts()` rebuilds +
backfills). `TYPE_ALIASES` learns `kasse`/`ausgabe` and `terminfindung` for the
`typ:` search filter.

- **Shared expenses (`expense`).** `expenseRepo.js` + `expenses` /
  `expense_shares`. `POST /chats/:id/expenses` resolves the split server-side
  (equal → even shares with the remainder cents spread over the first few; custom
  → supplied shares, which must sum to the total) so the ledger always balances.
  The ledger is **derived**, not stored: `net(u) = Σ(paid by u) − Σ(u's shares)`
  over non-deleted expense rows, grouped by currency; `settleUp()` is a pure
  greedy min-cash-flow that returns the minimal transfer set. A **settlement** is
  the same row shape (payer pays one beneficiary the full amount), so
  `/chats/:id/ledger/settle` just posts another `expense` and rebalances.
  `GET /chats/:id/ledger` (per-chat) and `GET /me/ledger` (cross-chat overview,
  parallels `/me/events`). Web `expense.js` (create modal, in-chat card, ledger
  modal, "Kasse" nav pane); Flutter `ExpenseData` + a card + a settle-up sheet.
- **Availability polls (`availpoll`).** `availPollRepo.js` + `availpolls` /
  `availpoll_options` / `availpoll_votes`. `POST /chats/:id/availpolls` (2–8
  slots); per-slot yes/maybe/no votes via `…/availpoll/vote`; `availPollView`
  computes per-slot tallies + a front-runner (`yes×2 + maybe`, earliest wins
  ties). `…/availpoll/lock` is **organiser-only**: it mints a real `event`
  message via `createEvent` from the chosen slot, links it (`event_message_id`)
  and closes the poll — so the find-a-time flow ends in a normal RSVP event +
  reminder. Web `availpoll.js`; Flutter `AvailPollData` + a vote-chip card.

## Expression & workbench (0.35.0)
Two more **structured message types** on the poll pattern (side table →
`messageView` → realtime/offline/FTS for free), kill-switchable via `contactCards`
/ `codeSnippets`. `migrateMessageTypes035()` widens the `messages.type` CHECK to
admit `contact` + `code` with the same FTS-aware FK-off table swap (drops the
orphaned `messages_fts` so `setupFts()` rebuilds + backfills).

- **Contact cards (`contact`).** `contactCardRepo.js` + `message_contacts`. `POST
  /chats/:id/contact` snapshots the shared account's public profile (name / handle
  / colour) but `contactCardView` re-reads the *live* `publicUser` on view, so a
  later rename/avatar change is reflected and a tap can open a DM with `userId`.
  Web `contactcard.js` (share modal with people search + render card); Flutter
  `ContactData` + a card with "Chat starten".
- **Code snippets (`code`).** `codeRepo.js` + `message_code`. `POST /chats/:id/code`
  stores the source out-of-band (the `messages.body` keeps only a short
  `codeTeaser` so push previews stay tidy). Web `code.js` renders a card with
  one-tap copy + a fullscreen viewer; highlighting is a **dependency-free**
  tokenizer (`codehl.js`) that escapes every token before wrapping it — so a
  crafted snippet can mis-colour itself but never inject markup. Flutter `CodeData`
  + a monospace card with copy + a fullscreen dialog. `TYPE_ALIASES` learns
  `kontakt` / `code` for the `typ:` search filter.

## "Alles" mega-release (0.34.0)
The biggest single release: **25 features across all four pillars** plus minimal,
strictly-private AI, **each behind its own remote flag** (so the whole thing
dark-ships). Nothing invents a new architecture pattern — it applies the existing
ones (poll/event structured-message recipe, maintenance-sweep, push pipeline,
hub mesh) broadly.

- **Four new structured message types** — `sticker`, `board`, `game`,
  `livelocation` — follow the poll pattern (side table → `messageView` →
  realtime/offline/FTS for free). `migrateMessageTypes034()` widens the
  `messages.type` CHECK and adds the columns `thread_root` / `thread_count` /
  `view_once` / `viewed_at` / `enc`, dropping the orphaned `messages_fts` so
  `setupFts()` rebuilds it (the standing FTS-migration gotcha; verified on a
  `VACUUM INTO` prod snapshot). Side tables added for stickers/boards/games/live
  locations/notes/appearance/scheduled-calls/transcripts/webhooks/E2EE/login
  approvals; new columns `users.default_ttl`, `chat_members.locked/hidden`,
  `events.recur`.
- **Threads** — `messages.thread_root` keeps replies out of `m.history`; the root
  carries `thread_count`. `threadReplies()` + `thread-reply` socket.
- **Group calls** — `hub.js` grows a `callRooms` mesh (join/leave/offer/answer/ice
  + roster broadcast, cleaned up on socket close).
- **Scheduled calls / recurring events / live-location expiry** hang off the
  **maintenance sweep** (`dueScheduledCalls`, `dueRecurringEvents` → spawn next
  occurrence, `dueExpiredLiveLocations` → purge). **Login approvals** are purged
  there too.
- **View-once** — `messageView` withholds the attachment from non-senders;
  `POST …/view` hands the bytes out exactly once (`openViewOnce`) then flips
  `viewed_at` so it's gone for everyone.
- **Opt-in E2EE (DMs)** — `e2eeRepo.js` stores only public identity keys + per-chat
  session state + ciphertext; the server is blind. The web client does WebCrypto
  ECDH(P-256)→AES-GCM, encrypt-on-send (`enc:true`) / decrypt-on-render, and a
  safety number from both public keys. All three preview helpers + push never see
  plaintext.
- **Private AI** — `transcribe.js` (whisper.cpp via `WHISPER_BIN`, transcript joins
  `messageView` + FTS), `translate.js` (LibreTranslate via `LIBRETRANSLATE_URL`),
  catch-up (`summariseMessages`, extractive) and smart replies (`smartReplies`,
  rule-based). All opt-in/local and graceful when unconfigured — no cloud LLM.
- **Web** — 16 new modules wired into `chat.js` (render cards + view-once +
  transcript + thread chip + smart-reply chips + E2EE), the attach menu, the info
  panel "Mehr" section, the security centre and the calls pane. Windows inherits it
  all via the WebView2 wrapper.
- **Android (0.34.1)** — the Flutter app renders + drives every structured type
  natively: `message_bubble.dart` gains content widgets (sticker/board/game/
  livelocation/event/tasklist/view-once/transcript/thread-chip), `app_state.dart`
  the interaction + create calls, `chat_screen.dart` the composers + handlers.
  **Screenshot notice** uses the Android-14 `ScreenCaptureCallback`
  (`MainActivity.kt` → `ping/native` → `launcher_service` → active chat).
  **Group calls** are a mesh `GroupCallController` (one `RTCPeerConnection`/peer
  over the `group-call-*` relay) + a tile-grid `GroupCallScreen`, behind the
  `groupCalls` flag.

## Plans & tasks (0.33.0)
Two new **structured message types**, both following the poll pattern: a normal
`messages` row (`type='event'` / `'tasklist'`) whose payload lives in a side table
and rides along in `messageView`, so the live `message` / `message-updated`
broadcast, the offline cache and FTS all carry them for free. Kill-switchable via
`events` / `taskLists`.

- **Events ("Termine").** `eventsRepo.js` + `events` / `event_rsvps`. `POST
  /chats/:id/events` (member-gated, channel-lock-aware) creates the backing
  message; `POST /chats/:id/messages/:msgId/rsvp` toggles going/maybe/declined (or
  `null` to withdraw). `messageView.event` is viewer-specific (tallies + attendee
  roster + own status). `GET /me/events` is the cross-chat **agenda** (upcoming,
  sorted, each enriched with its chat title). An optional reminder is set as
  `remind_at = start − N min` (the create path refuses a past reminder); the
  **maintenance sweep** picks up due rows, stamps `reminded_at` *first* (once-only),
  then fans out `event-reminder` sockets + `sendPushToUsers` to RSVP'd members +
  the creator. Web `events.js`: create modal, in-chat RSVP card and the **"Termine"**
  nav-rail agenda pane.
- **Task lists ("Aufgaben").** `tasksRepo.js` + `tasklists` / `tasklist_items`
  (50-item cap). `POST /chats/:id/tasklists` creates; `POST
  /chats/:id/messages/:msgId/tasks` appends; `…/tasks/:itemId/toggle` ticks an item
  and records who/when. `messageView.tasklist` carries items + completed/total.
  Web `tasks.js`: create modal + live checklist card with a progress bar.
- **Migration.** Both types required widening the `messages.type` `CHECK`.
  `migrateMessageTypesPlans` does the in-place 12-step FK-off table swap (all rows +
  indexes preserved) **and** drops the orphaned `messages_fts` so `setupFts()`
  rebuilds its triggers and backfills — the older `migrateMessageTypes` predated
  FTS and would otherwise have left search silently un-indexed. Verified against a
  production-DB copy.

## Conversation context (0.28.0)
Two additive features that add context to messages — both kill-switchable via the
remote flags `linkPreviews` / `editHistory`.

- **Link previews.** `linkPreview.js` is a dependency-free fetch+scrape:
  - **SSRF guard** (`assertSafeUrl`): only `http(s)`; the hostname is resolved
    (`node:dns`) and *every* address is rejected if private/loopback/link-local/
    ULA/CGNAT/metadata (`isPrivateIp`); redirects are followed manually with a
    re-check per hop; the body must be HTML and is read with a 512 KB cap + 6 s
    `AbortController` timeout.
  - **Parse** (`parseMetadata`, pure/testable): OpenGraph → Twitter-card →
    `<title>` for the title; og/twitter/meta for description; og/twitter for the
    image (relative URLs resolved against the page); `og:site_name` else host.
    HTML entities decoded.
  - **Cache** (`linkPreviewRepo.js` + `link_previews` table, URL-keyed, shared by
    all users): 24 h TTL for hits, 1 h negative-cache for misses, plus an
    in-process in-flight `Map` so a popular link is fetched once. Endpoint
    `GET /link-preview?url=…` (`requireAuth`, general API rate limiter) always
    returns `200 { preview: … | null }`; the URL shape is validated by
    `linkPreviewUrlSchema` (400 on garbage). Clients (web `linkpreview.js`,
    Flutter `LinkPreviewService` + `LinkPreviewCard`) lazily unfurl the first link
    in a message, memoise per URL, and skip the image on data-saver.
- **Edit history.** `editMessage` snapshots the prior body into `message_edits`
  (skipping no-op saves); `messageView.editCount` exposes the count; `GET
  /chats/:id/messages/:msgId/edits` (member-gated) returns prior versions
  oldest-first plus the current body. Surfaced as a tappable "bearbeitet" tag →
  a modal (web) / bottom sheet (Flutter).

## Reminders, quick replies & export (0.29.0)
Three additive, owner-scoped features — kill-switchable via the remote flags
`reminders` / `quickReplies` / `chatExport`.

- **Message reminders.** `remindersRepo.js` + `message_reminders` (partial
  due-index on `remind_at WHERE fired_at IS NULL`). `POST
  /chats/:id/messages/:msgId/remind` (member-gated) stores a snapshot
  (preview + chat title) so the nudge survives message deletion;
  `GET /me/reminders` and `DELETE /me/reminders/:rid` are owner-scoped. The
  **maintenance sweep** (`runMaintenance`) picks up due rows, stamps `fired_at`
  *first*, then fans out `sendToUser('reminder', …)` + `sendPushToUsers`, and
  purges rows fired > 7 days ago. Clients: web `reminders.js` (dialog + live
  pane + toast), Flutter `Reminder` model + `AppState` + `RemindersScreen`
  (a fired reminder raises a snooze-bypassing notification).
- **Quick replies.** `quickRepliesRepo.js` + `quick_replies` (per-user,
  reorderable). CRUD under `/me/quick-replies`; every mutation broadcasts
  `quick-replies-updated` to the user's other devices. Web `quickreplies.js`
  is server-backed with a localStorage mirror, one-time migration of the old
  device-only `prefs.quickReplies`, and inline `/shortcut` expansion.
- **Per-chat export.** `GET /chats/:id/export?format=txt|json` (member-gated)
  streams the full visible history with a `Content-Disposition` attachment;
  the web client downloads it via an authenticated raw fetch (local export is
  the offline fallback).

## Find & focus (0.30.0)
Two additive features, kill-switchable via `messageSearch` / `focusMode`.

- **Full-text search.** `db.js` creates an external-content FTS5 table
  `messages_fts` (`content='messages'`, `content_rowid='rowid'`) maintained by
  `AFTER INSERT/UPDATE/DELETE` triggers on `messages`, backfilled once on boot.
  It probes FTS5 and exports `ftsAvailable`; `chatRepo.searchMessages` uses
  `MATCH` + `bm25()` + `snippet()` when available and **falls back to the LIKE
  scan** otherwise. `parseSearchQuery` extracts filter operators (`von:`/`from:`,
  `typ:`/`type:`, `nach:`/`after:`, `vor:`/`before:`); the free-text part is
  sanitised to letters/digits before becoming a prefix `MATCH` (no FTS-syntax
  injection). `GET /messages/search` stays membership-scoped and adds
  `snippet`/`chatTitle`/`senderName` to each hit. Web `search.js` renders the
  dedicated, debounced, skeleton-loaded surface with `<mark>` highlighting (DOM
  nodes, XSS-safe) and jumps to the message via `openChat({ focusMessageId })`.
- **Focus mode / quiet hours.** `focusRepo.js` + `user_focus` (manual
  `focus_until` + quiet-hours window as minutes-of-day with a 7-bit day mask) and
  `focus_autoreplies` (per-peer throttle). `isUserSilenced()` (handles a window
  crossing midnight) gates push in `deliver.js` via `filterAudible()` — the live
  socket fan-out is untouched, so enforcement is server-side and applies to every
  client. `GET/PUT /me/focus` (validated by `focusSchema`, broadcast over
  `focus-updated`). `maybeAutoReply()` sends a one-time canned reply to DMs for a
  silenced recipient (DM-only, block-aware, throttled, delivered with `auto:true`
  so it can't recurse); the maintenance sweep purges stale throttle rows. Web
  `focus.js` owns the dialog + nav-rail indicator.

## Deploy
- **Web/server:** this checkout is the live host. Edit in place, then
  `sudo systemctl restart ping-server` (loads new server code + creates new
  tables; static files are served fresh, `max-age=0` + ETag). Bump
  `CACHE_VERSION` in `sw.js` on every web release.
- **Android/Windows:** built in GitHub Actions (`android-build.yml`,
  `windows-build.yml`); artifacts are dropped into `server/public/downloads/`
  (`publish-apk.sh` verifies each APK's version with `aapt`).
