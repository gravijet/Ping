import { db, now } from './db.js';

// Storage for the anonymous, opt-in client diagnostics. Two deliberately
// privacy-preserving shapes:
//   • client_events — aggregate counts per (event name, day, app). No per-user
//     rows, no identity, bounded by the small set of event names × days.
//   • client_errors — a capped ring of recent crash reports for debugging,
//     pruned to MAX_ERRORS on every insert so it can never grow without bound.
// The only caller-supplied identifier is an opaque random device id (aid).

const MAX_ERRORS = 500;

const stmt = {
  upsertEvent: db.prepare(`
    INSERT INTO client_events (name, day, app, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(name, day, app) DO UPDATE SET count = count + 1`),
  insertError: db.prepare(`
    INSERT INTO client_errors (created_at, app, aid, context, message, stack, ua, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  pruneErrors: db.prepare(`
    DELETE FROM client_errors WHERE id NOT IN
      (SELECT id FROM client_errors ORDER BY id DESC LIMIT ?)`),
  topEvents: db.prepare(`
    SELECT name, app, SUM(count) AS count FROM client_events
    WHERE day >= ? GROUP BY name, app ORDER BY count DESC LIMIT 200`),
  recentErrors: db.prepare(`
    SELECT id, created_at AS createdAt, app, aid, context, message, stack, url
    FROM client_errors ORDER BY id DESC LIMIT ?`),
  errorCount: db.prepare('SELECT COUNT(*) AS n FROM client_errors'),
};

const dayStr = (ts) => new Date(ts).toISOString().slice(0, 10);

/** Record a batch of anonymous events, aggregated by the server-received day. */
export function recordEvents(app = 'web', events = []) {
  const day = dayStr(now());
  for (const ev of events.slice(0, 50)) {
    if (!ev || typeof ev.name !== 'string' || !ev.name) continue;
    stmt.upsertEvent.run(ev.name.slice(0, 60), day, app);
  }
}

/** Record one crash report, then prune the table back to its cap. */
export function recordError(rec = {}) {
  stmt.insertError.run(
    now(), rec.app || 'web', rec.aid || null, rec.context || null,
    rec.message || null, rec.stack || null, rec.ua || null, rec.url || null,
  );
  stmt.pruneErrors.run(MAX_ERRORS);
}

/** Admin summary: top events over the last `days` + recent crash reports. */
export function telemetrySummary({ days = 7, errorLimit = 50 } = {}) {
  const since = dayStr(now() - days * 86400000);
  return {
    sinceDay: since,
    days,
    topEvents: stmt.topEvents.all(since),
    totalErrors: stmt.errorCount.get().n,
    recentErrors: stmt.recentErrors.all(errorLimit),
  };
}
