/* voicerooms.js — 0.38.0 "Universum" Pillar B: persistent group audio rooms.
   The room is the roster + signalling rendezvous; actual audio rides on the
   existing group-call mesh (best-effort start on join). This module owns the
   in-chat "Raum" banner + the roster sheet. State is driven by the server
   endpoints and the 'voiceroom' socket event. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';

let current = null; // { chatId, room }

store.on('voiceroom', (p) => {
  if (current && p.room && p.room.chatId === current.chatId) current.room = p.room;
  else if (p.closed) current = null;
  store.emit('voiceroom-ui');
});

/** Open (or join) the active room for a chat. */
export async function openVoiceRoom(chatId) {
  try {
    let { room } = await api.get(`/chats/${chatId}/voiceroom`);
    if (!room) ({ room } = await api.post(`/chats/${chatId}/voiceroom`, { title: '' }));
    else await api.post(`/chats/${chatId}/voiceroom/${room.id}/join`, {});
    current = { chatId, room };
    // Best-effort: bring up the audio mesh via the existing calls module.
    import('./calls.js').then((m) => m.startCall?.(chatId, { audioOnly: true, room: room.id })).catch(() => {});
    roomSheet(chatId);
  } catch (e) { toast(e.message || 'Raum konnte nicht geöffnet werden.', 'err'); }
}

export async function leaveVoiceRoom() {
  if (!current) return;
  const { chatId, room } = current;
  try { await api.post(`/chats/${chatId}/voiceroom/${room.id}/leave`, {}); } catch {}
  current = null;
  store.emit('voiceroom-ui');
}

function roomSheet(chatId) {
  const md = modal({
    title: '🎙️ Raum',
    body: (b) => {
      const list = el('div', { class: 'vr-list' });
      const render = () => {
        clear(list);
        const room = current?.room;
        if (!room) { list.append(el('div', { class: 'pane-empty', text: 'Der Raum ist geschlossen.' })); return; }
        for (const mem of room.members || []) {
          list.append(el('div', { class: 'vr-member' }, [
            el('div', { class: 'vr-role', text: mem.role === 'host' ? '⭐' : (mem.hand ? '✋' : '🎤') }),
            el('div', { class: 'uname', text: mem.user?.displayName || 'Teilnehmer' }),
          ]));
        }
      };
      render();
      store.on('voiceroom-ui', render);
      b.append(list);
    },
    foot: [
      el('button', { class: 'btn small', onClick: async () => { try { await api.post(`/chats/${chatId}/voiceroom/${current.room.id}/hand`, { hand: true }); } catch {} } }, '✋ Melden'),
      el('button', { class: 'btn', onClick: () => { leaveVoiceRoom(); md.close(); } }, 'Verlassen'),
    ],
  });
}

/** A compact banner the chat header can show when a room is live. */
export function voiceRoomBanner(chatId, onJoin) {
  const bar = el('div', { class: 'vr-banner' });
  const paint = async () => {
    clear(bar);
    let room = null;
    try { ({ room } = await api.get(`/chats/${chatId}/voiceroom`)); } catch { return; }
    if (!room) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.append(
      icon('mic', 'sm'),
      el('span', { text: `Raum läuft · ${room.members?.length || 0} dabei` }),
      el('button', { class: 'btn small', onClick: () => (onJoin ? onJoin() : openVoiceRoom(chatId)) }, 'Beitreten'),
    );
  };
  paint();
  store.on('voiceroom-ui', paint);
  return bar;
}
