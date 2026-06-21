/* notes.js — collaborative group notes / wiki (0.34.0). A simple per-chat list of
   titled notes that any member can edit; changes broadcast 'note-updated' /
   'note-deleted'. Opened from the info panel. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, confirmModal } from './ui.js';

export function openNotes(chatId) {
  const list = el('div', { class: 'notes-list' });
  let off = null;
  const dlg = modal({
    title: 'Notizen',
    width: '480px',
    body: (b) => b.append(list),
    foot: [el('button', { class: 'btn primary', onClick: () => editNote(chatId, null, paint) }, [icon('plus'), 'Neue Notiz'])],
    onClose: () => off?.(),
  });
  off = store.on('notes:' + chatId, paint);
  paint();
  async function paint() {
    clear(list).append(el('div', { class: 'hint', text: 'Lade …' }));
    let notes = [];
    try { ({ notes } = await api.get(`/chats/${chatId}/notes`)); } catch { /* offline */ }
    clear(list);
    if (!notes?.length) { list.append(el('div', { class: 'pane-empty', text: 'Noch keine Notizen.' })); return; }
    for (const n of notes) {
      list.append(el('div', { class: 'note-row' }, [
        el('div', { class: 'note-main', onClick: () => editNote(chatId, n, paint) }, [
          el('div', { class: 'note-title', text: n.title }),
          el('div', { class: 'note-sub', text: (n.body || '').slice(0, 80) || '—' }),
        ]),
        el('button', { class: 'iconbtn', title: 'Löschen', onClick: async () => {
          if (!(await confirmModal({ title: 'Notiz löschen?', message: n.title, confirmText: 'Löschen', danger: true }))) return;
          try { await api.del(`/chats/${chatId}/notes/${n.id}`); paint(); }
          catch (e) { toast(e.message, 'err'); } } }, icon('trash')),
      ]));
    }
  }
}

function editNote(chatId, note, done) {
  const title = el('input', { class: 'input', placeholder: 'Titel', maxlength: '140', value: note?.title || '' });
  const body = el('textarea', { class: 'input', rows: '8', placeholder: 'Inhalt …', value: note?.body || '' });
  const err = el('div', { class: 'formerr' });
  const m = modal({
    title: note ? 'Notiz bearbeiten' : 'Neue Notiz',
    width: '480px',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Inhalt' }), body]),
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: save }, 'Speichern')],
  });
  setTimeout(() => title.focus(), 50);
  async function save() {
    const t = title.value.trim();
    if (!t) { err.textContent = 'Bitte einen Titel eingeben.'; return; }
    try {
      if (note) await api.put(`/chats/${chatId}/notes/${note.id}`, { title: t, body: body.value });
      else await api.post(`/chats/${chatId}/notes`, { title: t, body: body.value });
      m.close(); done?.();
    } catch (e) { err.textContent = e.message || 'Speichern fehlgeschlagen.'; }
  }
}

/** Realtime hook for app.js. */
export function onNoteEvent(chatId) { store.emit('notes:' + chatId); }
