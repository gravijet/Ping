import { db, now } from './db.js';
import { getUserById, publicUser } from './repo.js';

// 0.37.0 "Feinschliff" — small, additive helpers that ride on existing tables.
// Each backs one curated, flag-gated feature; none widens messages.type, so the
// external-content FTS5 index is left untouched.

// ---- reactionDetails: "who reacted" ---------------------------------------
// Group a message's reactions by emoji, each with its (public) reactors in the
// order they reacted. Reused by the GET reactions endpoint + the web detail sheet.
const reactorStmt = db.prepare(
  'SELECT emoji, user_id, created_at FROM message_reactions WHERE message_id = ? ORDER BY created_at ASC'
);
export function reactorsFor(messageId) {
  const groups = new Map();
  for (const row of reactorStmt.all(messageId)) {
    if (!groups.has(row.emoji)) groups.set(row.emoji, []);
    const u = publicUser(getUserById(row.user_id));
    if (u) groups.get(row.emoji).push({ ...u, reactedAt: row.created_at });
  }
  return [...groups.entries()].map(([emoji, users]) => ({ emoji, users }));
}

// ---- anniversaries: upcoming birthdays among one's contacts ----------------
// "Contacts" = everyone the user shares a direct chat with. birthday is stored as
// 'YYYY-MM-DD' or 'MM-DD' (year optional); we match on month/day only.
const directPartnersStmt = db.prepare(`
  SELECT DISTINCT cm2.user_id AS id
    FROM chat_members cm1
    JOIN chats c        ON c.id = cm1.chat_id AND c.type = 'direct'
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id <> cm1.user_id
   WHERE cm1.user_id = ?`);

// Days from today (local-agnostic UTC date math) until the next occurrence of a
// MM-DD, in [0, 365]. Today → 0.
function daysUntil(month, day, from = new Date()) {
  const y = from.getUTCFullYear();
  const today = Date.UTC(y, from.getUTCMonth(), from.getUTCDate());
  let next = Date.UTC(y, month - 1, day);
  if (next < today) next = Date.UTC(y + 1, month - 1, day);
  return Math.round((next - today) / 86_400_000);
}

export function upcomingAnniversaries(userId, withinDays = 30) {
  const out = [];
  for (const { id } of directPartnersStmt.all(userId)) {
    const u = getUserById(id);
    const bday = (u?.birthday || '').trim();
    const m = bday.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
    if (!m) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const inDays = daysUntil(month, day);
    if (inDays <= withinDays) {
      out.push({ user: publicUser(u), inDays, month, day });
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

// ---- autoTranslate: per-member target language for incoming messages -------
// Stored on chat_members.auto_translate ('' = off). The actual translation runs
// client-side against the existing /translate endpoint; this just syncs the
// preference across the member's devices.
const atGet = db.prepare(
  'SELECT auto_translate FROM chat_members WHERE chat_id = ? AND user_id = ?'
);
const atSet = db.prepare(
  'UPDATE chat_members SET auto_translate = ? WHERE chat_id = ? AND user_id = ?'
);
export const getAutoTranslate = (chatId, userId) =>
  atGet.get(chatId, userId)?.auto_translate || '';
export function setAutoTranslate(chatId, userId, lang) {
  atSet.run(lang || '', chatId, userId);
  return getAutoTranslate(chatId, userId);
}

// ---- smartFolders: keyword auto-sort rules for chat folders -----------------
// One optional rule per folder. kind 'keyword' matches the keyword against a
// chat's display title (group/channel name, or the direct partner's name); kind
// 'all' is a placeholder for "no auto-rule". Explicit folder membership is
// unchanged — matches are unioned in at list time.
const fr = {
  get: db.prepare('SELECT * FROM folder_rules WHERE folder_id = ?'),
  forUser: db.prepare('SELECT * FROM folder_rules WHERE user_id = ?'),
  upsert: db.prepare(`
    INSERT INTO folder_rules (folder_id, user_id, kind, keyword, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(folder_id) DO UPDATE SET kind = excluded.kind, keyword = excluded.keyword`),
  del: db.prepare('DELETE FROM folder_rules WHERE folder_id = ? AND user_id = ?'),
};

export function getFolderRule(folderId) {
  const row = fr.get.get(folderId);
  return row ? { kind: row.kind, keyword: row.keyword || '' } : null;
}

export function setFolderRule(folderId, userId, { kind, keyword = '' }) {
  if (!kind || kind === 'all' || !keyword.trim()) {
    fr.del.run(folderId, userId);
    return null;
  }
  fr.upsert.run(folderId, userId, kind, keyword.trim(), now());
  return getFolderRule(folderId);
}

export const clearFolderRule = (folderId, userId) =>
  fr.del.run(folderId, userId).changes > 0;

const matchGroups = db.prepare(`
  SELECT c.id FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
   WHERE cm.user_id = ? AND c.type <> 'direct' AND lower(c.name) LIKE ?`);
const matchDirects = db.prepare(`
  SELECT c.id FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id <> ?
    JOIN users u ON u.id = cm2.user_id
   WHERE cm.user_id = ? AND c.type = 'direct' AND lower(u.display_name) LIKE ?`);

/// Chat IDs in the user's conversations whose title contains [keyword].
export function matchChatsForKeyword(userId, keyword) {
  const kw = `%${String(keyword || '').toLowerCase()}%`;
  if (!keyword || !keyword.trim()) return [];
  const ids = new Set();
  for (const r of matchGroups.all(userId, kw)) ids.add(r.id);
  for (const r of matchDirects.all(userId, userId, kw)) ids.add(r.id);
  return [...ids];
}
