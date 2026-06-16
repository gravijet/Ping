/* chat.js — the conversation pane. Loads history, renders grouped bubbles with
   day separators, drives the composer (text, attachments, reply, edit), and
   reacts to realtime message/typing/receipt/presence updates from the store. */

import { api } from './api.js';
import * as store from './store.js';
import * as socket from './socket.js';
import { el, clear, icon, avatar, timeOf, dayLabel, lastSeenLabel, openMenu,
  confirmModal, toast, escapeHtml } from './ui.js';
import { renderAttachment, sendAttachment, pickFile } from './media.js';
import { messagePreview } from './format.js';
import { startCall } from './calls.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
let cur = null;

export function closeChat() {
  if (cur) { cur.unsubs.forEach((u) => u()); cur = null; }
}

export async function openChat(slot, chatId, { onBack } = {}) {
  closeChat();
  const chat = store.getChat(chatId);
  if (!chat) return;
  cur = { chatId, slot, unsubs: [], replyTo: null, editing: null, typingOn: false };

  const thread = el('div', { class: 'thread', id: 'thread' });
  const composerWrap = el('div', { id: 'composer-wrap' });
  const head = buildHead(chat, onBack);
  clear(slot).append(head, thread, composerWrap);
  cur.thread = thread;
  cur.head = head;
  cur.composerWrap = composerWrap;
  renderComposer();

  // realtime subscriptions
  cur.unsubs.push(store.on('messages:' + chatId, () => renderThread()));
  cur.unsubs.push(store.on('typing:' + chatId, () => updateHeadSub()));
  cur.unsubs.push(store.on('presence', () => updateHeadSub()));
  cur.unsubs.push(store.on('chat:' + chatId, () => { const c = store.getChat(chatId);
    if (c) { clear(head).append(...buildHead(c, onBack).childNodes); } }));

  // load history
  thread.appendChild(el('div', { class: 'daysep', text: 'Lade …' }));
  try {
    const { messages } = await api.get(`/chats/${chatId}/messages?limit=40`);
    store.setHistory(chatId, messages, { all: messages.length < 40 });
  } catch (e) { toast(e.message || 'Nachrichten konnten nicht geladen werden.', 'err'); }
  renderThread(true);
  markRead();

  // infinite scroll up
  thread.addEventListener('scroll', onScroll);
}

function markRead() {
  socket.send('read', { chatId: cur.chatId });
  const chat = store.getChat(cur.chatId);
  if (chat && chat.unread) { chat.unread = 0; store.emit('chats'); }
}

// ---- header ---------------------------------------------------------------
function buildHead(chat, onBack) {
  const isDirect = chat.type === 'direct';
  const peer = isDirect ? (chat.otherUser || { id: chat.id, displayName: chat.title,
    avatarColor: chat.avatarColor }) : null;
  const av = isDirect
    ? avatar(peer, 42, { kind: 'user' })
    : avatar({ id: chat.id, title: chat.title, avatarColor: chat.avatarColor,
        hasAvatar: chat.hasAvatar, avatarVersion: chat.avatarVersion }, 42, { kind: 'chat' });

  const sub = el('div', { class: 'sub', id: 'head-sub' });
  const head = el('div', { class: 'conv-head' }, [
    el('button', { class: 'iconbtn back-only', title: 'Zurück',
      onClick: onBack, style: { display: 'none' } }, icon('back')),
    el('div', { class: 'peer', onClick: () => openChatInfo(chat) }, [
      av,
      el('div', {}, [el('div', { class: 'title', text: chat.self ? 'Notiz an mich' : chat.title }), sub]),
    ]),
    el('div', { class: 'actions' }, isDirect && !chat.self ? [
      el('button', { class: 'iconbtn', title: 'Videoanruf',
        onClick: () => startCall(peer, true) }, icon('video')),
      el('button', { class: 'iconbtn', title: 'Sprachanruf',
        onClick: () => startCall(peer, false) }, icon('phone')),
      el('button', { class: 'iconbtn', title: 'Menü',
        onClick: (e) => chatMenu(e, chat) }, icon('menu')),
    ] : [
      el('button', { class: 'iconbtn', title: 'Menü',
        onClick: (e) => chatMenu(e, chat) }, icon('menu')),
    ]),
  ]);
  if (innerWidth <= 720) head.querySelector('.back-only').style.display = '';
  setTimeout(updateHeadSub, 0);
  return head;
}

function updateHeadSub() {
  if (!cur) return;
  const sub = document.getElementById('head-sub');
  if (!sub) return;
  const chat = store.getChat(cur.chatId);
  if (!chat) return;
  const typing = store.typingUsers(cur.chatId).filter((u) => u !== store.state.me?.id);
  if (typing.length) {
    sub.textContent = 'tippt …'; sub.classList.add('typing'); return;
  }
  sub.classList.remove('typing');
  if (chat.type === 'group') {
    sub.textContent = `${chat.members?.length || chat.memberIds.length} Mitglieder`;
  } else if (chat.self) {
    sub.textContent = 'Nur du';
  } else {
    const id = chat.otherUser?.id;
    if (id && store.isOnline(id)) sub.textContent = 'online';
    else sub.textContent = lastSeenLabel(store.state.lastSeen.get(id)) || 'offline';
  }
}

// ---- thread ---------------------------------------------------------------
function nearBottom(node) { return node.scrollHeight - node.scrollTop - node.clientHeight < 120; }

function renderThread(forceBottom) {
  if (!cur) return;
  const thread = cur.thread;
  const stick = forceBottom || nearBottom(thread);
  const prevH = thread.scrollHeight, prevTop = thread.scrollTop;
  clear(thread);
  const msgs = store.getHistory(cur.chatId);
  if (!msgs.length) {
    thread.appendChild(el('div', { class: 'daysep', text: 'Noch keine Nachrichten' }));
    return;
  }
  let lastDay = '', lastSender = null, lastTs = 0;
  const chat = store.getChat(cur.chatId);
  for (const m of msgs) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) { thread.appendChild(el('div', { class: 'daysep', text: day }));
      lastDay = day; lastSender = null; }
    if (m.type === 'system') {
      thread.appendChild(el('div', { class: 'msg sys' },
        el('div', { class: 'bubble system', text: messagePreview(m) })));
      lastSender = null; continue;
    }
    const grouped = m.senderId === lastSender && (m.createdAt - lastTs) < 5 * 60000;
    thread.appendChild(renderMessage(m, chat, !grouped));
    lastSender = m.senderId; lastTs = m.createdAt;
  }
  if (stick) thread.scrollTop = thread.scrollHeight;
  else thread.scrollTop = prevTop + (thread.scrollHeight - prevH);
}

function renderMessage(m, chat, first) {
  const mine = m.senderId === store.state.me?.id;
  const bubble = el('div', { class: 'bubble', id: 'msg-' + m.id });

  // group sender name (incoming group messages, first of a run)
  if (!mine && chat.type === 'group' && first) {
    const member = chat.members?.find((u) => u.id === m.senderId);
    bubble.appendChild(el('div', { class: 'sender',
      text: member?.displayName || 'Unbekannt' }));
  }

  // reply quote
  if (m.quoted) {
    const q = m.quoted;
    bubble.appendChild(el('div', { class: 'reply-quote',
      onClick: () => scrollToMessage(q.id) }, [
      el('div', { class: 'qname', text: q.senderId === store.state.me?.id ? 'Du'
        : (chat.members?.find((u) => u.id === q.senderId)?.displayName
           || chat.otherUser?.displayName || '') }),
      el('div', { class: 'qbody', text: messagePreview(q) }),
    ]));
  }

  if (m.deleted) {
    bubble.appendChild(el('span', { class: 'deleted', text: '🚫 Diese Nachricht wurde gelöscht' }));
  } else if (m.type === 'poll') {
    bubble.appendChild(renderPoll(m));
  } else {
    if (m.attachment) bubble.appendChild(renderAttachment(m.attachment));
    if (m.body) bubble.appendChild(el('span', { html: linkify(m.body) }));
  }

  // meta (time + edited + ticks)
  if (!m.deleted) {
    const meta = el('span', { class: 'meta' }, [
      m.editedAt ? el('span', { class: 'edited', text: 'bearbeitet · ' }) : null,
      el('span', { text: timeOf(m.createdAt) }),
      mine ? el('span', { class: `tick ${m.status === 'read' ? 'read' : ''}` },
        icon(m.status === 'sent' ? 'check' : 'doublecheck', 'sm')) : null,
    ].filter(Boolean));
    bubble.appendChild(meta);
  }

  // reactions
  const reactWrap = renderReactions(m);

  const wrap = el('div', { class: `msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''}` },
    [bubble, reactWrap].filter(Boolean));
  if (!m.deleted) wrap.appendChild(buildMsgActions(m, mine));
  return wrap;
}

function renderReactions(m) {
  const entries = Object.entries(m.reactions || {}).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return el('div', { class: 'reactions' }, entries.map(([emoji, n]) =>
    el('button', { class: `reaction ${(m.myReactions || []).includes(emoji) ? 'mine' : ''}`,
      onClick: () => toggleReaction(m, emoji) }, `${emoji} ${n}`)));
}

function buildMsgActions(m, mine) {
  return el('div', { class: 'msg-actions' }, [
    el('button', { class: 'iconbtn', title: 'Reagieren',
      onClick: (e) => reactionPicker(e, m) }, icon('react')),
    el('button', { class: 'iconbtn', title: 'Antworten',
      onClick: () => setReply(m) }, icon('reply')),
    el('button', { class: 'iconbtn', title: 'Mehr',
      onClick: (e) => msgMenu(e, m, mine) }, icon('menu')),
  ]);
}

function msgMenu(e, m, mine) {
  openMenu(e, [
    { label: 'Antworten', icon: 'reply', onClick: () => setReply(m) },
    mine && m.type === 'text' && !m.attachment
      ? { label: 'Bearbeiten', icon: 'edit', onClick: () => setEdit(m) } : null,
    { label: 'Kopieren', icon: 'file', onClick: () => {
      navigator.clipboard?.writeText(m.body || '').then(() => toast('Kopiert.')); } },
    mine ? { sep: true } : null,
    mine ? { label: 'Löschen', icon: 'trash', danger: true,
      onClick: () => deleteMessage(m) } : null,
  ].filter(Boolean));
}

function reactionPicker(e, m) {
  openMenu(e, REACTIONS.map((emoji) => ({
    label: emoji, onClick: () => toggleReaction(m, emoji),
  })));
}

async function toggleReaction(m, emoji) {
  try { await api.post(`/chats/${cur.chatId}/messages/${m.id}/reactions`, { emoji }); }
  catch (err) { toast(err.message, 'err'); }
}

async function deleteMessage(m) {
  if (!await confirmModal({ title: 'Nachricht löschen',
    message: 'Diese Nachricht für alle löschen?', confirmText: 'Löschen', danger: true })) return;
  try { await api.del(`/chats/${cur.chatId}/messages/${m.id}`); }
  catch (err) { toast(err.message, 'err'); }
}

function scrollToMessage(id) {
  const node = document.getElementById('msg-' + id);
  if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.style.transition = 'background .3s'; node.style.background = 'var(--accent-soft)';
    setTimeout(() => { node.style.background = ''; }, 800); }
}

// ---- polls ----------------------------------------------------------------
function renderPoll(m) {
  const poll = m.poll || {};
  const total = (poll.options || []).reduce((s, o) => s + (o.votes || 0), 0);
  return el('div', { class: 'poll' }, [
    el('div', { class: 'q', text: poll.question || 'Umfrage' }),
    ...(poll.options || []).map((o, i) => {
      const pct = total ? Math.round((o.votes || 0) / total * 100) : 0;
      const voted = (poll.myVotes || []).includes(i);
      return el('div', { class: `poll-opt ${voted ? 'voted' : ''}`,
        onClick: () => votePoll(m, i) }, [
        el('div', { class: 'row' }, [el('span', { text: o.text }),
          el('span', { text: `${o.votes || 0}` })]),
        el('div', { class: 'bar' }, el('i', { style: { width: pct + '%' } })),
      ]);
    }),
    el('div', { class: 'hint', text: `${total} Stimmen` }),
  ]);
}
async function votePoll(m, optionIndex) {
  try { await api.post(`/chats/${cur.chatId}/messages/${m.id}/vote`, { optionIndex }); }
  catch (e) { toast(e.message, 'err'); }
}

// ---- composer -------------------------------------------------------------
function renderComposer() {
  const chat = store.getChat(cur.chatId);
  const wrap = cur.composerWrap;
  clear(wrap);

  if (chat?.locked) {
    wrap.appendChild(el('div', { class: 'composer locked',
      text: '🔒 Dieser Kanal ist schreibgeschützt.' }));
    return;
  }

  // reply / edit context bar
  if (cur.replyTo) wrap.appendChild(contextBar('reply', cur.replyTo, () => { cur.replyTo = null; renderComposer(); }));
  if (cur.editing) wrap.appendChild(contextBar('edit', cur.editing, () => { cur.editing = null; ta.value = ''; renderComposer(); }));

  const ta = el('textarea', { class: '', rows: '1', placeholder: 'Nachricht schreiben …' });
  if (cur.editing) ta.value = cur.editing.body || '';
  ta.addEventListener('input', () => { autosize(ta); emitTyping(ta.value.length > 0); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  const sendBtn = el('button', { class: 'send', title: 'Senden', onClick: submit }, icon('send'));

  const composer = el('div', { class: 'composer' }, [
    el('button', { class: 'iconbtn', title: 'Anhängen', onClick: (e) => attachMenu(e) }, icon('attach')),
    el('div', { class: 'grow' }, ta),
    sendBtn,
  ]);
  wrap.appendChild(composer);
  cur.ta = ta;
  setTimeout(() => ta.focus(), 0);

  async function submit() {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; autosize(ta); emitTyping(false);
    if (cur.editing) {
      const m = cur.editing; cur.editing = null; renderComposer();
      try { await api.patch(`/chats/${cur.chatId}/messages/${m.id}`, { body: text }); }
      catch (e) { toast(e.message, 'err'); }
      return;
    }
    const replyTo = cur.replyTo?.id || null;
    cur.replyTo = null; renderComposer();
    try {
      const r = await api.post(`/chats/${cur.chatId}/messages`,
        { body: text, ...(replyTo ? { replyTo } : {}) });
      store.addMessage(cur.chatId, r.message);
    } catch (e) { toast(e.message, 'err'); ta.value = text; }
  }
}

function contextBar(kind, m, onClose) {
  const name = m.senderId === store.state.me?.id ? 'Du'
    : (store.getChat(cur.chatId)?.members?.find((u) => u.id === m.senderId)?.displayName
       || store.getChat(cur.chatId)?.otherUser?.displayName || '');
  return el('div', { class: kind === 'edit' ? 'edit-bar' : 'reply-bar' }, [
    icon(kind === 'edit' ? 'edit' : 'reply'),
    el('div', { class: 'meta' }, [
      el('div', { class: 'qname', text: kind === 'edit' ? 'Nachricht bearbeiten' : `Antwort an ${name}` }),
      el('div', { class: 'qbody', text: messagePreview(m) }),
    ]),
    el('button', { class: 'iconbtn', onClick: onClose }, icon('close')),
  ]);
}

function setReply(m) { cur.editing = null; cur.replyTo = m; renderComposer(); cur.ta?.focus(); }
function setEdit(m) { cur.replyTo = null; cur.editing = m; renderComposer(); }

function attachMenu(e) {
  openMenu(e, [
    { label: 'Foto / Video', icon: 'image', onClick: () => attach('image/*,video/*') },
    { label: 'Datei', icon: 'file', onClick: () => attach('') },
    { label: 'Umfrage', icon: 'poll', onClick: () => import('./groups.js').then((m) => m.newPollModal(cur.chatId)) },
  ]);
}
async function attach(accept) {
  const file = await pickFile(accept);
  if (!file) return;
  const chatId = cur.chatId;
  try {
    toast('Lädt hoch …');
    const msg = await sendAttachment(chatId, file);
    store.addMessage(chatId, msg);
  } catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
}

// ---- typing throttle ------------------------------------------------------
function emitTyping(on) {
  if (on === cur.typingOn && on) return;
  if (on !== cur.typingOn) { socket.send('typing', { chatId: cur.chatId, typing: on }); cur.typingOn = on; }
  clearTimeout(cur.typingTimer);
  if (on) cur.typingTimer = setTimeout(() => {
    socket.send('typing', { chatId: cur.chatId, typing: false }); cur.typingOn = false;
  }, 4000);
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

async function onScroll(e) {
  const thread = e.target;
  if (thread.scrollTop > 60 || store.state.loadedAll.has(cur.chatId) || cur.loadingOlder) return;
  const msgs = store.getHistory(cur.chatId);
  if (!msgs.length) return;
  cur.loadingOlder = true;
  try {
    const { messages } = await api.get(
      `/chats/${cur.chatId}/messages?limit=40&before=${msgs[0].createdAt}`);
    if (messages.length) store.prependHistory(cur.chatId, messages, { all: messages.length < 40 });
    else store.state.loadedAll.add(cur.chatId);
  } catch { /* ignore */ }
  cur.loadingOlder = false;
}

// ---- chat menu / info -----------------------------------------------------
function chatMenu(e, chat) {
  openMenu(e, [
    { label: chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten', icon: 'mute',
      onClick: () => toggleMute(chat) },
    { label: chat.archived ? 'Aus Archiv' : 'Archivieren', icon: 'archive',
      onClick: () => toggleArchive(chat) },
    { label: 'Infos', icon: 'info', onClick: () => openChatInfo(chat) },
    chat.type === 'group' ? { label: 'Gruppe verlassen', icon: 'logout', danger: true,
      onClick: () => import('./groups.js').then((m) => m.leaveGroup(chat.id)) } : null,
  ].filter(Boolean));
}
async function toggleMute(chat) {
  try { await api.post(`/chats/${chat.id}/mute`, { muted: !chat.muted });
    chat.muted = !chat.muted; store.emit('chats'); } catch (e) { toast(e.message, 'err'); }
}
async function toggleArchive(chat) {
  try { await api.post(`/chats/${chat.id}/archive`, { archived: !chat.archived });
    chat.archived = !chat.archived; store.emit('chats'); } catch (e) { toast(e.message, 'err'); }
}
function openChatInfo(chat) {
  import('./groups.js').then((m) => m.openChatInfo(chat))
    .catch(() => import('./contacts.js').then((m) => m.openProfile(chat.otherUser)));
}

// ---- tiny linkifier -------------------------------------------------------
function linkify(text) {
  return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent-ink)">$1</a>');
}
