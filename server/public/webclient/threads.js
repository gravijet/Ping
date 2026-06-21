/* threads.js — "Antwortketten" (0.34.0). A thread is just messages whose
   thread_root points at a root message; they stay out of the main timeline and
   surface here in a side panel. The root carries a live "X Antworten" count
   (message.threadCount) which renders as a chip under its bubble. Mirrors the
   structured-message pattern: no new render type, only a relationship. */

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, icon, avatar, timeOf, modal, toast } from './ui.js';
import { messagePreview } from './format.js';

let open = null; // { chatId, rootId, body, dispose }

/** A "💬 N Antworten" chip for a root message; null when it has no replies. */
export function threadChip(m, chat) {
  const n = m.threadCount || 0;
  if (!n || m.threadRoot) return null;
  return el('button', {
    class: 'thread-chip',
    title: 'Thread öffnen',
    onClick: (e) => { e.stopPropagation(); openThread(chat, m); },
  }, [icon('reply', 'sm'), el('span', { text: `${n} Antwort${n === 1 ? '' : 'en'}` })]);
}

/** Open the thread side-panel for [root] in [chat]. */
export function openThread(chat, root) {
  const chatId = chat?.id || store.state.activeId;
  const list = el('div', { class: 'thread-list' });
  const input = el('input', { class: 'input', placeholder: 'Antworten …', maxlength: '4000' });
  const dlg = modal({
    title: 'Thread',
    width: '480px',
    body: (b) => b.append(
      el('div', { class: 'thread-root' }, [
        el('div', { class: 'tr-name', text: senderName(chat, root.senderId) }),
        el('div', { class: 'tr-body', text: messagePreview(root) }),
      ]),
      list,
    ),
    foot: [
      input,
      el('button', { class: 'btn primary', onClick: send }, [icon('send'), 'Senden']),
    ],
    onClose: () => { if (open?.dispose) open.dispose(); open = null; },
  });
  const dispose = store.on('thread:' + root.id, () => paint());
  open = { chatId, rootId: root.id, body: list, chat, dispose };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  paint();

  async function paint() {
    try {
      const { messages } = await api.get(`/chats/${chatId}/messages/${root.id}/thread`);
      clear(list);
      if (!messages.length) {
        list.append(el('div', { class: 'pane-empty', text: 'Noch keine Antworten. Schreib die erste!' }));
        return;
      }
      for (const m of messages) list.append(threadRow(chat, m));
      list.scrollTop = list.scrollHeight;
    } catch {
      clear(list);
      list.append(el('div', { class: 'pane-empty', text: 'Thread konnte nicht geladen werden.' }));
    }
  }
  async function send() {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try { await api.post(`/chats/${chatId}/messages/${root.id}/thread`, { body }); paint(); }
    catch (e) { toast(e.message || 'Senden fehlgeschlagen.', 'err'); input.value = body; }
  }
}

function threadRow(chat, m) {
  const mine = m.senderId === store.state.me?.id;
  const u = mine ? store.state.me : (chat?.members?.find((x) => x.id === m.senderId) || chat?.otherUser || { displayName: senderName(chat, m.senderId) });
  return el('div', { class: `thread-row ${mine ? 'mine' : ''}` }, [
    avatar(u, 32, { kind: 'user' }),
    el('div', { class: 'tm' }, [
      el('div', { class: 'tm-head' }, [
        el('span', { class: 'tm-name', text: mine ? 'Du' : (u.displayName || 'Unbekannt') }),
        el('span', { class: 'tm-time', text: timeOf(m.createdAt) }),
      ]),
      el('div', { class: 'tm-body', text: messagePreview(m) }),
    ]),
  ]);
}

function senderName(chat, id) {
  if (id === store.state.me?.id) return 'Du';
  return chat?.members?.find((u) => u.id === id)?.displayName
    || chat?.otherUser?.displayName || 'Unbekannt';
}

/** Realtime: a reply arrived for some root — refresh an open matching panel. */
export function onThreadReply(rootId) {
  if (open && open.rootId === rootId) store.emit('thread:' + rootId);
}
