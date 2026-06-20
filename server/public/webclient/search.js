/* search.js — global full-text message search ("Finden & Fokus", 0.30.0).

   A dedicated search surface over GET /api/messages/search (FTS5-backed on the
   server). Beyond free text it understands filter operators — typed inline or
   added with the quick chips:
     von:<name>   typ:foto|video|datei|…   nach:YYYY-MM-DD   vor:YYYY-MM-DD
   Results are debounced, show skeletons while loading, group nothing (a flat,
   newest-first list reads best for search), highlight the matched terms, and
   jump straight to the message in its chat on click.

   Gated by the `messageSearch` feature flag (see flags.js). */

import { api } from './api.js';
import { el, clear, icon, modal, chatTime } from './ui.js';

let activeModal = null;

// Quick type chips → the operator token they toggle into the query.
const TYPE_CHIPS = [
  ['Fotos', 'typ:foto'],
  ['Videos', 'typ:video'],
  ['Dateien', 'typ:datei'],
  ['Sprache', 'typ:sprache'],
  ['Umfragen', 'typ:umfrage'],
];

// Pull the free-text terms out of a raw query (drop operator:value tokens) so we
// can highlight just the words the user actually searched for.
function freeTerms(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/^[a-zA-ZäöüÄÖÜ]+:/.test(t))
    .filter((t) => t.length >= 2);
}

// Build a fragment where every occurrence of any term is wrapped in <mark>.
// HTML-escaping happens via textContent on the surrounding spans, so this is
// XSS-safe even though the message body is arbitrary user text.
function highlight(text, terms) {
  const frag = document.createDocumentFragment();
  const src = String(text || '');
  if (!terms.length) { frag.append(document.createTextNode(src)); return frag; }
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) frag.append(document.createTextNode(src.slice(last, m.index)));
    frag.append(el('mark', { text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < src.length) frag.append(document.createTextNode(src.slice(last)));
  return frag;
}

function typeGlyph(type) {
  return { image: '📷', video: '🎬', voice: '🎤', audio: '🎵', gif: 'GIF', file: '📎', poll: '📊', location: '📍' }[type] || '';
}

function skeletonRows(n = 5) {
  const wrap = el('div', { class: 'search-skeletons' });
  for (let i = 0; i < n; i++) {
    wrap.append(el('div', { class: 'search-skel' }, [
      el('div', { class: 'sk-line sk-1' }),
      el('div', { class: 'sk-line sk-2' }),
    ]));
  }
  return wrap;
}

/**
 * Open the global search view. [onOpenChat] is app.js's openChatInShell so a
 * result can jump to (chatId, messageId).
 */
export function openSearch(onOpenChat, initialQuery = '') {
  if (activeModal) { try { activeModal.close(); } catch { /* already gone */ } }

  const input = el('input', {
    class: 'input search-input', type: 'search', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Nachrichten durchsuchen …', value: initialQuery,
    'aria-label': 'Nachrichten durchsuchen',
  });
  const chips = el('div', { class: 'search-chips' },
    TYPE_CHIPS.map(([label, token]) =>
      el('button', { class: 'chip', onClick: () => addToken(token) }, label)));
  const status = el('div', { class: 'search-status', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'search-results' });

  const m = modal({
    title: 'Suche',
    width: '560px',
    body: (b) => b.append(
      el('div', { class: 'search-bar' }, [icon('search', 'sm'), input]),
      chips,
      el('div', { class: 'search-hint hint',
        text: 'Filter: von:name · typ:foto · nach:2026-01-01 · vor:2026-12-31' }),
      status,
      results,
    ),
    onClose: () => { activeModal = null; },
  });
  activeModal = m;

  // Append an operator token (from a chip) without duplicating it.
  function addToken(token) {
    const cur = input.value.trim();
    const key = token.split(':')[0] + ':';
    // Replace any existing token with the same key, else append.
    const parts = cur.split(/\s+/).filter(Boolean).filter((p) => !p.startsWith(key));
    input.value = (parts.concat(token).join(' ') + ' ').replace(/\s+/g, ' ');
    input.focus();
    run();
  }

  let timer = null;
  let reqId = 0;
  function run() {
    clearTimeout(timer);
    timer = setTimeout(doSearch, 220);
  }

  async function doSearch() {
    const q = input.value.trim();
    const id = ++reqId;
    if (q.length < 2) {
      clear(status);
      clear(results).append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-emoji', text: '🔎' }),
        el('div', { class: 'hint', text: 'Tippe, um deinen Chats nach Nachrichten zu durchsuchen.' }),
      ]));
      return;
    }
    clear(status);
    clear(results).append(skeletonRows());
    let messages = [];
    try {
      messages = (await api.get('/messages/search?q=' + encodeURIComponent(q))).messages || [];
    } catch (e) {
      if (id !== reqId) return;
      clear(results).append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-emoji', text: '⚠️' }),
        el('div', { class: 'hint', text: e.message || 'Suche fehlgeschlagen. Bist du offline?' }),
      ]));
      return;
    }
    if (id !== reqId) return; // a newer keystroke already superseded this request
    paint(messages, q);
  }

  function paint(messages, q) {
    const terms = freeTerms(q);
    status.textContent = messages.length
      ? `${messages.length} ${messages.length === 1 ? 'Treffer' : 'Treffer'}`
      : '';
    clear(results);
    if (!messages.length) {
      results.append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-emoji', text: '🫥' }),
        el('div', { class: 'hint', text: 'Keine Nachrichten gefunden. Andere Begriffe oder Filter versuchen?' }),
      ]));
      return;
    }
    for (const msg of messages) {
      const text = (msg.snippet || msg.body || '').trim() || (typeGlyph(msg.type) + ' ' + msg.type);
      const row = el('button', { class: 'search-result',
        onClick: () => { m.close(); onOpenChat && onOpenChat(msg.chatId, msg.id); } }, [
        el('div', { class: 'sr-top' }, [
          el('span', { class: 'sr-chat', text: msg.chatTitle || 'Chat' }),
          el('span', { class: 'sr-time', text: chatTime(msg.createdAt) }),
        ]),
        el('div', { class: 'sr-body' }, [
          msg.senderName ? el('span', { class: 'sr-sender', text: msg.senderName + ': ' }) : null,
          (() => { const s = el('span', { class: 'sr-text' }); s.append(highlight(text, terms)); return s; })(),
        ].filter(Boolean)),
      ]);
      results.append(row);
    }
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); doSearch(); }
  });
  setTimeout(() => input.focus(), 0);
  doSearch();
  return m;
}
