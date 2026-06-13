import crypto from 'node:crypto';
import { db, now } from './db.js';

// Newsroom articles + changelog entries. One `posts` table, two `kind`s. Drafts
// (published = 0) are only ever returned to the admin portal.

function uid() {
  return crypto.randomUUID();
}

// Turn a title into a URL-safe slug. German umlauts are transliterated so the
// public URLs read nicely (/news/neue-funktionen statt /news/neue-funktionen…).
export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO posts
      (id, kind, slug, title, summary, body, category, version, tag, cover,
       pinned, published, author, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM posts WHERE id = ?'),
  bySlug: db.prepare('SELECT * FROM posts WHERE slug = ?'),
  slugExists: db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?'),
  delete: db.prepare('DELETE FROM posts WHERE id = ?'),
  // Admin: everything of a kind, newest first (drafts included).
  adminByKind: db.prepare(
    'SELECT * FROM posts WHERE kind = ? ORDER BY pinned DESC, created_at DESC LIMIT 200'
  ),
  adminAll: db.prepare(
    'SELECT * FROM posts ORDER BY pinned DESC, created_at DESC LIMIT 200'
  ),
  // Public: only published, newest first (pinned float to the top).
  publicByKind: db.prepare(`
    SELECT * FROM posts WHERE kind = ? AND published = 1
    ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC LIMIT ?`),
  countPublished: db.prepare(
    'SELECT COUNT(*) AS n FROM posts WHERE kind = ? AND published = 1'
  ),
};

// Generate a slug that is unique across all posts (append -2, -3, … on clash).
function uniqueSlug(desired, exceptId = '') {
  let base = slugify(desired) || 'post';
  let candidate = base;
  let i = 2;
  while (stmts.slugExists.get(candidate, exceptId)) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

export function createPost({
  kind,
  title,
  slug,
  summary = '',
  body = '',
  category = '',
  version = '',
  tag = '',
  cover = '',
  pinned = false,
  published = true,
  author = 'Ping Team',
}) {
  const id = uid();
  const ts = now();
  const finalSlug = uniqueSlug(slug || title, '');
  stmts.insert.run(
    id,
    kind,
    finalSlug,
    title,
    summary,
    body,
    category,
    version,
    tag,
    cover,
    pinned ? 1 : 0,
    published ? 1 : 0,
    author || 'Ping Team',
    ts,
    ts,
    published ? ts : null
  );
  return stmts.byId.get(id);
}

export function updatePost(id, fields) {
  const cur = stmts.byId.get(id);
  if (!cur) return null;
  const next = {
    title: fields.title ?? cur.title,
    summary: fields.summary ?? cur.summary,
    body: fields.body ?? cur.body,
    category: fields.category ?? cur.category,
    version: fields.version ?? cur.version,
    tag: fields.tag ?? cur.tag,
    cover: fields.cover ?? cur.cover,
    author: fields.author ?? cur.author,
    pinned: fields.pinned === undefined ? cur.pinned : fields.pinned ? 1 : 0,
    published:
      fields.published === undefined ? cur.published : fields.published ? 1 : 0,
  };
  // Re-slug only when explicitly asked (keeps existing public URLs stable).
  const slug =
    fields.slug !== undefined ? uniqueSlug(fields.slug || next.title, id) : cur.slug;
  // Stamp published_at the first time something goes live.
  const publishedAt =
    next.published && !cur.published_at ? now() : cur.published_at;
  db.prepare(
    `UPDATE posts SET title=?, slug=?, summary=?, body=?, category=?, version=?,
       tag=?, cover=?, author=?, pinned=?, published=?, published_at=?, updated_at=?
     WHERE id=?`
  ).run(
    next.title,
    slug,
    next.summary,
    next.body,
    next.category,
    next.version,
    next.tag,
    next.cover,
    next.author,
    next.pinned,
    next.published,
    publishedAt,
    now(),
    id
  );
  return stmts.byId.get(id);
}

export const deletePost = (id) => stmts.delete.run(id);
export const getPostById = (id) => stmts.byId.get(id);

// Public single-article lookup: returns null for drafts so they stay private.
export function getPublicPostBySlug(slug) {
  const row = stmts.bySlug.get(slug);
  if (!row || !row.published) return null;
  return row;
}

export function listPublicPosts(kind, limit = 50) {
  return stmts.publicByKind.all(kind, limit).map(postView);
}

export function adminListPosts(kind) {
  const rows = kind ? stmts.adminByKind.all(kind) : stmts.adminAll.all();
  return rows.map(postView);
}

export const countPublishedPosts = (kind) => stmts.countPublished.get(kind).n;

// Serialise a post row to the JSON shape the website + admin portal consume.
export function postView(p) {
  if (!p) return null;
  return {
    id: p.id,
    kind: p.kind,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    body: p.body,
    category: p.category,
    version: p.version,
    tag: p.tag,
    cover: p.cover,
    pinned: !!p.pinned,
    published: !!p.published,
    author: p.author,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    publishedAt: p.published_at,
  };
}
