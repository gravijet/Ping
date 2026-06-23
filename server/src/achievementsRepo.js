import { db, now } from './db.js';

// Achievements + per-chat daily streaks (Pillar E). Achievements are unlocked
// once (INSERT OR IGNORE); the catalogue below gives each a title + emoji. A
// streak counts consecutive UTC days a user has been active in a chat — bumped
// from the message-create path via recordStreakActivity().

export const ACHIEVEMENTS = {
  first_message: { emoji: '👋', title: 'Erste Nachricht', desc: 'Du hast deine erste Nachricht gesendet.' },
  streak_3: { emoji: '🔥', title: '3-Tage-Streak', desc: 'Drei Tage in Folge in einem Chat aktiv.' },
  streak_7: { emoji: '🔥', title: 'Wochen-Streak', desc: 'Sieben Tage in Folge aktiv.' },
  streak_30: { emoji: '🏆', title: 'Monats-Streak', desc: 'Dreißig Tage in Folge aktiv.' },
  poll_maker: { emoji: '📊', title: 'Umfrage-Macher', desc: 'Du hast eine Umfrage erstellt.' },
  artist: { emoji: '🎨', title: 'Künstler', desc: 'Du hast ein Whiteboard gestartet.' },
  gifter: { emoji: '🎁', title: 'Großzügig', desc: 'Du hast ein Geschenk verschickt.' },
  organiser: { emoji: '📅', title: 'Organisator', desc: 'Du hast einen Termin erstellt.' },
  cinephile: { emoji: '🍿', title: 'Kinofreund', desc: 'Du hast einen Kinoabend gestartet.' },
};

const TODAY = () => new Date().toISOString().slice(0, 10);

const s = {
  grant: db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, kind, earned_at) VALUES (?, ?, ?)'),
  list: db.prepare('SELECT kind, earned_at FROM user_achievements WHERE user_id = ? ORDER BY earned_at DESC'),
  streak: db.prepare('SELECT * FROM streaks WHERE chat_id = ? AND user_id = ?'),
  upsertStreak: db.prepare(`
    INSERT INTO streaks (chat_id, user_id, count, last_day) VALUES (@chatId, @userId, @count, @day)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET count = excluded.count, last_day = excluded.last_day`),
};

/** Unlock an achievement. Returns the catalogue entry if it was newly earned. */
export function grantAchievement(userId, kind) {
  if (!ACHIEVEMENTS[kind]) return null;
  const res = s.grant.run(userId, kind, now());
  return res.changes > 0 ? { kind, ...ACHIEVEMENTS[kind] } : null;
}

export function listAchievements(userId) {
  return s.list.all(userId).map((r) => ({ kind: r.kind, earnedAt: r.earned_at, ...(ACHIEVEMENTS[r.kind] || { emoji: '⭐', title: r.kind }) }));
}

export function streakView(chatId, userId) {
  const row = s.streak.get(chatId, userId);
  return { count: row?.count || 0, lastDay: row?.last_day || '' };
}

/**
 * Note a day of activity for (chat, user). Consecutive days extend the streak;
 * a gap resets it to 1; same-day is a no-op. Returns the new streak count and any
 * newly-earned streak achievement.
 */
export function recordStreakActivity(chatId, userId) {
  const today = TODAY();
  const row = s.streak.get(chatId, userId);
  let count = 1;
  if (row) {
    if (row.last_day === today) return { count: row.count, earned: null };
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    count = row.last_day === yesterday ? row.count + 1 : 1;
  }
  s.upsertStreak.run({ chatId, userId, count, day: today });
  let earned = null;
  if (count === 3) earned = grantAchievement(userId, 'streak_3');
  else if (count === 7) earned = grantAchievement(userId, 'streak_7');
  else if (count === 30) earned = grantAchievement(userId, 'streak_30');
  return { count, earned };
}
