import { db, now } from './db.js';
import { uid } from './repo.js';

// Storage for broadcasts an admin scheduled for a future time. They live here
// until run_at passes, at which point the maintenance sweep dispatches them as a
// normal broadcast (live announcement + push) and removes the row.

const s = {
  insert: db.prepare(`
    INSERT INTO scheduled_broadcasts (id, title, body, route, run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM scheduled_broadcasts WHERE id = ?'),
  pending: db.prepare('SELECT * FROM scheduled_broadcasts ORDER BY run_at ASC'),
  due: db.prepare('SELECT * FROM scheduled_broadcasts WHERE run_at <= ? ORDER BY run_at ASC'),
  del: db.prepare('DELETE FROM scheduled_broadcasts WHERE id = ?'),
};

export function createScheduledBroadcast({ title = '', body, route = '', runAt }) {
  const id = uid();
  s.insert.run(id, title, body, route, runAt, now());
  return s.byId.get(id);
}

export const getScheduledBroadcast = (id) => s.byId.get(id);
export const listScheduledBroadcasts = () => s.pending.all();
export const dueScheduledBroadcasts = (ts = now()) => s.due.all(ts);
export const deleteScheduledBroadcast = (id) => s.del.run(id);

export function scheduledBroadcastView(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    route: row.route || '',
    runAt: row.run_at,
    createdAt: row.created_at,
  };
}
