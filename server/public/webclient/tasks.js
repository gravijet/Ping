/* tasks.js — "Aufgaben" (collaborative task lists / checklists). A task list is
   a structured message (type 'tasklist'); its items ride along in
   message.tasklist. Anyone in the chat can tick an item or append one, and the
   change is broadcast live. Owns the create modal + the in-chat checklist card. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';

const MAX_ITEMS = 50;

/** Modal to create a task list in [chatId]. */
export function newTaskListModal(chatId) {
  const title = el('input', { class: 'input', placeholder: 'Titel der Liste', maxlength: '140' });
  const itemsBox = el('div', { class: 'task-edit-items' });
  const err = el('div', { class: 'formerr' });

  const addRow = (val = '') => {
    if (itemsBox.children.length >= MAX_ITEMS) return;
    const i = el('input', { class: 'input', placeholder: 'Aufgabe', value: val, maxlength: '200' });
    const row = el('div', { class: 'task-edit-row' }, [
      icon('check', 'sm muted'),
      i,
      el('button', { class: 'iconbtn', title: 'Entfernen', tabindex: '-1',
        onClick: () => { if (itemsBox.children.length > 1) row.remove(); } }, icon('close', 'sm')),
    ]);
    itemsBox.appendChild(row);
    // Typing in the last row spawns a fresh empty one (Wunderlist-style).
    i.addEventListener('input', () => {
      if (row === itemsBox.lastChild && i.value.trim()) addRow();
    });
    return i;
  };
  addRow(); addRow();

  const m = modal({
    title: 'Aufgabenliste erstellen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), title]),
      el('label', { class: 'hint', text: 'Aufgaben' }),
      itemsBox,
      err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Liste erstellen')],
  });
  setTimeout(() => title.focus(), 50);

  async function create() {
    err.textContent = '';
    const t = title.value.trim();
    const items = [...itemsBox.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    if (!t) { err.textContent = 'Bitte gib der Liste einen Titel.'; return; }
    if (!items.length) { err.textContent = 'Mindestens eine Aufgabe eingeben.'; return; }
    try {
      await api.post(`/chats/${chatId}/tasklists`, { title: t, items });
      telemetry.track('tasklist_create', { items: items.length });
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte die Liste nicht erstellen.'; }
  }
}

/** Render the in-chat task-list card for message [m]. */
export function renderTaskList(m, { onChange } = {}) {
  const tl = m.tasklist || {};
  const items = tl.items || [];
  const pct = tl.total ? Math.round((tl.completed / tl.total) * 100) : 0;
  const card = el('div', { class: 'task-card' });

  card.append(el('div', { class: 'task-head' }, [
    icon('check', 'sm'),
    el('div', { class: 'task-title', text: tl.title || 'Aufgaben' }),
    el('div', { class: 'task-progress-label', text: `${tl.completed || 0}/${tl.total || 0}` }),
  ]));

  // Progress bar.
  card.append(el('div', { class: 'task-bar' }, el('i', {
    class: pct === 100 ? 'done' : '', style: { width: pct + '%' } })));

  const list = el('div', { class: 'task-items' });
  for (const it of items) {
    const row = el('label', { class: `task-item ${it.done ? 'done' : ''}` });
    const box = el('input', { type: 'checkbox', class: 'task-check' });
    box.checked = !!it.done;
    box.addEventListener('change', () => toggleItem(m, it.id, box.checked, onChange));
    row.append(
      box,
      el('span', { class: 'task-text', text: it.text }),
      it.done && it.doneByName
        ? el('span', { class: 'task-by', text: it.doneByName })
        : null,
    );
    list.append(row);
  }
  card.append(list);

  // Inline "add item" affordance.
  const addInput = el('input', { class: 'task-add-input', placeholder: '+ Aufgabe hinzufügen', maxlength: '200' });
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(m, addInput, onChange); }
  });
  card.append(el('div', { class: 'task-add' }, addInput));
  return card;
}

async function toggleItem(m, itemId, done, onChange) {
  try {
    const chatId = m.chatId || store.state.activeId;
    const { message } = await api.post(`/chats/${chatId}/messages/${m.id}/tasks/${itemId}/toggle`, { done });
    if (onChange) onChange(message);
  } catch (e) { toast(e.message || 'Konnte die Aufgabe nicht aktualisieren.', 'err'); }
}

async function addItem(m, input, onChange) {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    const chatId = m.chatId || store.state.activeId;
    const { message } = await api.post(`/chats/${chatId}/messages/${m.id}/tasks`, { text });
    telemetry.track('tasklist_add_item');
    if (onChange) onChange(message);
  } catch (e) {
    input.value = text;
    toast(e.message || 'Konnte die Aufgabe nicht hinzufügen.', 'err');
  }
}
