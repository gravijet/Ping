/* chats.js — the list pane's chat list. Renders from the store and re-renders on
   chat/presence/typing/prefs changes. Pinned chats float to the top; archived
   chats live in a collapsible section; per-row right-click (or the ⋯ button)
   opens quick actions. Search filters by title and dips into archived too. */

import { api } from './api.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, chatTime, openMenu, toast, confirmModal } from './ui.js';
import { messagePreview } from './format.js';

let archiveOpen = false;

export function renderChatList(container, onSelect) {
  const draw = () => paint(container, onSelect);
  // Subscribe once per container; the store keeps a Set so re-subscribing on a
  // fresh render is cheap and the old closures are GC'd with the old container.
  store.on('chats', draw);
  store.on('presence', draw);
  store.on('typing', draw);
  store.on('prefs', draw);
  draw();
}

function directPeer(chat) {
  return chat.otherUser ||
    { id: chat.id, displayName: chat.title, avatarColor: chat.avatarColor };
}

function sortChats(list) {
  const pinned = prefs.get('pinned') || [];
  return list.sort((a, b) => {
    const pa = pinned.indexOf(a.id), pb = pinned.indexOf(b.id);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

function passesFilter(c) {
  switch (store.state.chatFilter) {
    case 'unread': return !!(c.unread || prefs.isMarkedUnread(c.id));
    case 'fav': return prefs.isPinned(c.id);
    case 'groups': return c.type === 'group';
    default: return true;
  }
}

function paint(container, onSelect) {
  clear(container);
  const all = store.chatsSorted();
  const q = store.state.search.trim().toLowerCase();
  const filtering = store.state.chatFilter !== 'all';
  const match = (c) => (!q || (c.title || '').toLowerCase().includes(q)) && passesFilter(c);

  const active = sortChats(all.filter((c) => !c.archived && match(c)));
  // Archived chats only surface in the unfiltered "Alle" view (or via search).
  const archived = filtering ? [] : sortChats(all.filter((c) => c.archived && match(c)));

  if (!active.length && !archived.length && !q) {
    container.appendChild(el('div', { class: 'chatlist-empty',
      text: filtering ? 'Keine Chats in diesem Filter.'
        : 'Noch keine Chats. Starte oben rechts einen neuen Chat.' }));
    return;
  }

  for (const chat of active) container.appendChild(row(chat, onSelect));

  if (archived.length) {
    const header = el('button', { class: 'pane-section', style: { width: '100%', cursor: 'pointer' },
      onClick: () => { archiveOpen = !archiveOpen; paint(container, onSelect); } }, [
      icon('archive'), el('span', { text: `Archiviert (${archived.length})` }),
      el('span', { style: { marginLeft: 'auto', transform: archiveOpen ? 'rotate(90deg)' : '' } },
        icon('chevron', 'sm')),
    ]);
    container.appendChild(header);
    if (archiveOpen) for (const chat of archived) container.appendChild(row(chat, onSelect));
  }

  // Full-text message search results, below the chat matches.
  if (q.length >= 2) appendMessageResults(container, q, onSelect);
  else if (!active.length && !archived.length) {
    container.appendChild(el('div', { class: 'chatlist-empty', text: 'Tippe weiter, um Nachrichten zu durchsuchen …' }));
  }
}

let searchSeq = 0;
let msgCache = { q: '', messages: [] };
function appendMessageResults(container, q, onSelect) {
  if (msgCache.q === q) return renderMsgResults(container, msgCache.messages, onSelect);
  const seq = ++searchSeq;
  api.get('/messages/search?q=' + encodeURIComponent(q)).then(({ messages }) => {
    if (seq !== searchSeq) return;
    msgCache = { q, messages: messages || [] };
    if ((store.state.search.trim().toLowerCase()) === q) renderMsgResults(container, msgCache.messages, onSelect);
  }).catch(() => {});
}
function renderMsgResults(container, messages, onSelect) {
  if (!messages.length) return;
  container.appendChild(el('div', { class: 'pane-section' }, [icon('search'), el('span', { text: 'Nachrichten' })]));
  for (const m of messages.slice(0, 30)) {
    const chat = store.getChat(m.chatId);
    container.appendChild(el('button', { class: 'urow', onClick: () => onSelect(m.chatId) }, [
      el('div', { class: 'set-ic', style: { width: '48px', height: '48px', borderRadius: '14px' } }, icon('search')),
      el('div', { class: 'meta' }, [
        el('div', { class: 'uname', text: messagePreview(m) }),
        el('div', { class: 'uabout', text: `${chat?.title || 'Chat'} · ${chatTime(m.createdAt)}` }),
      ]),
    ]));
  }
}

function row(chat, onSelect) {
  const isDirect = chat.type === 'direct';
  const peer = isDirect ? directPeer(chat) : null;
  const online = isDirect && peer.id !== store.state.me?.id && store.isOnline(peer.id);
  const av = isDirect
    ? avatar(peer, 48, { online, kind: 'user' })
    : avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
        hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 48, { kind: 'chat' });

  const typing = store.typingUsers(chat.id).filter((u) => u !== store.state.me?.id);
  const preview = el('div', { class: 'preview' });
  if (typing.length) {
    preview.classList.add('typing');
    preview.style.color = 'var(--accent)';
    preview.textContent = 'tippt …';
  } else {
    fillPreview(preview, chat);
  }

  const unreadCue = chat.unread || prefs.isMarkedUnread(chat.id);
  // Visible quick-actions button (hover on desktop, always tappable on touch) so
  // pin / mute / archive aren't hidden behind a right-click only.
  const menuBtn = el('button', { class: 'iconbtn row-menu', title: 'Aktionen',
    onClick: (e) => { e.stopPropagation(); rowMenu(e, chat); } }, icon('menu'));
  const node = el('div', {
    class: `chatrow ${unreadCue ? 'unread' : ''} ${store.state.activeId === chat.id ? 'active' : ''}`,
    onClick: () => onSelect(chat.id),
    oncontextmenu: (e) => rowMenu(e, chat),
  }, [
    av,
    el('div', { class: 'meta' }, [
      el('div', { class: 'top' }, [
        el('span', { class: 'title', text: chat.self ? 'Notiz an mich' : chat.title }),
        el('span', { class: 'time', text: chatTime(chat.updatedAt) }),
      ]),
      el('div', { class: 'bottom' }, [
        preview,
        prefs.isPinned(chat.id) ? icon('pin', 'sm pin-ico') : null,
        chat.muted ? icon('mute', 'sm muted-ico') : null,
        chat.unread ? el('span', { class: 'badge', text: String(chat.unread) })
          : (prefs.isMarkedUnread(chat.id) ? el('span', { class: 'badge', text: ' ' }) : null),
      ]),
    ]),
    menuBtn,
  ]);
  return node;
}

function rowMenu(e, chat) {
  const pinned = prefs.isPinned(chat.id);
  const unread = chat.unread || prefs.isMarkedUnread(chat.id);
  openMenu(e, [
    { label: pinned ? 'Lösen' : 'Anheften', icon: 'pin',
      onClick: () => { prefs.togglePin(chat.id); store.emit('chats'); } },
    { label: unread ? 'Als gelesen' : 'Als ungelesen', icon: 'chat',
      onClick: () => { prefs.setMarkedUnread(chat.id, !unread); store.emit('chats'); } },
    { label: chat.muted ? 'Stummschaltung aus' : 'Stummschalten', icon: 'mute',
      onClick: () => toggleMute(chat) },
    { label: chat.archived ? 'Aus Archiv' : 'Archivieren', icon: 'archive',
      onClick: () => toggleArchive(chat) },
    { sep: true },
    { label: 'Verlassen / Löschen', icon: 'trash', danger: true,
      onClick: () => leaveOrDelete(chat) },
  ]);
}

async function toggleMute(chat) {
  try { await api.post(`/chats/${chat.id}/mute`, { muted: !chat.muted });
    chat.muted = !chat.muted; store.emit('chats'); } catch (e) { toast(e.message, 'err'); }
}
async function toggleArchive(chat) {
  try { await api.post(`/chats/${chat.id}/archive`, { archived: !chat.archived });
    chat.archived = !chat.archived; store.emit('chats'); } catch (e) { toast(e.message, 'err'); }
}
async function leaveOrDelete(chat) {
  if (chat.type === 'group') {
    return import('./groups.js').then((m) => m.leaveGroup(chat.id));
  }
  if (!await confirmModal({ title: 'Chat löschen',
    message: 'Diesen Chat aus deiner Liste entfernen?', confirmText: 'Entfernen', danger: true })) return;
  try {
    await api.post(`/chats/${chat.id}/leave`).catch(() => {});
    store.state.chats.delete(chat.id);
    store.state.messages.delete(chat.id);
    if (store.state.activeId === chat.id) { store.state.activeId = null; store.emit('open-splash'); }
    store.emit('chats');
  } catch (e) { toast(e.message, 'err'); }
}

function fillPreview(node, chat) {
  const m = chat.lastMessage;
  if (!m) { node.textContent = chat.type === 'group' ? 'Gruppe erstellt' : 'Sag Hallo 👋';
    node.style.color = 'var(--faint)'; return; }
  const mine = m.senderId === store.state.me?.id;
  if (mine && m.type !== 'system' && !m.deleted) {
    const tick = el('span', { class: `tick ${m.status === 'read' ? 'read' : ''}` },
      icon(m.status === 'sent' ? 'check' : 'doublecheck', 'sm'));
    node.appendChild(tick);
  }
  if (m.type !== 'system') {
    if (mine) node.appendChild(el('span', { class: 'you', text: 'Du: ' }));
    else if (chat.type === 'group') {
      const member = chat.members?.find((u) => u.id === m.senderId);
      if (member) node.appendChild(el('span', { class: 'you',
        text: member.displayName.split(' ')[0] + ': ' }));
    }
  }
  node.appendChild(document.createTextNode(messagePreview(m)));
}
