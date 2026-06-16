/* contacts.js — start new chats (look a person up by phone, open a direct chat)
   and show a read-only profile card for a user. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast, lastSeenLabel } from './ui.js';

// Look a user up by phone (POST /users/lookup). Returns the publicUser or throws.
export async function lookup(phone) {
  const { user } = await api.post('/users/lookup', { phone });
  return user;
}

// Open (or create) a direct chat with a known user id, then jump to it.
export async function startDirect(userId) {
  const { chat } = await api.post('/chats/direct', { userId });
  store.upsertChat(chat);
  store.emit('open-chat', chat.id);
  return chat;
}

export function newChatModal() {
  const err = el('div', { class: 'formerr' });
  const phone = el('input', { class: 'input', placeholder: '+43 660 1234567', autocomplete: 'tel' });
  const result = el('div');
  const btn = el('button', { class: 'btn primary', onClick: find }, 'Suchen');

  const m = modal({
    title: 'Neuer Chat',
    body: (body) => body.append(
      el('p', { class: 'hint', text: 'Gib die Handynummer der Person ein, der du schreiben möchtest.' }),
      el('div', { class: 'field', style: { marginTop: '12px' } }, [
        el('label', { text: 'Handynummer' }), phone]),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, btn),
      err, result,
    ),
  });
  setTimeout(() => phone.focus(), 0);
  phone.addEventListener('keydown', (e) => e.key === 'Enter' && find());

  async function find() {
    err.textContent = ''; clear(result);
    if (!phone.value.trim()) return;
    btn.disabled = true; btn.textContent = 'Suche …';
    try {
      const user = await lookup(phone.value.trim());
      result.appendChild(userRow(user, async () => {
        try { await startDirect(user.id); m.close(); }
        catch (e) { toast(e.message, 'err'); }
      }));
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Suchen'; }
  }
}

// A clickable user row (used in new-chat results and member pickers).
export function userRow(user, onClick, { selected = null } = {}) {
  const online = store.isOnline(user.id);
  return el('div', { class: 'urow', onClick }, [
    avatar(user, 46, { online, kind: 'user' }),
    el('div', { class: 'meta' }, [
      el('div', { class: 'uname', text: user.displayName }),
      el('div', { class: 'uabout', text: user.about || (online ? 'online' : '') }),
    ]),
    selected === true ? icon('check', 'check') : null,
  ].filter(Boolean));
}

export function openProfile(user) {
  if (!user) return;
  modal({
    title: 'Profil',
    body: (body) => {
      body.appendChild(el('div', { class: 'profile-pane' }, [
        avatar(user, 110, { kind: 'user', online: store.isOnline(user.id) }),
        el('h3', { text: user.displayName, style: { margin: '4px 0 0' } }),
        user.about ? el('p', { class: 'hint', text: user.about }) : null,
        store.isOnline(user.id)
          ? el('div', { class: 'hint', text: 'online' })
          : el('div', { class: 'hint', text: lastSeenLabel(store.state.lastSeen.get(user.id)) }),
        user.city ? row('Ort', user.city) : null,
        user.pronouns ? row('Pronomen', user.pronouns) : null,
      ].filter(Boolean)));
    },
    foot: [
      el('button', { class: 'btn primary', onClick: async (e) => {
        try { await startDirect(user.id);
          e.target.closest('.modal-back')?.remove(); } catch (err) { toast(err.message, 'err'); }
      } }, [icon('edit'), 'Nachricht senden']),
    ],
  });
  function row(k, v) { return el('div', { class: 'profile-row' },
    [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]); }
}
