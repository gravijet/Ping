import { db, now } from './db.js';
import { uid } from './repo.js';

// Watch party (type='watchparty'): synchronised video playback. The row holds the
// resumable source of truth (position_ms + playing); live sync nudges go over the
// socket ('watchparty-sync'). Any member can drive playback (a casual co-watch,
// not a host-locked cinema).

const s = {
  insert: db.prepare(`
    INSERT INTO watch_parties (id, message_id, chat_id, creator_id, title, url, position_ms, playing, updated_at, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @url, 0, 0, @createdAt, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM watch_parties WHERE message_id = ?'),
  update: db.prepare('UPDATE watch_parties SET position_ms = @pos, playing = @playing, updated_at = @ts WHERE message_id = @messageId'),
};

export function createWatchParty({ messageId, chatId, creatorId, title = '', url }) {
  s.insert.run({ id: uid(), messageId, chatId, creatorId, title: title || '', url, createdAt: now() });
  return s.byMessage.get(messageId);
}

/** Update playback state (drives the 'watchparty-sync' broadcast). */
export function updateWatchParty(messageId, { positionMs, playing }) {
  const wp = s.byMessage.get(messageId);
  if (!wp) return null;
  s.update.run({
    messageId,
    pos: Math.max(0, positionMs | 0),
    playing: playing ? 1 : 0,
    ts: now(),
  });
  return watchPartyView(messageId);
}

export function watchPartyView(messageId) {
  const wp = s.byMessage.get(messageId);
  if (!wp) return null;
  return {
    id: wp.id,
    title: wp.title || '',
    url: wp.url,
    positionMs: wp.position_ms || 0,
    playing: !!wp.playing,
    creatorId: wp.creator_id,
    updatedAt: wp.updated_at,
  };
}
