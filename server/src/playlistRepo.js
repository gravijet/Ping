import { db, now } from './db.js';
import { uid } from './repo.js';

// Shared playlist (type='playlist'): "Listen Together". Tracks are external links
// (YouTube / SoundCloud / a direct audio URL) anyone in the chat can append. The
// list rides along in messageView.playlist.

const MAX_TRACKS = 200;

const s = {
  insertList: db.prepare(`
    INSERT INTO playlists (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM playlists WHERE message_id = ?'),
  insertTrack: db.prepare(`
    INSERT INTO playlist_tracks (id, playlist_id, title, artist, url, added_by, sort, created_at)
    VALUES (@id, @playlistId, @title, @artist, @url, @addedBy, @sort, @createdAt)`),
  tracks: db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY sort, created_at'),
  count: db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM playlist_tracks WHERE playlist_id = ?'),
  delTrack: db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?'),
};

export function createPlaylist({ messageId, chatId, creatorId, title, tracks = [] }) {
  const id = uid();
  s.insertList.run({ id, messageId, chatId, creatorId, title, createdAt: now() });
  tracks.slice(0, MAX_TRACKS).forEach((t, i) => {
    s.insertTrack.run({
      id: uid(), playlistId: id, title: t.title, artist: t.artist || '',
      url: t.url || '', addedBy: creatorId, sort: i, createdAt: now(),
    });
  });
  return s.byMessage.get(messageId);
}

export function addTrack(messageId, { title, artist = '', url = '', addedBy }) {
  const pl = s.byMessage.get(messageId);
  if (!pl) return false;
  if (s.count.get(pl.id).n >= MAX_TRACKS) return false;
  const sort = s.maxSort.get(pl.id).m + 1;
  s.insertTrack.run({ id: uid(), playlistId: pl.id, title, artist, url, addedBy, sort, createdAt: now() });
  return true;
}

export function removeTrack(messageId, trackId) {
  const pl = s.byMessage.get(messageId);
  if (!pl) return false;
  return s.delTrack.run(trackId, pl.id).changes > 0;
}

export function playlistView(messageId) {
  const pl = s.byMessage.get(messageId);
  if (!pl) return null;
  return {
    id: pl.id,
    title: pl.title,
    creatorId: pl.creator_id,
    tracks: s.tracks.all(pl.id).map((t) => ({
      id: t.id, title: t.title, artist: t.artist || '', url: t.url || '', addedBy: t.added_by,
    })),
  };
}
