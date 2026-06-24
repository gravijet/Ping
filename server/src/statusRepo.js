import { db, now, safeJson } from './db.js';
import { config } from './config.js';
import { uid, publicUser, getUserById } from './repo.js';

// Status updates ("stories"): short-lived posts visible to a user's chat peers
// for config.statusTtlMs (24h by default). Expiry is enforced lazily by always
// filtering on expires_at — no background job required.

const s = {
  insert: db.prepare(`
    INSERT INTO statuses (id, user_id, type, body, attachment, bg_color, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM statuses WHERE id = ?'),
  del: db.prepare('DELETE FROM statuses WHERE id = ?'),
  activeForUser: db.prepare(`
    SELECT * FROM statuses WHERE user_id = ? AND expires_at > ?
    ORDER BY created_at ASC`),
  addView: db.prepare(`
    INSERT OR IGNORE INTO status_views (status_id, viewer_id, viewed_at)
    VALUES (?, ?, ?)`),
  seen: db.prepare('SELECT 1 FROM status_views WHERE status_id = ? AND viewer_id = ?'),
  viewCount: db.prepare('SELECT COUNT(*) AS n FROM status_views WHERE status_id = ?'),
  viewers: db.prepare(`
    SELECT viewer_id, viewed_at FROM status_views
    WHERE status_id = ? ORDER BY viewed_at DESC`),
  purge: db.prepare('DELETE FROM statuses WHERE expires_at <= ?'),
  // Moderation: every active status across all users, newest first, joined to
  // the author so the admin portal can show who posted it.
  allActive: db.prepare(`
    SELECT s.*, u.display_name AS author_name, u.avatar_color AS author_color
    FROM statuses s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ? ORDER BY s.created_at DESC`),
};

export function createStatus({ userId, type = 'text', body = '', attachment = null, bgColor = null }) {
  const id = uid();
  const ts = now();
  s.insert.run(
    id,
    userId,
    type,
    body,
    attachment ? JSON.stringify(attachment) : null,
    bgColor,
    ts,
    ts + config.statusTtlMs
  );
  return s.byId.get(id);
}

export const getStatus = (id) => s.byId.get(id);
export const deleteStatus = (id) => s.del.run(id);
export const activeStatusesForUser = (userId) => s.activeForUser.all(userId, now());
export const markStatusViewed = (statusId, viewerId) =>
  s.addView.run(statusId, viewerId, now());
export const statusSeenBy = (statusId, viewerId) => !!s.seen.get(statusId, viewerId);
export const statusViewCount = (statusId) => s.viewCount.get(statusId).n;
export const purgeExpiredStatuses = () => s.purge.run(now());

// Admin moderation view: every currently-visible status with its author and
// view count, so an admin can spot and remove abusive posts.
export function adminListStatuses() {
  return s.allActive.all(now()).map((row) => ({
    id: row.id,
    userId: row.user_id,
    author: row.author_name,
    authorColor: row.author_color,
    type: row.type,
    body: row.body,
    attachment: safeJson(row.attachment, null),
    bgColor: row.bg_color,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    views: statusViewCount(row.id),
  }));
}

export function statusViewers(statusId) {
  return s.viewers.all(statusId).map((r) => ({
    user: publicUser(getUserById(r.viewer_id)),
    viewedAt: r.viewed_at,
  }));
}

export function statusView(row, viewerId) {
  const isOwner = row.user_id === viewerId;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    body: row.body,
    attachment: safeJson(row.attachment, null),
    bgColor: row.bg_color,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    seen: isOwner ? true : statusSeenBy(row.id, viewerId),
    viewCount: isOwner ? statusViewCount(row.id) : null,
  };
}
