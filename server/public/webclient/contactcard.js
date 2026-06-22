/* contactcard.js — "Kontaktkarte" message type (0.35.0). Sharing a contact now
   sends a structured message (type 'contact') instead of a plain-text blob: the
   card carries the user's avatar, name and @handle, and tapping "Chat starten"
   opens a DM with them. The share modal lets you pick an existing conversation
   partner or search the people directory. Payload rides along in message.contact. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, toast, modal } from './ui.js';
import * as telemetry from './telemetry.js';

/** Modal to share a contact into [chatId]. */
export function shareContactModal(chatId) {
  const note = el('input', { class: 'input', placeholder: 'Notiz (optional)', maxlength: '280' });
  const results = el('div', { class: 'people-results' });
  const err = el('div', { class: 'formerr' });
  let picked = null;

  // Quick-pick row for an existing direct-chat partner.
  function partnerRow(u) {
    return el('button', { class: 'urow', onClick: () => choose(u) }, [
      avatar(u, 42, { kind: 'user' }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: u.displayName }),
        u.username ? el('div', { class: 'usub', text: '@' + u.username }) : null,
      ].filter(Boolean)),
    ]);
  }

  function renderPartners(filter = '') {
    clear(results);
    const f = filter.toLowerCase();
    const partners = store.chatsSorted()
      .filter((c) => c.type === 'direct' && !c.self && c.otherUser)
      .map((c) => c.otherUser)
      .filter((u) => !f || (u.displayName || '').toLowerCase().includes(f)
        || (u.username || '').toLowerCase().includes(f));
    if (!partners.length) { results.append(el('div', { class: 'hint', text: 'Tippe, um Personen zu suchen.' })); return; }
    for (const u of partners.slice(0, 30)) results.append(partnerRow(u));
  }

  // Live people-directory search (debounced), falling back to local partners.
  let t = null, seq = 0;
  const search = el('input', { class: 'input', placeholder: '@name oder Name suchen …',
    autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  search.addEventListener('input', () => {
    const q = search.value.trim();
    clearTimeout(t);
    if (q.replace(/^@+/, '').length < 2) { renderPartners(q); return; }
    const mine = ++seq;
    clear(results); results.append(el('div', { class: 'hint', text: 'Suche …' }));
    t = setTimeout(async () => {
      try {
        const { results: found } = await api.get(`/people/search?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        clear(results);
        if (!found.length) { results.append(el('div', { class: 'hint', text: 'Niemand gefunden.' })); return; }
        for (const u of found) results.append(partnerRow(u));
      } catch (e) { if (mine === seq) { clear(results); results.append(el('div', { class: 'formerr', text: e.message })); } }
    }, 280);
  });

  const sendBtn = el('button', { class: 'btn primary', disabled: true, onClick: send }, [icon('user'), 'Senden']);

  const m = modal({
    title: 'Kontakt teilen',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Kontakt' }), search]),
      results,
      el('div', { class: 'field' }, [el('label', { text: 'Notiz' }), note]),
      err,
    ),
    foot: [sendBtn],
  });
  renderPartners();

  function choose(u) {
    picked = u;
    clear(results).append(el('div', { class: 'contact-picked' }, [
      avatar(u, 48, { kind: 'user' }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: u.displayName }),
        u.username ? el('div', { class: 'usub', text: '@' + u.username }) : null,
      ].filter(Boolean)),
      el('button', { class: 'iconbtn', title: 'Andere Person', onClick: () => { picked = null; sendBtn.disabled = true; search.value = ''; renderPartners(); } }, icon('close', 'sm')),
    ]));
    sendBtn.disabled = false;
  }

  async function send() {
    if (!picked) return;
    err.textContent = '';
    sendBtn.disabled = true;
    try {
      await api.post(`/chats/${chatId}/contact`, { userId: picked.id, note: note.value.trim() });
      telemetry.track('contact_share');
      m.close();
    } catch (e) { err.textContent = e.message || 'Konnte den Kontakt nicht teilen.'; sendBtn.disabled = false; }
  }
}

/** Render the in-chat contact card for message [m]. */
export function renderCard(m) {
  const c = m.contact || {};
  const entity = {
    id: c.userId, displayName: c.displayName,
    avatarColor: c.avatarColor, hasAvatar: c.hasAvatar, avatarVersion: c.avatarVersion,
  };
  const card = el('div', { class: 'contact-card' });
  card.append(el('div', { class: 'contact-main' }, [
    avatar(entity, 52, { kind: 'user', online: c.userId ? store.isOnline(c.userId) : null }),
    el('div', { class: 'contact-meta' }, [
      el('div', { class: 'contact-name', text: c.displayName || 'Kontakt' }),
      c.username ? el('div', { class: 'contact-handle', text: '@' + c.username }) : null,
      c.note ? el('div', { class: 'contact-note', text: c.note }) : null,
    ].filter(Boolean)),
  ]));

  if (c.isUser && c.userId && c.userId !== store.state.me?.id) {
    card.append(el('div', { class: 'contact-actions' }, [
      el('button', { class: 'btn ghost sm', onClick: () => openContactProfile(c.userId) }, [icon('info', 'sm'), 'Profil']),
      el('button', { class: 'btn primary sm', onClick: () => messageContact(c.userId) }, [icon('chat', 'sm'), 'Chat starten']),
    ]));
  } else if (c.userId === store.state.me?.id) {
    card.append(el('div', { class: 'contact-actions' }, el('div', { class: 'hint', text: 'Das bist du.' })));
  }
  return card;
}

async function openContactProfile(userId) {
  try {
    const { user } = await api.get(`/users/${userId}`);
    const c = await import('./contacts.js');
    if (user) c.openProfile(user);
  } catch (e) { toast(e.message || 'Profil nicht verfügbar.', 'err'); }
}

async function messageContact(userId) {
  try {
    const c = await import('./contacts.js');
    await c.startDirect(userId);
  } catch (e) { toast(e.message || 'Konnte den Chat nicht öffnen.', 'err'); }
}
