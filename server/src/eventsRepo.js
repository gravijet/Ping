import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for events ("Termine"). Like polls, an event is backed by a normal
// message (type='event'); the structured payload lives here and is surfaced via
// eventView() in messageView.event, so all the realtime plumbing (message /
// message-updated events) just works. RSVPs are one row per (event, user).
//
// An optional pre-start reminder is fired exactly once by the maintenance sweep
// (see dueEventReminders / markEventReminded), nudging everyone who said "going"
// or "maybe" over their live sockets and via push.

const RSVP_STATES = new Set(['going', 'maybe', 'declined']);

const s = {
  insert: db.prepare(`
    INSERT INTO events
      (id, message_id, chat_id, creator_id, title, description, location, start_at, remind_at, recur, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @description, @location, @startAt, @remindAt, @recur, @createdAt)`),
  byId: db.prepare('SELECT * FROM events WHERE id = ?'),
  byMessage: db.prepare('SELECT * FROM events WHERE message_id = ?'),
  counts: db.prepare(
    'SELECT status, COUNT(*) AS n FROM event_rsvps WHERE event_id = ? GROUP BY status'
  ),
  // The going/maybe list with display names, for the attendee roster.
  attendees: db.prepare(`
    SELECT r.user_id AS userId, r.status, u.display_name AS displayName
      FROM event_rsvps r JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ? AND r.status IN ('going','maybe')
     ORDER BY r.status, u.display_name`),
  myRsvp: db.prepare('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?'),
  setRsvp: db.prepare(`
    INSERT INTO event_rsvps (event_id, user_id, status, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`),
  clearRsvp: db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?'),
  // Upcoming events across every chat the viewer belongs to (the agenda pane).
  upcomingForUser: db.prepare(`
    SELECT e.*, m.deleted_at AS msg_deleted
      FROM events e
      JOIN messages m ON m.id = e.message_id
     WHERE m.deleted_at IS NULL
       AND e.start_at >= @from
       AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = e.chat_id AND cm.user_id = @uid)
     ORDER BY e.start_at ASC
     LIMIT @limit`),
  // Reminders that have come due and haven't fired yet (joined to a live message).
  dueReminders: db.prepare(`
    SELECT e.* FROM events e
      JOIN messages m ON m.id = e.message_id
     WHERE e.remind_at IS NOT NULL AND e.reminded_at IS NULL
       AND e.remind_at <= ? AND m.deleted_at IS NULL`),
  markReminded: db.prepare('UPDATE events SET reminded_at = ? WHERE id = ?'),
  // 0.34.0: recurring events. A series member that has started and still carries a
  // recur rule spawns its successor, then clears its own rule so it spawns once.
  dueRecurring: db.prepare(`
    SELECT e.* FROM events e
      JOIN messages m ON m.id = e.message_id
     WHERE e.recur != '' AND e.start_at <= ? AND m.deleted_at IS NULL`),
  clearRecur: db.prepare("UPDATE events SET recur = '' WHERE id = ?"),
};

/** Create the event row backing a freshly-created 'event' message. */
export function createEvent({
  messageId,
  chatId,
  creatorId,
  title,
  description = '',
  location = '',
  startAt,
  remindMinutes = 0,
  recur = '',
}) {
  const id = uid();
  const remindAt =
    remindMinutes > 0 ? startAt - remindMinutes * 60_000 : null;
  s.insert.run({
    id,
    messageId,
    chatId,
    creatorId,
    title,
    description,
    location,
    startAt,
    // A reminder already in the past at creation time is pointless — drop it.
    remindAt: remindAt && remindAt > now() ? remindAt : null,
    recur: recur || '',
    createdAt: now(),
  });
  return s.byId.get(id);
}

// Next start for a recurrence rule. Returns the same clock time, advanced by one
// day / week / month from the previous start.
export function nextOccurrence(startAt, recur) {
  const d = new Date(startAt);
  if (recur === 'daily') d.setDate(d.getDate() + 1);
  else if (recur === 'weekly') d.setDate(d.getDate() + 7);
  else if (recur === 'monthly') d.setMonth(d.getMonth() + 1);
  else return null;
  return d.getTime();
}

export const dueRecurringEvents = (ts = now()) => s.dueRecurring.all(ts);
export const clearEventRecur = (id) => s.clearRecur.run(id);

export const getEventByMessage = (messageId) => s.byMessage.get(messageId);

/** Set (or, with status null, clear) a viewer's RSVP. Returns false on a bad state. */
export function setEventRsvp(messageId, userId, status) {
  const ev = s.byMessage.get(messageId);
  if (!ev) return false;
  if (status === null) {
    s.clearRsvp.run(ev.id, userId);
    return true;
  }
  if (!RSVP_STATES.has(status)) return false;
  s.setRsvp.run(ev.id, userId, status, now());
  return true;
}

/** The event as one viewer sees it: details, RSVP tallies, attendees, own pick. */
export function eventView(messageId, viewerId) {
  const ev = s.byMessage.get(messageId);
  if (!ev) return null;
  const tally = { going: 0, maybe: 0, declined: 0 };
  for (const r of s.counts.all(ev.id)) {
    if (r.status in tally) tally[r.status] = r.n;
  }
  return {
    id: ev.id,
    title: ev.title,
    description: ev.description || '',
    location: ev.location || '',
    startAt: ev.start_at,
    remindAt: ev.remind_at || null,
    recur: ev.recur || '',
    creatorId: ev.creator_id,
    counts: tally,
    attendees: s.attendees.all(ev.id),
    myStatus: s.myRsvp.get(ev.id, viewerId)?.status || null,
  };
}

/** Upcoming events across all the user's chats (for the "Termine" agenda). */
export function upcomingEventsForUser(userId, { limit = 50, fromTs = now() } = {}) {
  return s.upcomingForUser
    .all({ uid: userId, from: fromTs, limit: Math.min(Math.max(limit, 1), 100) })
    .map((ev) => ({
      ...eventView(ev.message_id, userId),
      chatId: ev.chat_id,
      messageId: ev.message_id,
    }));
}

export const dueEventReminders = (ts = now()) => s.dueReminders.all(ts);
export const markEventReminded = (id, ts = now()) => s.markReminded.run(ts, id);
