// linkPreviewRepo.js — URL-keyed cache around the link-preview fetcher. The same
// link shared in many chats is fetched once; results (and failures) are cached so
// renders are cheap and a dead link isn't re-hit on every paint.

import { db, now } from './db.js';
import { fetchLinkPreview } from './linkPreview.js';

// A good preview is reused for a day; a miss is re-tried after an hour (the page
// may have gained metadata, or just been down). now() is in ms.
const OK_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 60 * 1000;

const stmt = {
  get: db.prepare('SELECT * FROM link_previews WHERE url = ?'),
  put: db.prepare(`
    INSERT INTO link_previews (url, ok, title, description, image, site_name, final_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      ok = excluded.ok, title = excluded.title, description = excluded.description,
      image = excluded.image, site_name = excluded.site_name,
      final_url = excluded.final_url, fetched_at = excluded.fetched_at`),
};

// In-flight de-duplication: concurrent requests for the same URL (e.g. a popular
// link rendered in several open chats) share one fetch instead of stampeding.
const inFlight = new Map();

function rowToPreview(row) {
  if (!row || !row.ok) return null;
  return {
    title: row.title || '',
    description: row.description || '',
    image: row.image || '',
    siteName: row.site_name || '',
    url: row.final_url || row.url,
  };
}

function fresh(row) {
  if (!row) return false;
  const ttl = row.ok ? OK_TTL_MS : FAIL_TTL_MS;
  return now() - row.fetched_at < ttl;
}

/// Resolve the preview for [url]: a fresh cache hit, or a fresh fetch that is
/// then cached (successes and failures both). Returns a preview object or null.
export async function getLinkPreview(url) {
  const cached = stmt.get.get(url);
  if (fresh(cached)) return rowToPreview(cached);

  if (inFlight.has(url)) return inFlight.get(url);
  const task = (async () => {
    const meta = await fetchLinkPreview(url);
    const ts = now();
    if (meta) {
      stmt.put.run(url, 1, meta.title, meta.description, meta.image, meta.siteName, meta.finalUrl, ts);
      return { title: meta.title, description: meta.description, image: meta.image, siteName: meta.siteName, url: meta.finalUrl };
    }
    stmt.put.run(url, 0, null, null, null, null, null, ts);
    return null;
  })().finally(() => inFlight.delete(url));

  inFlight.set(url, task);
  return task;
}

/// Test/maintenance helper: drop the whole cache.
export function clearLinkPreviewCache() {
  db.prepare('DELETE FROM link_previews').run();
}
