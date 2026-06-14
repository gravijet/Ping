import crypto from 'node:crypto';
import { db, now } from './db.js';

// Append-only audit trail of privileged admin actions. Every mutating admin
// route records *what* happened, *to whom* and *from where*, so the portal can
// show an accountable history. Writes are best-effort: a logging failure must
// never break the action it is recording.

const stmts = {
  insert: db.prepare(`
    INSERT INTO audit_log (id, actor, action, target, detail, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  list: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'),
  search: db.prepare(`
    SELECT * FROM audit_log
    WHERE action LIKE ? OR target LIKE ? OR detail LIKE ?
    ORDER BY created_at DESC LIMIT ?`),
  prune: db.prepare(
    'DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY created_at DESC LIMIT ?)'
  ),
};

// Keep the log bounded so it can't grow without limit on a busy instance.
const KEEP = 2000;

export function recordAudit({ actor = 'admin', action, target = '', detail = '', ip = '' }) {
  if (!action) return;
  try {
    stmts.insert.run(
      crypto.randomUUID(),
      String(actor).slice(0, 80),
      String(action).slice(0, 80),
      String(target).slice(0, 200),
      String(detail).slice(0, 500),
      String(ip).slice(0, 64),
      now()
    );
    // Amortised pruning: trim roughly 1 in 50 writes.
    if (Math.random() < 0.02) stmts.prune.run(KEEP);
  } catch {
    /* never let audit logging break the request it is recording */
  }
}

export function listAudit({ q = '', limit = 100 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows =
    q && q.trim()
      ? stmts.search.all(`%${q}%`, `%${q}%`, `%${q}%`, n)
      : stmts.list.all(n);
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    target: r.target,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.created_at,
  }));
}
