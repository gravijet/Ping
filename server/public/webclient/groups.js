/* groups.js — create groups, manage members, group/chat info panel, leave a
   group, and create polls. Lazy-loaded from the shell menu and chat actions. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, confirmModal } from './ui.js';
import { lookup, userRow, openProfile } from './contacts.js';

// ---- create group ---------------------------------------------------------
export function newGroupModal() {
  const selected = new Map(); // id -> user
  const name = el('input', { class: 'input', placeholder: 'Gruppenname' });
  const phone = el('input', { class: 'input', placeholder: 'Mitglied per Nummer hinzufügen' });
  const addBtn = el('button', { class: 'btn sm', onClick: add }, 'Hinzufügen');
  const chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '10px 0' } });
  const err = el('div', { class: 'formerr' });

  const m = modal({
    title: 'Neue Gruppe',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Mitglieder' }),
        el('div', { style: { display: 'flex', gap: '8px' } },
          [el('div', { style: { flex: '1' } }, phone), addBtn])]),
      chips, err,
    ),
    foot: [el('button', { class: 'btn primary', onClick: create }, [icon('group'), 'Gruppe erstellen'])],
  });
  phone.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));

  async function add() {
    err.textContent = '';
    if (!phone.value.trim()) return;
    try {
      const u = await lookup(phone.value.trim());
      if (u.id === store.state.me.id) { err.textContent = 'Dich selbst musst du nicht hinzufügen.'; return; }
      selected.set(u.id, u); phone.value = ''; drawChips();
    } catch (e) { err.textContent = e.message; }
  }
  function drawChips() {
    clear(chips);
    for (const u of selected.values()) {
      chips.appendChild(el('div', { class: 'reaction', style: { padding: '5px 10px' } },
        [el('span', { text: u.displayName }), el('button', { class: 'linklike',
          style: { color: 'var(--danger)' }, onClick: () => { selected.delete(u.id); drawChips(); } }, '×')]));
    }
  }
  async function create() {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Bitte einen Gruppennamen eingeben.'; return; }
    try {
      const { chat } = await api.post('/chats/group',
        { name: name.value.trim(), memberIds: [...selected.keys()] });
      store.upsertChat(chat); m.close(); store.emit('open-chat', chat.id);
    } catch (e) { err.textContent = e.message; }
  }
}

// ---- chat / group info ----------------------------------------------------
export function openChatInfo(chat) {
  if (chat.type === 'direct') return openProfile(chat.otherUser);
  const meOwner = chat.ownerId === store.state.me?.id;

  modal({
    title: 'Gruppeninfo',
    body: (body) => {
      body.append(
        el('div', { class: 'profile-pane' }, [
          avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
            hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 100, { kind: 'chat' }),
          el('h3', { text: chat.title, style: { margin: '4px 0 0' } }),
          chat.description ? el('p', { class: 'hint', text: chat.description }) : null,
          el('div', { class: 'hint', text: `${chat.members?.length || 0} Mitglieder` }),
        ].filter(Boolean)),
        meOwner ? el('button', { class: 'btn block', style: { margin: '10px 0' },
          onClick: () => addMember(chat) }, [icon('plus'), 'Mitglied hinzufügen']) : null,
        el('div', { class: 'list-section', text: 'Mitglieder' }),
      );
      for (const u of chat.members || []) {
        const row = userRow(u, () => u.id !== store.state.me.id && openProfile(u));
        if (u.id === chat.ownerId) row.appendChild(el('span', { class: 'badge', text: 'Admin',
          style: { background: 'var(--surface-3)', color: 'var(--muted)' } }));
        else if (meOwner) row.appendChild(el('button', { class: 'iconbtn', title: 'Entfernen',
          onClick: (e) => { e.stopPropagation(); removeMember(chat, u); } }, icon('close')));
        body.appendChild(row);
      }
      body.appendChild(el('button', { class: 'btn danger block', style: { marginTop: '16px' },
        onClick: () => leaveGroup(chat.id) }, [icon('logout'), 'Gruppe verlassen']));
    },
  });
}

async function addMember(chat) {
  const phone = prompt('Handynummer des neuen Mitglieds:');
  if (!phone) return;
  try {
    const u = await lookup(phone.trim());
    await api.post(`/chats/${chat.id}/members`, { memberIds: [u.id] });
    toast('Hinzugefügt.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
async function removeMember(chat, u) {
  if (!await confirmModal({ title: 'Entfernen', message: `${u.displayName} aus der Gruppe entfernen?`,
    confirmText: 'Entfernen', danger: true })) return;
  try { await api.del(`/chats/${chat.id}/members/${u.id}`); toast('Entfernt.', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

export async function leaveGroup(chatId) {
  if (!await confirmModal({ title: 'Gruppe verlassen', message: 'Diese Gruppe wirklich verlassen?',
    confirmText: 'Verlassen', danger: true })) return;
  try {
    await api.post(`/chats/${chatId}/leave`);
    store.state.chats.delete(chatId);
    store.state.messages.delete(chatId);
    if (store.state.activeId === chatId) { store.state.activeId = null; store.emit('open-splash'); }
    store.emit('chats');
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  } catch (e) { toast(e.message, 'err'); }
}

// ---- poll -----------------------------------------------------------------
export function newPollModal(chatId) {
  const q = el('input', { class: 'input', placeholder: 'Frage' });
  const optsBox = el('div');
  const err = el('div', { class: 'formerr' });
  const addOpt = (val = '') => {
    const i = el('input', { class: 'input', placeholder: 'Option', value: val,
      style: { marginBottom: '8px' } });
    optsBox.appendChild(i);
    i.addEventListener('input', () => {
      if (i === optsBox.lastChild && i.value.trim()) addOpt();
    });
  };
  addOpt(); addOpt();
  const m = modal({
    title: 'Umfrage erstellen',
    body: (b) => b.append(el('div', { class: 'field' }, [el('label', { text: 'Frage' }), q]),
      el('label', { class: 'hint', text: 'Optionen' }), optsBox, err),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Erstellen')],
  });
  async function create() {
    err.textContent = '';
    const options = [...optsBox.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    if (!q.value.trim() || options.length < 2) { err.textContent = 'Frage und mind. 2 Optionen.'; return; }
    try { await api.post(`/chats/${chatId}/polls`, { question: q.value.trim(), options }); m.close(); }
    catch (e) { err.textContent = e.message; }
  }
}
