import { db, now } from './db.js';
import { uid } from './repo.js';

// Sticker packs (0.34.0). A sticker is just an upload (image/webp) grouped into a
// pack; sending one creates a normal message (type='sticker') whose attachment
// points at the upload, so it rides the usual delivery/offline path. Users see
// the built-in packs plus any they created.

const s = {
  insertPack: db.prepare(`
    INSERT INTO sticker_packs (id, owner_id, name, cover, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  packById: db.prepare('SELECT * FROM sticker_packs WHERE id = ?'),
  packsFor: db.prepare(`
    SELECT * FROM sticker_packs WHERE builtin = 1 OR owner_id = ?
     ORDER BY builtin DESC, created_at DESC`),
  insertSticker: db.prepare(`
    INSERT INTO stickers (id, pack_id, upload_id, emoji, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`),
  stickersOf: db.prepare('SELECT * FROM stickers WHERE pack_id = ? ORDER BY sort, created_at'),
  stickerById: db.prepare('SELECT * FROM stickers WHERE id = ?'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM stickers WHERE pack_id = ?'),
};

export function createPack({ ownerId, name, builtin = false }) {
  const id = uid();
  s.insertPack.run(id, ownerId, name, null, builtin ? 1 : 0, now());
  return s.packById.get(id);
}

export function addSticker({ packId, uploadId, emoji = '' }) {
  const pack = s.packById.get(packId);
  if (!pack) return null;
  const id = uid();
  s.insertSticker.run(id, packId, uploadId, emoji, s.maxSort.get(packId).m + 1, now());
  return s.stickerById.get(id);
}

export const getSticker = (id) => s.stickerById.get(id);
export const getPack = (id) => s.packById.get(id);
export const ownsPack = (packId, userId) => {
  const p = s.packById.get(packId);
  return !!p && p.owner_id === userId;
};

const stickerView = (row) => ({
  id: row.id,
  url: `/api/uploads/${row.upload_id}`,
  emoji: row.emoji || '',
});

/** Every pack a user can pick from, each with its stickers. */
export function packsForUser(userId) {
  return s.packsFor.all(userId).map((p) => ({
    id: p.id,
    name: p.name,
    builtin: !!p.builtin,
    mine: p.owner_id === userId,
    stickers: s.stickersOf.all(p.id).map(stickerView),
  }));
}
