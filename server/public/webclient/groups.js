/* groups.js — create groups, join by invite link, manage members + the group
   info panel (rename, description, avatar, invite link, leave), and create
   polls. Lazy-loaded from the shell menu and chat actions. */

import { api, authedObjectUrl } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, confirmModal } from './ui.js';
import { pickFile } from './media.js';
import { lookup, userRow, openProfile } from './contacts.js';
import { flag } from './flags.js';

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
      el('div', { class: 'auth-or', text: 'oder' }),
      el('button', { class: 'btn block', onClick: () => { m.close(); joinModal(); } },
        [icon('link'), 'Per Einladungslink beitreten']),
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

// ---- join by invite code/link ---------------------------------------------
export function joinModal() {
  const err = el('div', { class: 'formerr' });
  const input = el('input', { class: 'input', placeholder: 'Einladungslink oder Code' });
  const m = modal({
    title: 'Gruppe beitreten',
    body: (b) => b.append(
      el('p', { class: 'hint', text: 'Füge einen Ping-Einladungslink oder den Code ein.' }),
      el('div', { class: 'field', style: { marginTop: '10px' } }, input), err),
    foot: [el('button', { class: 'btn primary', onClick: submit }, 'Beitreten')],
  });
  setTimeout(() => input.focus(), 0);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  async function submit() {
    err.textContent = '';
    const raw = input.value.trim();
    const code = raw.includes('/join/') ? raw.split('/join/')[1].split(/[/?#]/)[0] : raw;
    if (!code) { err.textContent = 'Bitte einen Code eingeben.'; return; }
    try {
      const { chat } = await api.post('/chats/join', { code });
      store.upsertChat(chat); m.close(); store.emit('open-chat', chat.id);
      toast('Beigetreten.', 'ok');
    } catch (e) { err.textContent = e.message; }
  }
}

// ---- chat / group info ----------------------------------------------------
export function openChatInfo(chat) {
  if (chat.type === 'direct') return openProfile(chat.otherUser);
  const meOwner = chat.ownerId === store.state.me?.id;

  const mdl = modal({ title: 'Gruppeninfo', body: (body) => render(body) });

  function render(body) {
    clear(body);
    const avBox = el('div', { style: { position: 'relative', cursor: meOwner ? 'pointer' : 'default' },
      onClick: meOwner ? changeAvatar : null, title: meOwner ? 'Gruppenbild ändern' : '' },
      avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
        hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 96, { kind: 'chat' }));
    if (meOwner) avBox.appendChild(el('div', { style: { position: 'absolute', right: '0', bottom: '0',
      background: 'var(--accent)', borderRadius: '50%', width: '28px', height: '28px',
      display: 'grid', placeItems: 'center', border: '3px solid var(--glass)' } }, icon('camera', 'sm')));

    body.append(
      el('div', { class: 'profile-pane' }, [avBox,
        el('h3', { text: chat.title }),
        chat.description ? el('p', { class: 'hint', text: chat.description }) : null,
        el('div', { class: 'hint', text: `${chat.members?.length || 0} Mitglieder` }),
      ].filter(Boolean)),
    );

    if (meOwner) {
      body.append(
        editRow('Gruppenname', chat.title, (v) => patch({ name: v })),
        editRow('Beschreibung', chat.description || '', (v) => patch({ description: v }), 'Worum geht es?'),
      );
    }

    inviteSection(body, chat, meOwner);

    body.append(meOwner ? el('button', { class: 'btn block', style: { margin: '10px 0' },
      onClick: () => addMember(chat) }, [icon('plus'), 'Mitglied hinzufügen']) : null,
      el('div', { class: 'list-section', text: 'Mitglieder' }));
    for (const u of chat.members || []) {
      const row = userRow(u, () => u.id !== store.state.me.id && openProfile(u));
      if (u.id === chat.ownerId) row.appendChild(el('span', { class: 'badge', text: 'Admin' }));
      else if (meOwner) row.appendChild(el('button', { class: 'iconbtn', title: 'Entfernen',
        onClick: (e) => { e.stopPropagation(); removeMember(chat, u); } }, icon('close')));
      body.appendChild(row);
    }
    body.appendChild(el('button', { class: 'btn danger block', style: { marginTop: '16px' },
      onClick: () => leaveGroup(chat.id) }, [icon('logout'), 'Gruppe verlassen']));

    async function patch(p) {
      try { const { chat: updated } = await api.patch(`/chats/${chat.id}`, p);
        Object.assign(chat, updated); store.upsertChat(chat); render(body); toast('Gespeichert.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    }
    async function changeAvatar() {
      const file = await pickFile('image/*'); if (!file) return;
      try { const buf = await file.arrayBuffer();
        await api.post(`/chats/${chat.id}/avatar`, buf, { raw: true, headers: { 'Content-Type': file.type || 'image/jpeg' } });
        const { chat: updated } = await api.get(`/chats/${chat.id}`);
        Object.assign(chat, updated); store.upsertChat(chat); render(body); toast('Bild aktualisiert.', 'ok'); }
      catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
    }
  }
}

function inviteSection(body, chat, meOwner) {
  const wrap = el('div');
  body.append(el('div', { class: 'list-section', text: 'Einladungslink' }), wrap);
  const draw = (code, url) => {
    clear(wrap);
    if (code) {
      const field = el('input', { class: 'input', readonly: 'readonly', value: url || code });
      wrap.append(el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('div', { style: { flex: '1' } }, field),
        el('button', { class: 'btn sm', title: 'Kopieren', onClick: () => {
          navigator.clipboard?.writeText(url || code).then(() => toast('Kopiert.')); } }, icon('copy')),
      ]));
      if (meOwner) wrap.append(el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        el('button', { class: 'btn sm', onClick: rotate }, [icon('refresh'), 'Neu']),
        el('button', { class: 'btn sm danger', onClick: revoke }, 'Widerrufen'),
      ]));
    } else {
      wrap.append(meOwner
        ? el('button', { class: 'btn sm', onClick: rotate }, [icon('link'), 'Link erstellen'])
        : el('div', { class: 'hint', text: 'Noch kein Einladungslink.' }));
    }
  };
  api.get(`/chats/${chat.id}/invite`).then((r) => draw(r.code, r.url)).catch(() => draw(null));
  async function rotate() {
    try { const r = await api.post(`/chats/${chat.id}/invite`); draw(r.code, r.url); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function revoke() {
    try { await api.del(`/chats/${chat.id}/invite`); draw(null); toast('Widerrufen.'); }
    catch (e) { toast(e.message, 'err'); }
  }
}

function editRow(label, value, onSave, placeholder) {
  const input = el('input', { class: 'input', value, placeholder: placeholder || '' });
  const btn = el('button', { class: 'btn sm primary', onClick: () => onSave(input.value.trim()) }, 'OK');
  btn.style.display = 'none';
  input.addEventListener('input', () => { btn.style.display = input.value !== value ? '' : 'none'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSave(input.value.trim()); });
  return el('div', { class: 'field' }, [el('label', { text: label }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [el('div', { style: { flex: '1' } }, input), btn])]);
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
  const optsBox = el('div', { class: 'poll-opts' });
  const err = el('div', { class: 'formerr' });
  // 0.37.0 "Feinschliff": optional quiz mode — mark the one correct answer.
  const quizAvailable = flag('pollQuiz');
  let quiz = false;
  // Each option row is [optional correct-radio] + [text input].
  const addOpt = (val = '') => {
    const i = el('input', { class: 'input', placeholder: 'Option', value: val });
    const radio = el('input', { type: 'radio', name: 'poll-correct', title: 'Richtige Antwort',
      'aria-label': 'Als richtig markieren' });
    const row = el('div', { class: `poll-opt-row ${quiz ? 'quiz' : ''}` }, [radio, i]);
    optsBox.appendChild(row);
    i.addEventListener('input', () => { if (row === optsBox.lastChild && i.value.trim()) addOpt(); });
  };
  addOpt(); addOpt();
  const quizToggle = quizAvailable
    ? el('label', { class: 'check-row' }, [
        el('input', { type: 'checkbox', onChange: (e) => {
          quiz = e.target.checked;
          optsBox.classList.toggle('quiz', quiz);
          optsBox.querySelectorAll('.poll-opt-row').forEach((r) => r.classList.toggle('quiz', quiz));
        } }),
        el('span', { text: 'Quiz-Modus (eine richtige Antwort)' }),
      ])
    : null;
  const m = modal({
    title: 'Umfrage erstellen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Frage' }), q]),
      el('label', { class: 'hint', text: 'Optionen' }), optsBox,
      quizToggle, err),
    foot: [el('button', { class: 'btn primary', onClick: create }, 'Erstellen')],
  });
  async function create() {
    err.textContent = '';
    const rows = [...optsBox.querySelectorAll('.poll-opt-row')];
    const options = rows.map((r) => r.querySelector('input.input').value.trim());
    const filled = options.filter(Boolean);
    if (!q.value.trim() || filled.length < 2) { err.textContent = 'Frage und mind. 2 Optionen.'; return; }
    let correct = null;
    if (quiz) {
      // Index of the checked radio, counted among non-empty options.
      const checkedRow = rows.findIndex((r) => r.querySelector('input[type=radio]').checked);
      if (checkedRow < 0 || !options[checkedRow]) { err.textContent = 'Bitte die richtige Antwort markieren.'; return; }
      correct = options.slice(0, checkedRow + 1).filter(Boolean).length - 1;
    }
    const payload = { question: q.value.trim(), options: filled };
    if (quiz) payload.correct = correct;
    try { await api.post(`/chats/${chatId}/polls`, payload); m.close(); }
    catch (e) { err.textContent = e.message; }
  }
}
