import { createHash } from 'node:crypto';
import { db, now } from './db.js';

// Storage for the anonymous client diagnostics. Two deliberately
// privacy-preserving shapes:
//   • client_events — aggregate counts per (event name, day, app). No per-user
//     rows, no identity, bounded by the small set of event names × days. Still
//     opt-in (behaviour analytics).
//   • client_errors — a developer-facing bug inbox of crash reports. Auto-sent
//     by the clients (Fehlerberichte), de-duplicated per server-computed
//     fingerprint so the same crash collapses into one row (count + last_seen),
//     and carrying a triage status ('open' → 'resolved') so a fresh Claude
//     session can list the open ones, fix them, and mark them done. Carries no
//     identity beyond the opaque random device id (aid) — never message content.
// Pruned to MAX_ERRORS distinct crashes on every insert so it can't grow
// without bound.

const MAX_ERRORS = 500;

const stmt = {
  upsertEvent: db.prepare(`
    INSERT INTO client_events (name, day, app, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(name, day, app) DO UPDATE SET count = count + 1`),
  // One row per distinct crash. A recurrence bumps count/last_seen and re-opens
  // it (a "fixed" report that fires again clearly wasn't fixed).
  upsertError: db.prepare(`
    INSERT INTO client_errors
      (created_at, last_seen, app, app_version, aid, context, message, stack, ua, url, fingerprint, count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open')
    ON CONFLICT(fingerprint) DO UPDATE SET
      count        = count + 1,
      last_seen    = excluded.last_seen,
      app_version  = COALESCE(excluded.app_version, client_errors.app_version),
      stack        = COALESCE(excluded.stack, client_errors.stack),
      url          = COALESCE(excluded.url, client_errors.url),
      status       = 'open',
      resolved_at  = NULL`),
  pruneErrors: db.prepare(`
    DELETE FROM client_errors WHERE id NOT IN
      (SELECT id FROM client_errors ORDER BY id DESC LIMIT ?)`),
  topEvents: db.prepare(`
    SELECT name, app, SUM(count) AS count FROM client_events
    WHERE day >= ? GROUP BY name, app ORDER BY count DESC LIMIT 200`),
  recentErrors: db.prepare(`
    SELECT id, fingerprint, created_at AS createdAt, last_seen AS lastSeen, count, status,
           app, app_version AS appVersion, aid, context, message, stack, url
    FROM client_errors ORDER BY last_seen DESC, id DESC LIMIT ?`),
  openErrors: db.prepare(`
    SELECT id, fingerprint, created_at AS createdAt, last_seen AS lastSeen, count,
           app, app_version AS appVersion, context, message, stack, url
    FROM client_errors WHERE status = 'open' ORDER BY last_seen DESC, id DESC LIMIT ?`),
  errorCount: db.prepare('SELECT COUNT(*) AS n FROM client_errors'),
  openCount: db.prepare("SELECT COUNT(*) AS n FROM client_errors WHERE status = 'open'"),
};

const dayStr = (ts) => new Date(ts).toISOString().slice(0, 10);

// Collapse one crash into a stable id so repeated reports of the same bug land
// on one row. We hash the platform + context + a noise-stripped message + the
// first real stack frame; line/column numbers and other digits are masked to '#'
// so a crash at a slightly shifted offset still groups together.
function fingerprintOf(rec = {}) {
  const norm = (s) =>
    String(s || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
  const firstFrame =
    String(rec.stack || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('at ') || /\.(js|mjs|ts|dart|kt|java)\b/.test(l)) || '';
  const basis = [rec.app || 'web', rec.context || '', norm(rec.message), norm(firstFrame)].join('|');
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

/** Record a batch of anonymous events, aggregated by the server-received day. */
export function recordEvents(app = 'web', events = []) {
  const day = dayStr(now());
  for (const ev of events.slice(0, 50)) {
    if (!ev || typeof ev.name !== 'string' || !ev.name) continue;
    stmt.upsertEvent.run(ev.name.slice(0, 60), day, app);
  }
}

/** Record one crash report (de-duplicated by fingerprint), then prune the table
    back to its cap. Returns the fingerprint so callers can correlate. */
export function recordError(rec = {}) {
  const ts = now();
  const fp = fingerprintOf(rec);
  stmt.upsertError.run(
    ts, ts, rec.app || 'web', rec.appVersion || null, rec.aid || null,
    rec.context || null, rec.message || null, rec.stack || null,
    rec.ua || null, rec.url || null, fp,
  );
  stmt.pruneErrors.run(MAX_ERRORS);
  return fp;
}

/** Open (un-triaged) crash reports, newest activity first — the dev bug inbox. */
export function openErrors(limit = 50) {
  return stmt.openErrors.all(Math.min(500, Math.max(1, limit | 0)));
}

/** Mark crash reports resolved. Accepts ids and/or fingerprints. Returns the
    number of rows actually closed (already-resolved rows aren't re-touched). */
export function resolveErrors(refs = []) {
  const list = (Array.isArray(refs) ? refs : [refs]).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return 0;
  const ph = list.map(() => '?').join(',');
  const r = db
    .prepare(
      `UPDATE client_errors SET status = 'resolved', resolved_at = ?
       WHERE status = 'open' AND (id IN (${ph}) OR fingerprint IN (${ph}))`
    )
    .run(now(), ...list, ...list);
  return r.changes;
}

/** Count of currently-open crash reports. */
export function openErrorCount() {
  return stmt.openCount.get().n;
}

/** Admin summary: top events over the last `days` + recent crash reports. */
export function telemetrySummary({ days = 7, errorLimit = 50 } = {}) {
  const since = dayStr(now() - days * 86400000);
  return {
    sinceDay: since,
    days,
    topEvents: stmt.topEvents.all(since),
    totalErrors: stmt.errorCount.get().n,
    openErrors: stmt.openCount.get().n,
    recentErrors: stmt.recentErrors.all(errorLimit),
  };
}
