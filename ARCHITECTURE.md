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

## Deploy
- **Web/server:** this checkout is the live host. Edit in place, then
  `sudo systemctl restart ping-server` (loads new server code + creates new
  tables; static files are served fresh, `max-age=0` + ETag). Bump
  `CACHE_VERSION` in `sw.js` on every web release.
- **Android/Windows:** built in GitHub Actions (`android-build.yml`,
  `windows-build.yml`); artifacts are dropped into `server/public/downloads/`
  (`publish-apk.sh` verifies each APK's version with `aapt`).
