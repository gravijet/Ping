/* forward.js — forward a message to one or more chats. Picks targets from the
   existing chat list (multi-select) and re-posts the message's content to each.
   The server has no dedicated forward endpoint, so this re-sends body/attachment
   like a fresh message — interoperable with how the mobile app forwards too. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, modal, toast } from './ui.js';

// Forward a single message (kept for existing call sites).
export function forwardMessage(msg) { forwardMessages([msg]); }

// Forward one or more messages to one or more chats.
export function forwardMessages(msgs) {
  const list = (msgs || []).filter((m) => m && !m.deleted && m.type !== 'system' && m.type !== 'poll');
  if (!list.length) {
    toast('Diese Nachricht(en) können nicht weitergeleitet werden.');
    return;
  }
  const selected = new Set();
  const listWrap = el('div');
  const search = el('input', { class: 'input', placeholder: 'Chats durchsuchen …' });
  const sendBtn = el('button', { class: 'btn primary', onClick: doSend, disabled: 'disabled' },
    [icon('forward'), 'Weiterleiten']);

  const m = modal({
    title: list.length > 1 ? `Weiterleiten (${list.length})` : 'Weiterleiten',
    body: (b) => b.append(
      el('div', { class: 'field' }, search),
      listWrap,
    ),
    foot: [sendBtn],
  });
  search.addEventListener('input', () => paint(search.value.trim().toLowerCase()));
  paint('');
  setTimeout(() => search.focus(), 0);

  function paint(q) {
    clear(listWrap);
    const chats = store.chatsSorted().filter((c) =>
      !q || (c.title || '').toLowerCase().includes(q));
    if (!chats.length) { listWrap.appendChild(el('div', { class: 'pane-empty', text: 'Keine Chats.' })); return; }
    for (const chat of chats) {
      const isDirect = chat.type === 'direct';
      const av = isDirect
        ? avatar(chat.otherUser || { id: chat.id, displayName: chat.title, avatarColor: chat.avatarColor }, 44, { kind: 'user' })
        : avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
            hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 44, { kind: 'chat' });
      const check = el('span', { class: 'badge', style: { borderRadius: '50%', width: '24px', height: '24px',
        background: selected.has(chat.id) ? 'var(--accent)' : 'var(--surface-3)',
        color: '#fff' } }, selected.has(chat.id) ? icon('check', 'sm') : '');
      const rowEl = el('button', { class: 'urow', onClick: () => {
        if (selected.has(chat.id)) selected.delete(chat.id); else selected.add(chat.id);
        sendBtn.disabled = selected.size === 0 ? 'disabled' : null;
        paint(q);
      } }, [
        av,
        el('div', { class: 'meta' }, el('div', { class: 'uname',
          text: chat.self ? 'Notiz an mich' : chat.title })),
        check,
      ]);
      listWrap.appendChild(rowEl);
    }
  }

  async function doSend() {
    if (!selected.size) return;
    sendBtn.disabled = 'disabled'; sendBtn.textContent = 'Senden …';
    let ok = 0;
    for (const chatId of selected) {
      for (const msg of list) {
        const payload = msg.attachment
          ? { type: msg.type || 'file', attachment: stripAttachment(msg.attachment),
              ...(msg.body ? { body: msg.body } : {}) }
          : { body: msg.body || '' };
        try { const r = await api.post(`/chats/${chatId}/messages`, payload);
          store.addMessage(chatId, r.message);
          const c = store.getChat(chatId);
          if (c && r.message) { c.lastMessage = r.message; c.updatedAt = r.message.createdAt; }
          ok += 1;
        } catch (e) { toast(e.message, 'err'); }
      }
    }
    store.emit('chats');
    m.close();
    if (ok) toast(`Weitergeleitet an ${selected.size} Chat${selected.size > 1 ? 's' : ''}.`, 'ok');
  }
}

// Only the fields the server's attachment schema accepts (it .strip()s the rest,
// but keep the wire tidy).
function stripAttachment(a) {
  const out = { url: a.url };
  for (const k of ['kind', 'mime', 'name', 'size', 'width', 'height', 'durationMs']) {
    if (a[k] != null) out[k] = a[k];
  }
  return out;
}
