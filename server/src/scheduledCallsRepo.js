import { db, now } from './db.js';
import { uid } from './repo.js';

// Scheduled calls (0.34.0). A planned call with an optional pre-call reminder
// that the maintenance sweep fires exactly once — the same remind_at/reminded_at
// mechanism as event reminders (see dueScheduledCalls / markCallReminded). The
// call itself still happens over the normal WebRTC signalling when started.

const s = {
  insert: db.prepare(`
    INSERT INTO scheduled_calls
      (id, chat_id, creator_id, title, video, start_at, remind_at, created_at)
    VALUES (@id, @chatId, @creatorId, @title, @video, @startAt, @remindAt, @createdAt)`),
  byId: db.prepare('SELECT * FROM scheduled_calls WHERE id = ?'),
  del: db.prepare('DELETE FROM scheduled_calls WHERE id = ?'),
  upcomingForUser: db.prepare(`
    SELECT c.* FROM scheduled_calls c
     WHERE c.start_at >= @from
       AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.chat_id AND cm.user_id = @uid)
     ORDER BY c.start_at ASC
     LIMIT @limit`),
  dueReminders: db.prepare(`
    SELECT * FROM scheduled_calls
     WHERE remind_at IS NOT NULL AND reminded_at IS NULL AND remind_at <= ?`),
  markReminded: db.prepare('UPDATE scheduled_calls SET reminded_at = ? WHERE id = ?'),
  purgePast: db.prepare('DELETE FROM scheduled_calls WHERE start_at < ?'),
};

export function createScheduledCall({ chatId, creatorId, title = '', video = false, startAt, remindMinutes = 0 }) {
  const id = uid();
  const remindAt = remindMinutes > 0 ? startAt - remindMinutes * 60_000 : null;
  s.insert.run({
    id, chatId, creatorId, title, video: video ? 1 : 0, startAt,
    remindAt: remindAt && remindAt > now() ? remindAt : null,
    createdAt: now(),
  });
  return s.byId.get(id);
}

export const getScheduledCall = (id) => s.byId.get(id);
export const deleteScheduledCall = (id) => s.del.run(id);

export function scheduledCallView(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    creatorId: row.creator_id,
    title: row.title || '',
    video: !!row.video,
    startAt: row.start_at,
    remindAt: row.remind_at || null,
  };
}

export function upcomingCallsForUser(userId, { limit = 50, fromTs = now() } = {}) {
  return s.upcomingForUser
    .all({ uid: userId, from: fromTs, limit: Math.min(Math.max(limit, 1), 100) })
    .map(scheduledCallView);
}

export const dueScheduledCalls = (ts = now()) => s.dueReminders.all(ts);
export const markCallReminded = (id, ts = now()) => s.markReminded.run(ts, id);
// Drop calls whose start time is well past so the table doesn't grow forever.
export const purgePastScheduledCalls = (ts = now() - 24 * 3_600_000) => s.purgePast.run(ts);
