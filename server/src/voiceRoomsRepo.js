import { db, now } from './db.js';
import { uid } from './repo.js';
import { publicUser, getUserById } from './repo.js';

// Voice rooms (Pillar B): a persistent group audio room ("Raum"). One active room
// per chat; members join/leave freely. The actual audio rides on the existing
// WebRTC mesh (the room is the signalling rendezvous + roster). Roles: host /
// speaker / listener; a listener can raise a hand to request to speak.

const s = {
  insertRoom: db.prepare(`
    INSERT INTO voice_rooms (id, chat_id, creator_id, title, active, created_at)
    VALUES (@id, @chatId, @creatorId, @title, 1, @createdAt)`),
  activeByChat: db.prepare('SELECT * FROM voice_rooms WHERE chat_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1'),
  byId: db.prepare('SELECT * FROM voice_rooms WHERE id = ?'),
  endRoom: db.prepare('UPDATE voice_rooms SET active = 0, ended_at = ? WHERE id = ?'),
  join: db.prepare(`
    INSERT INTO voice_room_members (room_id, user_id, role, hand, joined_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`),
  leave: db.prepare('DELETE FROM voice_room_members WHERE room_id = ? AND user_id = ?'),
  members: db.prepare('SELECT * FROM voice_room_members WHERE room_id = ? ORDER BY joined_at'),
  count: db.prepare('SELECT COUNT(*) AS n FROM voice_room_members WHERE room_id = ?'),
  setHand: db.prepare('UPDATE voice_room_members SET hand = ? WHERE room_id = ? AND user_id = ?'),
};

export function getActiveRoom(chatId) {
  return s.activeByChat.get(chatId);
}

/** Open a room (or return the existing active one) and seat the opener as host. */
export function openVoiceRoom({ chatId, creatorId, title = '' }) {
  let room = s.activeByChat.get(chatId);
  if (!room) {
    const id = uid();
    s.insertRoom.run({ id, chatId, creatorId, title: title || '', createdAt: now() });
    room = s.byId.get(id);
  }
  s.join.run(room.id, creatorId, 'host', now());
  return room;
}

export function joinVoiceRoom(roomId, userId, role = 'speaker') {
  const room = s.byId.get(roomId);
  if (!room || !room.active) return false;
  s.join.run(roomId, userId, role, now());
  return true;
}

/** Leave a room; the last person out closes it. Returns { closed }. */
export function leaveVoiceRoom(roomId, userId) {
  s.leave.run(roomId, userId);
  const left = s.count.get(roomId).n;
  if (left === 0) {
    s.endRoom.run(now(), roomId);
    return { closed: true };
  }
  return { closed: false };
}

export function raiseHand(roomId, userId, hand) {
  return s.setHand.run(hand ? 1 : 0, roomId, userId).changes > 0;
}

export function voiceRoomView(roomId) {
  const room = s.byId.get(roomId);
  if (!room) return null;
  return {
    id: room.id,
    chatId: room.chat_id,
    title: room.title || '',
    active: !!room.active,
    creatorId: room.creator_id,
    members: s.members.all(roomId).map((m) => {
      const u = getUserById(m.user_id);
      return { user: u ? publicUser(u) : { id: m.user_id }, role: m.role, hand: !!m.hand };
    }),
  };
}
