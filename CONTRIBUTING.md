# Contributing to Ping

Thanks for helping build Ping! This guide covers the setup, the conventions the
codebase already follows, and how to test before you ship.

## Project layout

```
server/   Node backend (Express + ws + SQLite) — also serves Ping Web
  src/                application code (routes, repos, hub, validation, config)
  public/webclient/   Ping Web — vanilla-JS SPA (no build)
  test/               node:test suites + the web-client smoke test
app/      Flutter app (Android · Windows shell · web)
.github/workflows/    CI + Android/Windows build pipelines
```

See **ARCHITECTURE.md** for how it all fits together.

## Setup

### Server + Ping Web
```bash
cd server
npm ci
cp .env.example .env        # fill in secrets (JWT_SECRET at minimum)
npm run dev                 # http://localhost:61337  (--watch reload)
```
Ping Web has **no build step** — edit files in `server/public/webclient/` and
reload the browser.

### Flutter app
```bash
cd app
flutter pub get
flutter run                 # Android device/emulator
flutter run -d windows      # Windows desktop shell
```

## Conventions

**General**
- Match the surrounding code: comment density, naming, idioms. Comments explain
  *why*, not *what*.
- German for all user-facing strings (UI copy, errors, toasts).
- Keep changes additive and non-breaking — this backend runs in production.

**Server (`server/src/`)**
- ES modules, Node 22, no transpile.
- Validate every request body with a Zod schema from `validation.js` via
  `parse(schema, req.body)` (throws `400`). Add new schemas there.
- Each domain owns a `*Repo.js` with its prepared statements; schema lives in
  `db.js` as `CREATE TABLE IF NOT EXISTS` (safe to add on a live DB).
- Never leak stack traces; let the central error handler shape responses.

**Ping Web (`server/public/webclient/`)**
- Build DOM with `el(tag, attrs, children)` from `ui.js`. **Never** assign
  untrusted `innerHTML` — render text nodes.
- State lives in `store.js`; mutate it, then `emit` — views subscribe via `on`.
- Lazily `import()` heavy/rarely-used panes (see how `app.js` loads sections).
- Gate new features behind a flag in `flags.js` when it makes sense.
- Bump `CACHE_VERSION` in `sw.js` whenever web assets change for a release.

## Testing — required before a PR

```bash
cd server
npm test                       # node:test suite (REST, WS, links, diagnostics)
node test/webclient-smoke.mjs  # headless web-client import/boot smoke test

cd ../app
flutter analyze
flutter test
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR.

- Add server tests for new endpoints (mirror `test/diagnostics.test.js`; tests
  run against an in-memory DB, so they never touch real data).
- Add a smoke-test step for any new web-client module so import/boot regressions
  are caught without a browser.
- For **pure** web-client logic (parsing, encoding, storage helpers), add a
  `node:test` case to `test/webclient-logic.test.js` (or
  `test/webclient-offline.test.js` for cache/sync/validation/perf helpers) —
  these run under `npm test` with only a tiny in-memory `localStorage` shim, no
  DOM needed.

## Releasing

1. Bump the version in `app/pubspec.yaml`, `server/package.json`, `sw.js`
   (`CACHE_VERSION`) and `settings.js` (`WEB_CLIENT_VERSION`).
2. Add a `CHANGELOG.md` entry.
3. Web/server: deploy on the host (`sudo systemctl restart ping-server`).
4. Android/Windows: run the build workflows from the Actions tab; drop the
   artifacts into `server/public/downloads/` (`publish-apk.sh` for APKs).
5. Publish the in-app "Was ist neu" post (version must match the app version).

## Commit messages
Short imperative subject, optional scope, e.g.
`web: add offline send-queue` · `server: telemetry endpoints` · `CI: android build`.
