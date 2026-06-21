/* boards.js — Kanban-Boards (0.34.0). A 'board' message carries columns + cards
   in message.board. This module renders the in-chat board (columns with cards,
   add-card / add-column, move a card left/right between columns) and the create
   modal. Moves/edits go through the server and re-broadcast as message-updated. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, openMenu } from './ui.js';

/** Render the in-chat board card for message [m]. */
export function renderBoard(m) {
  const board = m.board || { columns: [] };
  const wrap = el('div', { class: 'board-card' });
  wrap.append(el('div', { class: 'board-head' }, [
    icon('tasks', 'sm'),
    el('div', { class: 'board-title', text: board.title || 'Board' }),
    el('button', { class: 'iconbtn sm', title: 'Spalte hinzufügen',
      onClick: () => addColumn(m) }, icon('plus')),
  ]));
  const cols = el('div', { class: 'board-cols' });
  for (const col of board.columns || []) {
    const colEl = el('div', { class: 'board-col' }, [
      el('div', { class: 'bcol-head', text: col.title }),
    ]);
    for (const card of col.cards || []) {
      colEl.append(el('div', { class: 'bcard',
        onClick: (e) => cardMenu(e, m, board, col, card) }, card.text));
    }
    colEl.append(el('button', { class: 'bcol-add', onClick: () => addCard(m, col) }, [icon('plus', 'sm'), 'Karte']));
    cols.append(colEl);
  }
  wrap.append(cols);
  return wrap;
}

function cardMenu(e, m, board, col, card) {
  e.stopPropagation();
  const idx = board.columns.findIndex((c) => c.id === col.id);
  const left = board.columns[idx - 1];
  const right = board.columns[idx + 1];
  openMenu(e, [
    left ? { label: `← ${left.title}`, icon: 'back', onClick: () => move(m, card.id, left.id) } : null,
    right ? { label: `${right.title} →`, icon: 'forward', onClick: () => move(m, card.id, right.id) } : null,
    { label: 'Bearbeiten', icon: 'edit', onClick: () => editCard(m, card) },
    { sep: true },
    { label: 'Löschen', icon: 'trash', danger: true, onClick: () => del(m, card.id) },
  ].filter(Boolean));
}

async function addCard(m, col) {
  const text = prompt(`Neue Karte in „${col.title}":`);
  if (!text?.trim()) return;
  try { await api.post(`/chats/${m.chatId}/messages/${m.id}/board/cards`, { columnId: col.id, text: text.trim() }); }
  catch (e) { toast(e.message || 'Fehlgeschlagen.', 'err'); }
}
async function addColumn(m) {
  const title = prompt('Name der neuen Spalte:');
  if (!title?.trim()) return;
  try { await api.post(`/chats/${m.chatId}/messages/${m.id}/board/columns`, { title: title.trim() }); }
  catch (e) { toast(e.message || 'Fehlgeschlagen.', 'err'); }
}
async function move(m, cardId, columnId) {
  try { await api.post(`/chats/${m.chatId}/messages/${m.id}/board/cards/${cardId}/move`, { columnId }); }
  catch (e) { toast(e.message || 'Verschieben fehlgeschlagen.', 'err'); }
}
async function editCard(m, card) {
  const text = prompt('Karte bearbeiten:', card.text);
  if (text == null || !text.trim()) return;
  try { await api.post(`/chats/${m.chatId}/messages/${m.id}/board/cards/${card.id}/edit`, { text: text.trim() }); }
  catch (e) { toast(e.message || 'Fehlgeschlagen.', 'err'); }
}
async function del(m, cardId) {
  try { await api.del(`/chats/${m.chatId}/messages/${m.id}/board/cards/${cardId}`); }
  catch (e) { toast(e.message || 'Löschen fehlgeschlagen.', 'err'); }
}

/** Create-board modal for [chatId]. */
export function newBoardModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Board-Titel', maxlength: '120' });
  const cols = el('input', { class: 'input', value: 'Zu erledigen, In Arbeit, Erledigt', maxlength: '200' });
  const err = el('div', { class: 'formerr' });
  const m = modal({
    title: 'Board erstellen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('div', { class: 'field' }, [el('label', { text: 'Spalten (mit Komma getrennt)' }), cols]),
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Board erstellen')],
  });
  setTimeout(() => title.focus(), 50);
  async function create() {
    const t = title.value.trim();
    if (!t) { err.textContent = 'Bitte einen Titel eingeben.'; return; }
    const columns = cols.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    try {
      const { message } = await api.post(`/chats/${chatId}/boards`,
        columns.length ? { title: t, columns } : { title: t });
      store.addMessage(chatId, message);
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte das Board nicht erstellen.'; }
  }
}
