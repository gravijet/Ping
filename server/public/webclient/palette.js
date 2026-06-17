/* palette.js — the command palette (Ctrl/⌘K). One fast, searchable surface that
   replaces hunting through menus: jump to any chat and run the common actions
   (new chat/group, settings, theme, lock, linked devices, search) from one box.
   app.js owns the action list and passes it in, so this module stays dependency-
   light and never imports the views it launches. */

import * as store from './store.js';
import { el, clear, icon, avatar } from './ui.js';

let back = null; // the open overlay, if any

function peerOf(chat) {
  return chat.otherUser || { id: chat.id, displayName: chat.title, avatarColor: chat.avatarColor };
}

// open({ commands:[{group,title,sub,icon,hint,keywords,run}], onOpenChat(id) })
export function openPalette({ commands = [], onOpenChat } = {}) {
  if (back) return; // already open
  let q = '';
  let rows = [];     // flat list of selectable entries {type, ...}
  let sel = 0;

  const input = el('input', {
    type: 'text', placeholder: 'Suchen oder Aktion ausführen …',
    autocomplete: 'off', spellcheck: 'false',
    oninput: (e) => { q = e.target.value; render(); },
  });
  const list = el('div', { class: 'palette-list' });
  const box = el('div', { class: 'palette' }, [
    el('div', { class: 'palette-input' }, [icon('search'), input]),
    list,
  ]);
  back = el('div', { class: 'palette-back', onClick: (e) => { if (e.target === back) close(); } }, box);
  document.getElementById('modal-root').appendChild(back);
  input.focus();

  function close() {
    if (!back) return;
    back.remove(); back = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function matchedChats() {
    const needle = q.trim().toLowerCase();
    const all = store.chatsSorted();
    const hits = needle
      ? all.filter((c) => ((c.self ? 'notiz an mich gespeichert' : c.title) || '').toLowerCase().includes(needle))
      : all.slice(0, 6);
    return hits.slice(0, 8);
  }
  function matchedCommands() {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) =>
      (c.title + ' ' + (c.keywords || '') + ' ' + (c.sub || '')).toLowerCase().includes(needle));
  }

  function render() {
    clear(list);
    rows = [];
    const chats = matchedChats();
    const cmds = matchedCommands();

    if (chats.length) {
      list.appendChild(el('div', { class: 'palette-group', text: q ? 'Chats' : 'Zuletzt' }));
      for (const c of chats) {
        const peer = c.type === 'direct' ? peerOf(c) : { id: c.id, title: c.title, avatarColor: c.avatarColor, hasAvatar: c.hasAvatar, avatarVersion: c.avatarVersion };
        const node = el('div', { class: 'palette-item', onClick: () => run({ type: 'chat', id: c.id }) }, [
          avatar(peer, 30, { kind: c.type === 'direct' ? 'user' : 'chat' }),
          el('div', { class: 'pi-main' }, [
            el('div', { class: 'pi-title', text: c.self ? 'Notiz an mich' : c.title }),
          ]),
        ]);
        rows.push({ node, action: { type: 'chat', id: c.id } });
        list.appendChild(node);
      }
    }

    if (cmds.length) {
      list.appendChild(el('div', { class: 'palette-group', text: 'Aktionen' }));
      for (const cmd of cmds) {
        const node = el('div', { class: 'palette-item', onClick: () => run({ type: 'cmd', cmd }) }, [
          icon(cmd.icon || 'bolt'),
          el('div', { class: 'pi-main' }, [
            el('div', { class: 'pi-title', text: cmd.title }),
            cmd.sub ? el('div', { class: 'pi-sub', text: cmd.sub }) : null,
          ].filter(Boolean)),
          cmd.hint ? el('span', { class: 'pi-hint', text: cmd.hint }) : null,
        ].filter(Boolean));
        rows.push({ node, action: { type: 'cmd', cmd } });
        list.appendChild(node);
      }
    }

    if (!rows.length) {
      list.appendChild(el('div', { class: 'chatlist-empty', text: 'Nichts gefunden.' }));
    }
    sel = 0;
    paintSel();
  }

  function paintSel() {
    rows.forEach((r, i) => r.node.classList.toggle('sel', i === sel));
    rows[sel]?.node.scrollIntoView({ block: 'nearest' });
  }

  function run(action) {
    close();
    if (action.type === 'chat') onOpenChat?.(action.id);
    else action.cmd.run?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, rows.length - 1); paintSel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paintSel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) run(rows[sel].action); return; }
  }
  document.addEventListener('keydown', onKey, true);
  render();
}

export function paletteOpen() { return !!back; }
