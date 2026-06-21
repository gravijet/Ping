import { randomBytes, randomInt } from 'node:crypto';
import { db, now } from './db.js';

// Login approval (0.34.0). A new device proves the password, then waits here
// until one of the account's existing signed-in devices approves it — only then
// is a session token issued. Pending rows expire after 5 minutes. This is an
// additive, opt-in confirmation channel; the normal login path is untouched.

const TTL_MS = 5 * 60_000;

const s = {
  insert: db.prepare(`
    INSERT INTO login_approvals (id, user_id, code, device, ip, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`),
  byId: db.prepare('SELECT * FROM login_approvals WHERE id = ?'),
  pendingForUser: db.prepare(
    "SELECT * FROM login_approvals WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC"
  ),
  decide: db.prepare('UPDATE login_approvals SET status = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM login_approvals WHERE id = ?'),
  purge: db.prepare("DELETE FROM login_approvals WHERE expires_at <= ? OR status <> 'pending'"),
};

export function createApproval({ userId, device = '', ip = '' }) {
  // The id doubles as the unguessable poll handle the requesting device holds;
  // the 6-digit code is what the user reads out / matches on the trusted device.
  const id = randomBytes(18).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const ts = now();
  s.insert.run(id, userId, code, device.slice(0, 200), ip.slice(0, 64), ts, ts + TTL_MS);
  return { id, code, expiresAt: ts + TTL_MS };
}

export function getApproval(id) {
  const row = s.byId.get(id);
  if (!row || row.expires_at <= now()) return null;
  return row;
}

export function listPendingApprovals(userId) {
  return s.pendingForUser.all(userId, now()).map((r) => ({
    id: r.id,
    code: r.code,
    device: r.device,
    ip: r.ip,
    createdAt: r.created_at,
  }));
}

/** Approve or deny. Returns the new status, or null if it's gone/expired. */
export function decideApproval(id, userId, approve) {
  const row = getApproval(id);
  if (!row || row.user_id !== userId || row.status !== 'pending') return null;
  const status = approve ? 'approved' : 'denied';
  s.decide.run(status, id);
  return status;
}

export const deleteApproval = (id) => s.del.run(id);
export const purgeApprovals = () => s.purge.run(now());
