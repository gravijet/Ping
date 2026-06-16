/* chats.js — the left pane chat list. Renders from the store and re-renders on
   chat/presence/typing changes. Filters by the search box and routes clicks to
   openChat. */

import * as store from './store.js';
import { el, clear, icon, avatar, chatTime } from './ui.js';
import { messagePreview } from './format.js';

export function renderChatList(container, onSelect) {
  const draw = () => paint(container, onSelect);
  store.on('chats', draw);
  store.on('presence', draw);
  store.on('typing', draw);
  draw();
}

function directPeer(chat) {
  return chat.otherUser ||
    { id: chat.id, displayName: chat.title, avatarColor: chat.avatarColor };
}

function paint(container, onSelect) {
  clear(container);
  let list = store.chatsSorted();
  const q = store.state.search.trim().toLowerCase();
  if (q) list = list.filter((c) => (c.title || '').toLowerCase().includes(q));

  if (!list.length) {
    container.appendChild(el('div', { class: 'chatlist-empty', text:
      q ? 'Keine Treffer.' : 'Noch keine Chats. Starte oben rechts einen neuen Chat.' }));
    return;
  }

  for (const chat of list) {
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

    const row = el('div', {
      class: `chatrow ${chat.unread ? 'unread' : ''} ${store.state.activeId === chat.id ? 'active' : ''}`,
      onClick: () => onSelect(chat.id),
    }, [
      av,
      el('div', { class: 'meta' }, [
        el('div', { class: 'top' }, [
          el('span', { class: 'title', text: chat.self ? 'Notiz an mich' : chat.title }),
          el('span', { class: 'time', text: chatTime(chat.updatedAt) }),
        ]),
        el('div', { class: 'bottom' }, [
          preview,
          chat.muted ? icon('mute', 'sm muted-ico') : null,
          chat.unread ? el('span', { class: 'badge', text: String(chat.unread) }) : null,
        ]),
      ]),
    ]);
    container.appendChild(row);
  }
}

function fillPreview(node, chat) {
  const m = chat.lastMessage;
  if (!m) { node.textContent = chat.type === 'group' ? 'Gruppe erstellt' : 'Sag Hallo 👋';
    node.style.color = 'var(--faint)'; return; }
  const mine = m.senderId === store.state.me?.id;
  // outgoing tick
  if (mine && m.type !== 'system' && !m.deleted) {
    const tick = el('span', { class: `tick ${m.status === 'read' ? 'read' : ''}` },
      icon(m.status === 'sent' ? 'check' : 'doublecheck', 'sm'));
    node.appendChild(tick);
  }
  // sender prefix
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
