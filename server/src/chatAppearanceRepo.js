import { db, now } from './db.js';

// Per-user, per-chat appearance (0.34.0): a wallpaper (preset id or upload) and
// an accent colour. Stored server-side so it follows the account across devices.

const s = {
  upsert: db.prepare(`
    INSERT INTO chat_appearance (user_id, chat_id, wallpaper, accent, updated_at)
    VALUES (@userId, @chatId, @wallpaper, @accent, @updatedAt)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET
      wallpaper = excluded.wallpaper, accent = excluded.accent, updated_at = excluded.updated_at`),
  get: db.prepare('SELECT * FROM chat_appearance WHERE user_id = ? AND chat_id = ?'),
};

export function setChatAppearance(userId, chatId, { wallpaper, accent }) {
  const cur = s.get.get(userId, chatId);
  s.upsert.run({
    userId,
    chatId,
    wallpaper: wallpaper === undefined ? cur?.wallpaper ?? null : wallpaper,
    accent: accent === undefined ? cur?.accent ?? null : (accent ? (accent.startsWith('#') ? accent : `#${accent}`) : null),
    updatedAt: now(),
  });
  return getChatAppearance(userId, chatId);
}

export function getChatAppearance(userId, chatId) {
  const row = s.get.get(userId, chatId);
  return { wallpaper: row?.wallpaper || null, accent: row?.accent || null };
}
