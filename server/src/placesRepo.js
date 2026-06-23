import { db, now } from './db.js';
import { uid } from './repo.js';

// Pinned places (type='place'): a small map collection of named lat/lng pins
// (e.g. "Treffpunkte", "Lieblingsläden"). Anyone in the chat can add a pin.

const MAX_PINS = 100;

const s = {
  insert: db.prepare(`
    INSERT INTO places (id, message_id, chat_id, creator_id, title, created_at)
    VALUES (@id, @messageId, @chatId, @creatorId, @title, @createdAt)`),
  byMessage: db.prepare('SELECT * FROM places WHERE message_id = ?'),
  insertPin: db.prepare(`
    INSERT INTO place_pins (id, place_id, name, lat, lng, note, sort)
    VALUES (@id, @placeId, @name, @lat, @lng, @note, @sort)`),
  pins: db.prepare('SELECT * FROM place_pins WHERE place_id = ? ORDER BY sort'),
  count: db.prepare('SELECT COUNT(*) AS n FROM place_pins WHERE place_id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM place_pins WHERE place_id = ?'),
  delPin: db.prepare('DELETE FROM place_pins WHERE id = ? AND place_id = ?'),
};

export function createPlace({ messageId, chatId, creatorId, title, pins = [] }) {
  const id = uid();
  s.insert.run({ id, messageId, chatId, creatorId, title, createdAt: now() });
  pins.slice(0, MAX_PINS).forEach((p, i) => {
    s.insertPin.run({ id: uid(), placeId: id, name: p.name, lat: p.lat, lng: p.lng, note: p.note || '', sort: i });
  });
  return s.byMessage.get(messageId);
}

export function addPin(messageId, { name, lat, lng, note = '' }) {
  const pl = s.byMessage.get(messageId);
  if (!pl) return false;
  if (s.count.get(pl.id).n >= MAX_PINS) return false;
  const sort = s.maxSort.get(pl.id).m + 1;
  s.insertPin.run({ id: uid(), placeId: pl.id, name, lat, lng, note, sort });
  return true;
}

export function placeView(messageId) {
  const pl = s.byMessage.get(messageId);
  if (!pl) return null;
  return {
    id: pl.id,
    title: pl.title,
    creatorId: pl.creator_id,
    pins: s.pins.all(pl.id).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, note: p.note || '' })),
  };
}
