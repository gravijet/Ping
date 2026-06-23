import { db, now } from './db.js';
import { uid } from './repo.js';

// Bookmark / link collection (type='bookmark'): a "read later" card. Anyone in
// the chat can append links; each link carries an optional title + note.

const MAX_LINKS = 200;

const s = {
  insert: db.prepare(`
    INSERT INTO bookmarks (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM bookmarks WHERE message_id = ?'),
  insertLink: db.prepare(`
    INSERT INTO bookmark_links (id, bookmark_id, url, title, note, added_by, sort)
    VALUES (@id, @bookmarkId, @url, @title, @note, @addedBy, @sort)`),
  links: db.prepare('SELECT * FROM bookmark_links WHERE bookmark_id = ? ORDER BY sort'),
  count: db.prepare('SELECT COUNT(*) AS n FROM bookmark_links WHERE bookmark_id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM bookmark_links WHERE bookmark_id = ?'),
  delLink: db.prepare('DELETE FROM bookmark_links WHERE id = ? AND bookmark_id = ?'),
};

export function createBookmark({ messageId, chatId, creatorId, title, links = [] }) {
  const id = uid();
  s.insert.run({ id, messageId, chatId, creatorId, title, createdAt: now() });
  links.slice(0, MAX_LINKS).forEach((l, i) => {
    s.insertLink.run({ id: uid(), bookmarkId: id, url: l.url, title: l.title || '', note: l.note || '', addedBy: creatorId, sort: i });
  });
  return s.byMessage.get(messageId);
}

export function addBookmarkLink(messageId, { url, title = '', note = '', addedBy }) {
  const b = s.byMessage.get(messageId);
  if (!b) return false;
  if (s.count.get(b.id).n >= MAX_LINKS) return false;
  const sort = s.maxSort.get(b.id).m + 1;
  s.insertLink.run({ id: uid(), bookmarkId: b.id, url, title, note, addedBy, sort });
  return true;
}

export function removeBookmarkLink(messageId, linkId) {
  const b = s.byMessage.get(messageId);
  if (!b) return false;
  return s.delLink.run(linkId, b.id).changes > 0;
}

export function bookmarkView(messageId) {
  const b = s.byMessage.get(messageId);
  if (!b) return null;
  return {
    id: b.id,
    title: b.title,
    creatorId: b.creator_id,
    links: s.links.all(b.id).map((l) => ({ id: l.id, url: l.url, title: l.title || '', note: l.note || '', addedBy: l.added_by })),
  };
}
