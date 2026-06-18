/* mentions.js — @-mentions for group chats. Three responsibilities, all pure
   except attachAutocomplete (which only touches the DOM when called):

     • tokenizeMentions() turns a raw message body into a flat list of text /
       mention tokens by longest-match against the chat's member names, so the
       renderer can wrap "@Alice" in a highlight without ever mis-tagging plain
       text. It runs on the RAW body and the caller escapes each token, so it is
       XSS-safe by construction.
     • mentionsUser() answers "was this person @-mentioned?" — used to badge a
       chat and to record an activity entry when *you* are mentioned.
     • attachAutocomplete() wires a member picker onto the composer textarea:
       type "@", get a filterable, keyboard-navigable list of group members.

   Mentions are a pure client concern: a mention is just the literal "@Name" in
   the body, so nothing new is stored server-side. */

import { el, avatar } from './ui.js';

const NAME_BOUNDARY = /[\p{L}\p{N}_]/u; // a char that would make "@Ann" part of "@Anna"

/** Group members eligible to be mentioned (has an id + display name). */
export function mentionableMembers(chat) {
  if (!chat || chat.type !== 'group') return [];
  return (chat.members || []).filter((m) => m && m.id && m.displayName);
}

/** Split a raw body into [{text} | {mention,name,id,me}] tokens. Longest member
    name wins so "@Anna Lee" is preferred over "@Anna". Single forward pass. */
export function tokenizeMentions(raw, chat, meId) {
  const members = mentionableMembers(chat);
  if (!members.length || !raw) return [{ text: String(raw || '') }];
  const byLen = members.slice().sort((a, b) => b.displayName.length - a.displayName.length);
  const out = [];
  let buf = '';
  let i = 0;
  const s = String(raw);
  while (i < s.length) {
    if (s[i] === '@') {
      let hit = null;
      for (const m of byLen) {
        const name = m.displayName;
        if (s.startsWith(name, i + 1)) {
          const after = s[i + 1 + name.length];
          // Reject partial matches: "@Anna" must not be the prefix of "@Annabel".
          if (after === undefined || !NAME_BOUNDARY.test(after)) { hit = m; break; }
        }
      }
      if (hit) {
        if (buf) { out.push({ text: buf }); buf = ''; }
        out.push({ mention: true, name: hit.displayName, id: hit.id, me: hit.id === meId });
        i += 1 + hit.displayName.length;
        continue;
      }
    }
    buf += s[i];
    i += 1;
  }
  if (buf) out.push({ text: buf });
  return out;
}

/** True if `userId` is @-mentioned in `body` within the given group chat. */
export function mentionsUser(body, chat, userId) {
  if (!body || !userId) return false;
  return tokenizeMentions(body, chat, userId).some((t) => t.mention && t.id === userId);
}

/** Find the @-query the caret is currently inside, e.g. typing "hi @al|".
    Returns { query, start } or null. Only triggers after whitespace or at the
    very start, so an email address never opens the picker. */
export function parseActiveMention(value, caret) {
  const upto = String(value || '').slice(0, caret);
  const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
  if (!m) return null;
  return { query: m[1], start: caret - m[1].length - 1 };
}

/** Members matching a query (case-insensitive; prefix matches rank first). */
export function filterMembers(chat, query, excludeId) {
  const q = String(query || '').toLowerCase();
  const list = mentionableMembers(chat).filter((m) => m.id !== excludeId);
  const scored = list
    .map((m) => {
      const name = m.displayName.toLowerCase();
      if (!q) return { m, rank: 1 };
      if (name.startsWith(q)) return { m, rank: 0 };
      if (name.includes(q)) return { m, rank: 1 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.m.displayName.localeCompare(b.m.displayName));
  return scored.map((x) => x.m).slice(0, 8);
}

/* ---- composer autocomplete ------------------------------------------------
   Attaches to a textarea. getChat() is read lazily on every keystroke so the
   picker always reflects the live member list (members can join mid-session).
   Returns a teardown function. */
export function attachAutocomplete(ta, getChat, { meId, anchor } = {}) {
  let pop = null;
  let items = [];
  let active = 0;
  let region = null; // { start } of the @query being completed

  const close = () => { if (pop) { pop.remove(); pop = null; } items = []; region = null; };

  const choose = (member) => {
    if (!region) return;
    const before = ta.value.slice(0, region.start);
    const after = ta.value.slice(ta.selectionStart ?? ta.value.length);
    const insert = '@' + member.displayName + ' ';
    ta.value = before + insert + after;
    const pos = before.length + insert.length;
    ta.selectionStart = ta.selectionEnd = pos;
    close();
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  };

  const render = () => {
    if (!pop) {
      pop = el('div', { class: 'mention-pop', role: 'listbox', 'aria-label': 'Mitglied erwähnen' });
      (anchor || ta.parentNode || document.body).appendChild(pop);
    }
    pop.replaceChildren(...items.map((m, idx) => {
      const row = el('button', {
        class: `mention-opt ${idx === active ? 'active' : ''}`,
        role: 'option', 'aria-selected': idx === active ? 'true' : 'false',
        type: 'button',
        // mousedown (not click) so the textarea doesn't blur before we insert.
        onMousedown: (e) => { e.preventDefault(); choose(m); },
      }, [avatar(m, 26, { kind: 'user' }), el('span', { class: 'mention-name', text: m.displayName })]);
      return row;
    }));
  };

  const refresh = () => {
    const chat = getChat();
    if (!chat || chat.type !== 'group') return close();
    const caret = ta.selectionStart ?? ta.value.length;
    const found = parseActiveMention(ta.value, caret);
    if (!found) return close();
    items = filterMembers(chat, found.query, meId);
    if (!items.length) return close();
    region = { start: found.start };
    active = Math.min(active, items.length - 1);
    render();
  };

  const onInput = () => refresh();
  const onKeydown = (e) => {
    if (!pop || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  ta.addEventListener('input', onInput);
  // Capture phase so we intercept Enter before the composer's "send" handler.
  ta.addEventListener('keydown', onKeydown, true);
  ta.addEventListener('blur', () => setTimeout(close, 120));

  return () => {
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('keydown', onKeydown, true);
    close();
  };
}

/** Is the mention picker currently open? (so the composer's Enter handler can
    yield to it). Only one picker exists at a time, so a document query is fine
    and avoids depending on where the popup was anchored. */
export function pickerOpen() {
  return !!(typeof document !== 'undefined' && document.querySelector?.('.mention-pop'));
}
