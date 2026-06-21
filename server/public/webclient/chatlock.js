/* chatlock.js — per-chat lock / hide (0.34.0). A personal preference (per member)
   to lock a chat behind the app lock and optionally hide it from the main list
   until unlocked. Server stores the lock/hidden flags per (chat, user); the actual
   gate reuses the existing app-lock (lock.js). */

import { api } from './api.js';
import * as store from './store.js';
import { el, icon, modal, toast } from './ui.js';

export async function chatLockModal(chatId) {
  let state = { locked: false, hidden: false };
  try { ({ lock: state } = await api.get(`/chats/${chatId}/lock`)); } catch { /* defaults */ }
  const body = el('div', { class: 'lock-panel' });
  const dlg = modal({ title: 'Chat sperren', width: '420px', body: (b) => b.append(body) });
  paint();
  function paint() {
    body.replaceChildren(
      el('p', { class: 'hint', text: 'Gesperrte Chats verlangen die App-Sperre, bevor sie sich öffnen. Versteckte Chats erscheinen erst nach dem Entsperren in der Liste.' }),
      toggleRow('Diesen Chat sperren', state.locked, (v) => save({ locked: v })),
      toggleRow('Aus der Chatliste ausblenden', state.hidden, (v) => save({ hidden: v })),
    );
  }
  function toggleRow(label, on, onChange) {
    const cb = el('input', { type: 'checkbox', checked: on ? 'checked' : null });
    cb.addEventListener('change', () => onChange(cb.checked));
    return el('label', { class: 'check-row' }, [cb, el('span', { text: label })]);
  }
  async function save(patch) {
    try {
      ({ lock: state } = await api.put(`/chats/${chatId}/lock`, patch));
      const chat = store.getChat(chatId);
      if (chat) { chat.locked_personal = state.locked; chat.hidden = state.hidden; store.emit('chats'); }
      toast('Gespeichert.', 'ok');
      paint();
    } catch (e) { toast(e.message || 'Speichern fehlgeschlagen.', 'err'); }
  }
}
