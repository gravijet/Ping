import { randomBytes } from 'node:crypto';
import { db, now } from './db.js';

// Shareable invite links (Pillar C). A link is a short URL-safe code that lets
// someone join a group; it can carry an expiry and a max-use cap, and can be
// revoked. resolveInviteLink validates all three before a join is allowed.

const s = {
  insert: db.prepare(`
    INSERT INTO invite_links (code, chat_id, creator_id, max_uses, uses, expires_at, created_at)
    VALUES (@code, @chatId, @creatorId, @maxUses, 0, @expiresAt, @createdAt)`),
  byCode: db.prepare('SELECT * FROM invite_links WHERE code = ?'),
  byChat: db.prepare('SELECT * FROM invite_links WHERE chat_id = ? ORDER BY created_at DESC'),
  bump: db.prepare('UPDATE invite_links SET uses = uses + 1 WHERE code = ?'),
  revoke: db.prepare('UPDATE invite_links SET revoked_at = ? WHERE code = ? AND chat_id = ?'),
};

function code() {
  return randomBytes(9).toString('base64url'); // 12 url-safe chars
}

export function createInviteLink({ chatId, creatorId, maxUses = 0, expiresInHours = 0 }) {
  const c = code();
  const expiresAt = expiresInHours > 0 ? now() + expiresInHours * 3600_000 : null;
  s.insert.run({ code: c, chatId, creatorId, maxUses: maxUses | 0, expiresAt, createdAt: now() });
  return s.byCode.get(c);
}

/** Returns the live link row if the code is valid+usable, else null. */
export function resolveInviteLink(c) {
  const link = s.byCode.get(c);
  if (!link) return null;
  if (link.revoked_at) return null;
  if (link.expires_at && link.expires_at <= now()) return null;
  if (link.max_uses > 0 && link.uses >= link.max_uses) return null;
  return link;
}

export function consumeInviteLink(c) {
  s.bump.run(c);
}

export function listInviteLinks(chatId) {
  return s.byChat.all(chatId).map(linkView);
}

export function revokeInviteLink(c, chatId) {
  return s.revoke.run(now(), c, chatId).changes > 0;
}

export function linkView(link) {
  return {
    code: link.code,
    chatId: link.chat_id,
    maxUses: link.max_uses,
    uses: link.uses,
    expiresAt: link.expires_at || null,
    revoked: !!link.revoked_at,
    createdAt: link.created_at,
    active: !link.revoked_at
      && (!link.expires_at || link.expires_at > now())
      && (link.max_uses === 0 || link.uses < link.max_uses),
  };
}
