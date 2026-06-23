import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for message reminders ("Erinnere mich"). A reminder points at a single
// message in a chat the user belongs to and carries a denormalised snapshot
// (preview + chat title) so the reminders pane renders without re-fetching a
// message that may have been deleted or expired in the meantime. The maintenance
// sweep fires due rows; see remindersRepo.dueReminders / markReminderFired.

const s = {
  insert: db.prepare(`
    INSERT INTO message_reminders
      (id, user_id, chat_id, message_id, note, preview, chat_title, remind_at, created_at, recur)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM message_reminders WHERE id = ?'),
  // A recurring reminder fires, then re-arms for the next occurrence: clear
  // fired_at and push remind_at forward by one period.
  reschedule: db.prepare(
    'UPDATE message_reminders SET remind_at = ?, fired_at = NULL WHERE id = ?'
  ),
  // Everything still relevant to the user: pending reminders plus ones that fired
  // within the keep-window (so the pane can show them as "erledigt").
  forUser: db.prepare(`
    SELECT * FROM message_reminders
    WHERE user_id = ?
    ORDER BY (fired_at IS NOT NULL), remind_at ASC`),
  due: db.prepare(`
    SELECT * FROM message_reminders
    WHERE fired_at IS NULL AND remind_at <= ?
    ORDER BY remind_at ASC`),
  markFired: db.prepare('UPDATE message_reminders SET fired_at = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM message_reminders WHERE id = ? AND user_id = ?'),
  // Drop reminders that fired long enough ago that the user has seen them.
  purgeFired: db.prepare('DELETE FROM message_reminders WHERE fired_at IS NOT NULL AND fired_at <= ?'),
  countPending: db.prepare(
    'SELECT COUNT(*) AS n FROM message_reminders WHERE user_id = ? AND fired_at IS NULL'
  ),
};

export function createReminder({
  userId,
  chatId,
  messageId,
  remindAt,
  note = '',
  preview = '',
  chatTitle = '',
  recur = '',
}) {
  const id = uid();
  s.insert.run(id, userId, chatId, messageId, note, preview, chatTitle, remindAt, now(), recur || '');
  return s.byId.get(id);
}

export const getReminder = (id) => s.byId.get(id);
export const listReminders = (userId) => s.forUser.all(userId);
export const dueReminders = (ts = now()) => s.due.all(ts);
export const markReminderFired = (id, ts = now()) => s.markFired.run(ts, id);

// 0.37.0 "Feinschliff": after a recurring reminder fires, advance it to the next
// occurrence (one day or one week out) and re-arm it. Returns the next timestamp,
// or null for a one-shot reminder (which the sweep then stamps fired_at on).
const PERIOD_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 };
export function rescheduleRecurring(row, ts = now()) {
  const step = PERIOD_MS[row.recur];
  if (!step) return null;
  // Skip past any periods missed while the server was down so we don't fire a burst.
  let next = row.remind_at + step;
  while (next <= ts) next += step;
  s.reschedule.run(next, row.id);
  return next;
}
export const deleteReminder = (id, userId) => s.del.run(id, userId).changes > 0;
export const pendingReminderCount = (userId) => s.countPending.get(userId)?.n || 0;
/** Drop reminders that fired more than [keepMs] ago (default 7 days). */
export const purgeFiredReminders = (keepMs = 7 * 24 * 60 * 60 * 1000) =>
  s.purgeFired.run(now() - keepMs).changes;

export function reminderView(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    note: row.note || '',
    preview: row.preview || '',
    chatTitle: row.chat_title || '',
    remindAt: row.remind_at,
    createdAt: row.created_at,
    firedAt: row.fired_at || null,
    recur: row.recur || '',
  };
}
