import { db, now } from './db.js';
import { uid } from './repo.js';

// A per-user security audit feed ("Sicherheits-Center"). Every account-security
// event — logins, 2FA changes, password/email/username changes, privacy edits
// and "überall abmelden" — appends a row here. Purely informational: it never
// gates anything, it just lets a user review what happened on their account.
// Append-only and trimmed by the maintenance sweep so it can't grow unbounded.

// Human-readable German labels for each event type, surfaced verbatim in the UI
// (and kept here, server-side, so the label can't drift between clients).
export const SECURITY_LABELS = {
  login: 'Anmeldung',
  login_2fa: 'Anmeldung mit 2FA',
  login_recovery: 'Anmeldung mit Wiederherstellungscode',
  twofa_enabled: 'Zwei-Faktor-Authentifizierung aktiviert',
  twofa_disabled: 'Zwei-Faktor-Authentifizierung deaktiviert',
  recovery_regenerated: 'Neue Wiederherstellungscodes erzeugt',
  recovery_used: 'Wiederherstellungscode verwendet',
  password_changed: 'Passwort geändert',
  email_changed: 'E-Mail-Adresse geändert',
  username_changed: 'Benutzername geändert',
  privacy_changed: 'Privatsphäre-Einstellungen geändert',
  sessions_revoked: 'Überall abgemeldet',
};

const s = {
  insert: db.prepare(`
    INSERT INTO security_events (id, user_id, type, detail, ip, ua, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  forUser: db.prepare(
    'SELECT * FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ),
  // Keep only the newest [keep] rows per user; delete the rest.
  trim: db.prepare(`
    DELETE FROM security_events
    WHERE id IN (
      SELECT id FROM security_events WHERE user_id = ?
      ORDER BY created_at DESC LIMIT -1 OFFSET ?
    )`),
  distinctUsers: db.prepare('SELECT DISTINCT user_id FROM security_events'),
};

/** First client IP from the (proxied) request, trimmed to something storable. */
function ipOf(req) {
  if (!req) return '';
  const fwd = (req.headers?.['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return (fwd || req.ip || req.socket?.remoteAddress || '').toString().slice(0, 64);
}

function uaOf(req) {
  return (req?.headers?.['user-agent'] || '').toString().slice(0, 200);
}

/**
 * Record a security event. [req] is optional; when present we capture the
 * client IP + user-agent so the feed can show "von … / Browser …". Never throws
 * — a logging failure must not break the action that triggered it.
 */
export function recordSecurityEvent(userId, type, detail = '', req = null) {
  try {
    s.insert.run(uid(), userId, type, String(detail || '').slice(0, 200), ipOf(req), uaOf(req), now());
  } catch (e) {
    console.error('[security] Ereignis konnte nicht protokolliert werden:', e.message);
  }
}

export function listSecurityEvents(userId, limit = 50) {
  return s.forUser.all(userId, Math.min(Math.max(1, limit | 0), 200)).map((row) => ({
    id: row.id,
    type: row.type,
    label: SECURITY_LABELS[row.type] || row.type,
    detail: row.detail || '',
    ip: row.ip || '',
    ua: row.ua || '',
    createdAt: row.created_at,
  }));
}

/** Trim every user's feed down to its newest [keep] rows (maintenance sweep). */
export function trimSecurityEvents(keep = 100) {
  let removed = 0;
  for (const { user_id } of s.distinctUsers.all()) {
    removed += s.trim.run(user_id, keep).changes;
  }
  return removed;
}
