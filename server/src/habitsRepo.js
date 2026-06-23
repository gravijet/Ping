import { db, now } from './db.js';
import { uid } from './repo.js';

// Shared habit tracker (Pillar F). A habit belongs to a chat; each member checks
// it off per day (habit_logs). listHabits returns each habit with whether *this*
// viewer did it today plus a simple personal streak.

const TODAY = () => new Date().toISOString().slice(0, 10);

const s = {
  insert: db.prepare(`
    INSERT INTO habits (id, chat_id, creator_id, title, cadence, created_at)
    VALUES (@id, @chatId, @creatorId, @title, @cadence, @createdAt)`),
  byId: db.prepare('SELECT * FROM habits WHERE id = ?'),
  byChat: db.prepare('SELECT * FROM habits WHERE chat_id = ? AND archived_at IS NULL ORDER BY created_at'),
  archive: db.prepare('UPDATE habits SET archived_at = ? WHERE id = ?'),
  log: db.prepare('INSERT OR IGNORE INTO habit_logs (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)'),
  unlog: db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND user_id = ? AND day = ?'),
  didDay: db.prepare('SELECT 1 FROM habit_logs WHERE habit_id = ? AND user_id = ? AND day = ?'),
  daysDesc: db.prepare('SELECT day FROM habit_logs WHERE habit_id = ? AND user_id = ? ORDER BY day DESC LIMIT 60'),
  totalToday: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM habit_logs WHERE habit_id = ? AND day = ?'),
};

export function createHabit({ chatId, creatorId, title, cadence = 'daily' }) {
  const id = uid();
  s.insert.run({ id, chatId, creatorId, title, cadence, createdAt: now() });
  return s.byId.get(id);
}

export function archiveHabit(habitId, chatId) {
  const h = s.byId.get(habitId);
  if (!h || h.chat_id !== chatId) return false;
  s.archive.run(now(), habitId);
  return true;
}

/** Toggle today's check for the viewer. Returns { done } or null if missing. */
export function toggleHabitToday(habitId, chatId, userId) {
  const h = s.byId.get(habitId);
  if (!h || h.chat_id !== chatId) return null;
  const day = TODAY();
  if (s.didDay.get(habitId, userId, day)) {
    s.unlog.run(habitId, userId, day);
    return { done: false };
  }
  s.log.run(habitId, userId, day, now());
  return { done: true };
}

function personalStreak(habitId, userId) {
  const days = s.daysDesc.all(habitId, userId).map((r) => r.day);
  if (!days.length) return 0;
  const set = new Set(days);
  let streak = 0;
  let cur = new Date();
  // Allow the streak to be "alive" if today isn't done yet but yesterday was.
  if (!set.has(cur.toISOString().slice(0, 10))) cur = new Date(Date.now() - 86400_000);
  for (;;) {
    const d = cur.toISOString().slice(0, 10);
    if (set.has(d)) { streak++; cur = new Date(cur.getTime() - 86400_000); }
    else break;
  }
  return streak;
}

export function listHabits(chatId, userId) {
  const day = TODAY();
  return s.byChat.all(chatId).map((h) => ({
    id: h.id,
    title: h.title,
    cadence: h.cadence,
    creatorId: h.creator_id,
    doneToday: !!s.didDay.get(h.id, userId, day),
    doneByCountToday: s.totalToday.get(h.id, day).n,
    streak: personalStreak(h.id, userId),
  }));
}
