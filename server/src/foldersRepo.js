import { db, now } from './db.js';
import { uid } from './repo.js';

// Chat folders (0.27.0 "Ordnung & Ausdruck"): user-defined groupings shown as
// filter tabs above the chat list. Folders belong to one user; a chat can sit in
// several folders. All membership writes are scoped to chats the user actually
// belongs to (enforced at the route layer), so a folder can only ever reference
// the owner's own conversations.

const s = {
  list: db.prepare(
    'SELECT * FROM chat_folders WHERE user_id = ? ORDER BY sort, created_at'
  ),
  byId: db.prepare('SELECT * FROM chat_folders WHERE id = ? AND user_id = ?'),
  insert: db.prepare(`
    INSERT INTO chat_folders (id, user_id, name, emoji, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  rename: db.prepare(
    'UPDATE chat_folders SET name = ?, emoji = ?, sort = ? WHERE id = ? AND user_id = ?'
  ),
  remove: db.prepare('DELETE FROM chat_folders WHERE id = ? AND user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM chat_folders WHERE user_id = ?'),
  memberChats: db.prepare(
    'SELECT chat_id FROM chat_folder_members WHERE folder_id = ?'
  ),
  clearMembers: db.prepare('DELETE FROM chat_folder_members WHERE folder_id = ?'),
  addMember: db.prepare(`
    INSERT OR IGNORE INTO chat_folder_members (folder_id, chat_id) VALUES (?, ?)`),
  removeOrphans: db.prepare(`
    DELETE FROM chat_folder_members
    WHERE folder_id = ? AND chat_id NOT IN (
      SELECT chat_id FROM chat_members WHERE user_id = ?)`),
};

// A sane upper bound so the folder bar stays usable and the table can't grow
// without limit per account.
export const MAX_FOLDERS = 20;

function view(row) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji || '',
    sort: row.sort || 0,
    createdAt: row.created_at,
    chatIds: s.memberChats.all(row.id).map((r) => r.chat_id),
  };
}

export function listFolders(userId) {
  return s.list.all(userId).map(view);
}

export function folderCount(userId) {
  return s.count.get(userId).n;
}

export function getFolder(userId, id) {
  const row = s.byId.get(id, userId);
  return row ? view(row) : null;
}

export function createFolder(userId, { name, emoji = '', sort = 0 }) {
  const id = uid();
  s.insert.run(id, userId, name, emoji, sort, now());
  return getFolder(userId, id);
}

export function updateFolder(userId, id, { name, emoji = '', sort = 0 }) {
  const existing = s.byId.get(id, userId);
  if (!existing) return null;
  s.rename.run(name, emoji, sort, id, userId);
  return getFolder(userId, id);
}

export function deleteFolder(userId, id) {
  const existing = s.byId.get(id, userId);
  if (!existing) return false;
  s.remove.run(id, userId); // chat_folder_members rows cascade away
  return true;
}

/// Replace a folder's chat set. [chatIds] is filtered to chats the user is a
/// member of (defence in depth alongside the route guard). Returns the updated
/// folder view, or null if the folder isn't the user's.
export function setFolderChats(userId, id, chatIds) {
  const existing = s.byId.get(id, userId);
  if (!existing) return null;
  const owned = new Set(
    db
      .prepare('SELECT chat_id FROM chat_members WHERE user_id = ?')
      .all(userId)
      .map((r) => r.chat_id)
  );
  s.clearMembers.run(id);
  for (const cid of new Set(chatIds)) {
    if (owned.has(cid)) s.addMember.run(id, cid);
  }
  return getFolder(userId, id);
}

/// Drop folder memberships for chats the user has since left (called lazily when
/// folders are listed, so leaving a group tidies up its folder rows too).
export function pruneFolders(userId) {
  for (const f of s.list.all(userId)) s.removeOrphans.run(f.id, userId);
}
