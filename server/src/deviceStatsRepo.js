import { db, now } from './db.js';

// Aggregate store for the anonymous, opt-in device-fleet telemetry. Each client
// snapshot is a small bag of *bucketed* readings — coarse strings like battery
// '40-59' or android '14', never raw numbers — and we keep nothing but a counter
// per (day, app, metric, bucket). There are no per-device rows and no identity:
// the table can only ever answer "how is the installed base distributed", which
// is exactly what the admin "Geräteflotte" view needs.
//
// Defence in depth: the route validates with deviceStatsSchema first, but we
// also slice every string and cap the per-metric fan-out here so a hand-crafted
// payload can't bloat the table.

const MAX_METRICS = 20; // distinct metric names accepted per snapshot
const MAX_LEN = 24; // max chars for a metric name or bucket label

const stmt = {
  bump: db.prepare(`
    INSERT INTO device_metrics (day, app, metric, bucket, count) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(day, app, metric, bucket) DO UPDATE SET count = count + 1`),
  distribution: db.prepare(`
    SELECT metric, bucket, SUM(count) AS count FROM device_metrics
    WHERE day >= ? GROUP BY metric, bucket ORDER BY metric ASC, count DESC`),
  apps: db.prepare(`
    SELECT DISTINCT app FROM device_metrics WHERE day >= ? ORDER BY app`),
};

const dayStr = (ts) => new Date(ts).toISOString().slice(0, 10);
const clean = (s) => String(s).trim().slice(0, MAX_LEN);

/**
 * Record one anonymous device snapshot. `metrics` is a flat object of
 * metric→bucket strings (e.g. { android: '14', net: 'wifi', battery: '40-59' }).
 * Empty/blank buckets are skipped so an unavailable reading just doesn't count.
 */
export function recordDeviceSnapshot(app = 'android', metrics = {}) {
  const day = dayStr(now());
  const entries = Object.entries(metrics || {}).slice(0, MAX_METRICS);
  for (const [metric, bucket] of entries) {
    if (!metric || bucket == null || bucket === '') continue;
    const m = clean(metric);
    const b = clean(bucket);
    if (!m || !b) continue;
    stmt.bump.run(day, app, m, b); // the seed count of 1 is literal in the SQL
  }
}

/**
 * Fleet summary over the last `days`: for every metric, the distribution of
 * buckets with their counts (already sorted, biggest first). Shape:
 *   { sinceDay, days, apps:[…], metrics: { android:[{bucket,count}], … } }
 */
export function deviceFleet({ days = 14 } = {}) {
  const since = dayStr(now() - days * 86400000);
  const rows = stmt.distribution.all(since);
  const metrics = {};
  for (const r of rows) {
    (metrics[r.metric] ||= []).push({ bucket: r.bucket, count: r.count });
  }
  return {
    sinceDay: since,
    days,
    apps: stmt.apps.all(since).map((r) => r.app),
    metrics,
  };
}
