/* channels.js — public, discoverable broadcast channels ("Gemeinschaft", 0.31.0).

   A channel is a one-to-many feed: anyone can browse the directory, follow a
   channel by its @handle, read its posts and react — but only the owner posts.
   On the server a channel is a public broadcast group, so once you've followed
   one it behaves like any other chat (history, reactions, pins, search, push).

   This module owns the "Entdecken" directory pane, the create-channel dialog,
   the pre-join preview card, and the /?c=<handle> deep-link handler.

   Gated by the `communities` feature flag (see flags.js). */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, modal, toast, avatar } from './ui.js';
import { skeletonChatList } from './skeleton.js';

// Mirrors the server's CHANNEL_CATEGORIES (validation.js). Keep in sync.
export const CATEGORIES = [
  'Nachrichten', 'Technik', 'Unterhaltung', 'Sport',
  'Bildung', 'Community', 'Kunst', 'Sonstiges',
];

// ---- directory pane --------------------------------------------------------

let state = { q: '', category: '', loading: false, channels: [] };
let debounce = null;

/** Render the "Entdecken" section into the side pane (head + scrollable body). */
export async function renderDiscoverPane(head, body, openChat) {
  head.append(
    el('div', { class: 'pane-title', text: 'Entdecken' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'iconbtn', title: 'Kanal erstellen', 'aria-label': 'Kanal erstellen',
        onClick: () => createChannelModal(openChat) }, icon('plus')),
    ]),
  );

  const searchInput = el('input', {
    type: 'search', placeholder: 'Kanäle suchen …', value: state.q,
    'aria-label': 'Kanäle suchen',
    oninput: (e) => { state.q = e.target.value; scheduleReload(list, openChat); },
  });
  const search = el('div', { class: 'search' }, [
    el('div', { class: 'search-box' }, [icon('search', 'sm'), searchInput]),
  ]);

  const chips = el('div', { class: 'cat-chips', role: 'tablist', 'aria-label': 'Kategorien' });
  const renderChips = () => {
    clear(chips);
    const mk = (label, value) => el('button', {
      class: `cat-chip ${state.category === value ? 'active' : ''}`,
      role: 'tab', 'aria-selected': String(state.category === value),
      onClick: () => { state.category = value; renderChips(); reload(list, openChat); },
    }, label);
    chips.append(mk('Alle', ''));
    for (const c of CATEGORIES) chips.append(mk(c, c));
  };
  renderChips();

  const list = el('div', { class: 'channel-list', id: 'channel-list' });
  body.append(search, chips, list);
  await reload(list, openChat);
}

function scheduleReload(list, openChat) {
  clearTimeout(debounce);
  debounce = setTimeout(() => reload(list, openChat), 220);
}

async function reload(list, openChat) {
  state.loading = true;
  clear(list).append(skeletonChatList(6));
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.category) params.set('category', state.category);
  try {
    const { channels } = await api.get('/channels' + (params.toString() ? `?${params}` : ''));
    state.channels = channels || [];
    state.loading = false;
    paint(list, openChat);
  } catch (e) {
    state.loading = false;
    clear(list).append(el('div', { class: 'pane-empty' }, [
      el('div', { text: 'Verzeichnis nicht erreichbar.' }),
      el('button', { class: 'btn', style: { marginTop: '10px' },
        onClick: () => reload(list, openChat) }, 'Erneut versuchen'),
    ]));
  }
}

function paint(list, openChat) {
  clear(list);
  if (!state.channels.length) {
    list.append(el('div', { class: 'pane-empty' }, [
      el('div', { class: 'pane-empty-ic' }, icon('compass')),
      el('div', { text: state.q || state.category
        ? 'Keine Kanäle gefunden.'
        : 'Noch keine Kanäle. Erstelle den ersten!' }),
      el('button', { class: 'btn primary', style: { marginTop: '12px' },
        onClick: () => createChannelModal(openChat) }, [icon('plus'), 'Kanal erstellen']),
    ]));
    return;
  }
  for (const c of state.channels) list.append(directoryRow(c, openChat));
}

function directoryRow(c, openChat) {
  const av = avatar(
    { id: c.id, title: c.title, avatarColor: c.avatarColor, hasAvatar: c.hasAvatar, avatarVersion: c.avatarVersion },
    48, { kind: 'chat' }
  );
  const meta = el('div', { class: 'channel-meta' }, [
    el('div', { class: 'channel-name' }, [
      el('span', { text: c.title }),
      icon('megaphone', 'sm channel-badge'),
    ]),
    el('div', { class: 'channel-handle', text: `@${c.handle} · ${subLabel(c.subscriberCount)}` }),
    c.description ? el('div', { class: 'channel-desc', text: c.description }) : null,
  ].filter(Boolean));
  const action = c.joined
    ? el('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); openChat(c.id); } }, 'Öffnen')
    : el('button', { class: 'btn sm primary', onClick: (e) => { e.stopPropagation(); follow(c, openChat, action); } }, 'Folgen');

  return el('div', { class: 'channel-row clickable', role: 'button', tabindex: '0',
    onClick: () => previewChannel(c.handle, openChat),
    onKeydown: (e) => { if (e.key === 'Enter') previewChannel(c.handle, openChat); } },
    [av, meta, action]);
}

function subLabel(n) {
  const v = n || 0;
  return v === 1 ? '1 Abonnent' : `${v.toLocaleString('de-DE')} Abonnenten`;
}

// ---- follow / join ---------------------------------------------------------

async function follow(card, openChat, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const { chat } = await api.post(`/channels/${card.handle}/join`, {});
    store.upsertChat(chat);
    card.joined = true;
    toast('Du folgst jetzt diesem Kanal.', 'ok');
    openChat(chat.id);
  } catch (e) {
    toast(e.message || 'Folgen fehlgeschlagen.', 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Folgen'; }
  }
}

// ---- preview (pre-join card / deep link) -----------------------------------

/** Open the preview card for a channel handle; used by directory taps + links. */
export async function previewChannel(handle, openChat) {
  const mdl = modal({
    title: 'Kanal',
    body: (b) => b.append(el('div', { class: 'pane-empty', text: 'Lade …' })),
  });
  try {
    const { channel } = await api.get(`/channels/${encodeURIComponent(handle)}`);
    clear(mdl.body);
    const primary = channel.joined
      ? el('button', { class: 'btn primary', onClick: () => { mdl.close(); openChat(channel.id); } },
          [icon('chat'), 'Öffnen'])
      : el('button', { class: 'btn primary', onClick: async () => {
          primary.disabled = true; primary.textContent = '…';
          try {
            const { chat } = await api.post(`/channels/${channel.handle}/join`, {});
            store.upsertChat(chat); mdl.close(); openChat(chat.id);
          } catch (e) { toast(e.message, 'err'); primary.disabled = false; primary.textContent = 'Folgen'; }
        } }, [icon('plus'), 'Folgen']);
    mdl.body.append(
      channelHero(channel),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', onClick: () => copyChannelLink(channel.handle) }, [icon('link'), 'Link']),
        primary,
      ]),
    );
  } catch (e) {
    clear(mdl.body);
    mdl.body.append(el('div', { class: 'formerr', text: e.status === 404 ? 'Diesen Kanal gibt es nicht.' : (e.message || 'Fehler') }));
  }
}

function channelHero(c) {
  return el('div', { class: 'channel-hero' }, [
    avatar({ id: c.id, title: c.title, avatarColor: c.avatarColor, hasAvatar: c.hasAvatar, avatarVersion: c.avatarVersion },
      72, { kind: 'chat' }),
    el('div', { class: 'channel-hero-name' }, [
      el('span', { text: c.title }),
      icon('megaphone', 'sm channel-badge'),
    ]),
    el('div', { class: 'channel-handle', text: `@${c.handle}` }),
    el('div', { class: 'channel-hero-stats', text:
      `${subLabel(c.subscriberCount)}${c.category ? ' · ' + c.category : ''}${c.owner ? ' · von ' + c.owner.displayName : ''}` }),
    c.description ? el('div', { class: 'channel-hero-desc', text: c.description }) : null,
  ].filter(Boolean));
}

function copyChannelLink(handle) {
  const url = `${location.origin}/webclient/?c=${encodeURIComponent(handle)}`;
  navigator.clipboard?.writeText(url)
    .then(() => toast('Link kopiert.', 'ok'))
    .catch(() => toast(url));
}

// ---- create ----------------------------------------------------------------

export function createChannelModal(openChat) {
  let handleOk = false;
  const err = el('div', { class: 'formerr', hidden: true });
  const name = el('input', { type: 'text', maxlength: '40', placeholder: 'z. B. Ping News' });
  const handle = el('input', { type: 'text', maxlength: '30', placeholder: 'ping-news', autocapitalize: 'none', spellcheck: 'false' });
  const handleHint = el('div', { class: 'field-hint', text: '3–30 Zeichen: a–z, 0–9, „-", „_"' });
  const desc = el('textarea', { rows: '2', maxlength: '280', placeholder: 'Worum geht es? (optional)' });
  const cat = el('select', {}, [
    el('option', { value: '', text: 'Kategorie wählen (optional)' }),
    ...CATEGORIES.map((c) => el('option', { value: c, text: c })),
  ]);

  // Live handle availability check (debounced) for instant feedback.
  let checkTimer = null;
  handle.addEventListener('input', () => {
    handle.value = handle.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const v = handle.value;
    handleOk = false;
    clearTimeout(checkTimer);
    if (!/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(v)) {
      handleHint.textContent = '3–30 Zeichen: a–z, 0–9, „-", „_"';
      handleHint.className = 'field-hint';
      return;
    }
    handleHint.textContent = 'Prüfe Verfügbarkeit …';
    handleHint.className = 'field-hint';
    checkTimer = setTimeout(async () => {
      try {
        await api.get(`/channels/${v}`);
        handleHint.textContent = `@${v} ist leider schon vergeben.`;
        handleHint.className = 'field-hint err';
      } catch (e) {
        if (e.status === 404) { handleOk = true; handleHint.textContent = `@${v} ist frei ✓`; handleHint.className = 'field-hint ok'; }
        else { handleHint.textContent = ''; }
      }
    }, 300);
  });

  const submit = el('button', { class: 'btn primary', onClick: create }, [icon('megaphone'), 'Kanal erstellen']);
  const m = modal({
    title: 'Kanal erstellen',
    body: (b) => b.append(el('div', { class: 'form' }, [
      field('Name', name),
      field('Handle', el('div', { class: 'handle-input' }, [el('span', { text: '@' }), handle])),
      handleHint,
      field('Beschreibung', desc),
      field('Kategorie', cat),
      err,
    ])),
    foot: [submit],
  });
  setTimeout(() => name.focus(), 0);

  async function create() {
    err.hidden = true;
    const body = {
      name: name.value.trim(),
      handle: handle.value.trim(),
      description: desc.value.trim() || undefined,
      category: cat.value || undefined,
    };
    if (!body.name) { showErr('Bitte gib dem Kanal einen Namen.'); name.focus(); return; }
    if (!/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(body.handle)) {
      showErr('Bitte wähle einen gültigen Handle (3–30 Zeichen).'); handle.focus(); return;
    }
    submit.disabled = true; submit.textContent = 'Erstelle …';
    try {
      const { chat } = await api.post('/channels', body);
      store.upsertChat(chat);
      m.close();
      toast('Kanal erstellt 🎉', 'ok');
      openChat(chat.id);
    } catch (e) {
      submit.disabled = false; submit.textContent = 'Kanal erstellen';
      showErr(e.status === 409 ? 'Dieser Handle ist schon vergeben.' : (e.message || 'Erstellen fehlgeschlagen.'));
    }
  }
  function showErr(msg) { err.textContent = msg; err.hidden = false; }
}

function field(label, control) {
  return el('div', { class: 'field' }, [el('label', { text: label }), control]);
}

// ---- owner: edit channel meta ---------------------------------------------

/** Edit dialog for a channel the viewer owns (name/description/category). */
export function editChannelModal(chat) {
  const err = el('div', { class: 'formerr', hidden: true });
  const name = el('input', { type: 'text', maxlength: '40', value: chat.title || '' });
  const desc = el('textarea', { rows: '2', maxlength: '280', value: chat.description || '' });
  const cat = el('select', {}, [
    el('option', { value: '', text: 'Keine' }),
    ...CATEGORIES.map((c) => el('option', { value: c, text: c, selected: c === chat.category })),
  ]);
  const save = el('button', { class: 'btn primary', onClick: doSave }, 'Speichern');
  const m = modal({
    title: 'Kanal bearbeiten',
    body: (b) => b.append(el('div', { class: 'form' }, [
      field('Name', name),
      el('div', { class: 'field-hint', text: `@${chat.handle} · Handle ist fest` }),
      field('Beschreibung', desc),
      field('Kategorie', cat),
      err,
    ])),
    foot: [save],
  });

  async function doSave() {
    err.hidden = true;
    if (!name.value.trim()) { err.textContent = 'Name darf nicht leer sein.'; err.hidden = false; return; }
    save.disabled = true; save.textContent = 'Speichere …';
    try {
      const { chat: updated } = await api.patch(`/channels/${chat.id}`, {
        name: name.value.trim(),
        description: desc.value.trim(),
        category: cat.value,
      });
      Object.assign(chat, updated);
      store.upsertChat(updated);
      m.close();
      toast('Gespeichert.', 'ok');
    } catch (e) {
      save.disabled = false; save.textContent = 'Speichern';
      err.textContent = e.message || 'Speichern fehlgeschlagen.'; err.hidden = false;
    }
  }
}

