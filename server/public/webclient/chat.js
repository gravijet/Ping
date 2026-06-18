/* chat.js — the conversation pane. Loads history, renders grouped bubbles with
   day separators, drives the composer (text, emoji, attachments, voice, reply,
   edit, schedule) and reacts to realtime message/typing/receipt/presence
   updates. Per-message actions: react, reply, forward, star, copy, info, delete.
*/

import { api } from './api.js';
import * as store from './store.js';
import * as socket from './socket.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, timeOf, dayLabel, lastSeenLabel, openMenu,
  confirmModal, modal, toast, escapeHtml } from './ui.js';
import { renderAttachment, sendAttachment, sendVoice, pickFile } from './media.js';
import { messagePreview } from './format.js';
import { startCall } from './calls.js';
import { openEmojiPicker, closeEmoji } from './emoji.js';
import { startRecorder } from './voice.js';
import { forwardMessage, forwardMessages } from './forward.js';
import { openInfoPanel, closeInfoPanel } from './infopanel.js';
import * as outbox from './outbox.js';
import { flag } from './flags.js';
import { skeletonMessages } from './skeleton.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
// Shown inline on the hover action bar so the most common reactions are one tap
// away and visible — no need to discover the hidden picker menu first.
const QUICK_REACTIONS = ['👍', '❤️', '😂'];
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍){1,8}$/u;
let cur = null;

// Outbox (offline send-queue) ↔ conversation glue. Registered once at import:
// when a queued message finally reaches the server, swap its optimistic
// "pending" bubble for the real one; if it ultimately fails, mark it so the
// user can retry. These fire regardless of which chat is currently open.
store.on('outbox-sent', ({ chatId, tempId, message }) => {
  store.removeMessage(chatId, tempId);
  store.addMessage(chatId, message);
  const chat = store.getChat(chatId);
  if (chat) { chat.lastMessage = message; chat.updatedAt = message.createdAt; store.emit('chats'); }
});
store.on('outbox-failed', ({ chatId, tempId }) => {
  const m = store.getHistory(chatId).find((x) => x.id === tempId);
  if (m) { m.status = 'failed'; m.pending = false; m.failed = true; store.emit('messages:' + chatId); }
});

// Synthetic message shown immediately for a queued (not-yet-sent) send.
function pendingMessage(item) {
  return { id: item.tempId, chatId: item.chatId, senderId: store.state.me?.id,
    type: 'text', body: item.body, createdAt: item.ts, status: 'pending', pending: true,
    clientId: item.clientId };
}

// The delivery tick on an outgoing bubble: clock while queued, a retry arrow on
// failure, otherwise the normal sent/delivered/read ticks.
function statusTick(m) {
  if (m.pending || m.status === 'pending') {
    return el('span', { class: 'tick pending', title: 'Wird gesendet, sobald du verbunden bist …' },
      icon('clock', 'sm'));
  }
  if (m.failed || m.status === 'failed') {
    return el('span', { class: 'tick failed', title: 'Senden fehlgeschlagen – erneut versuchen',
      onClick: () => retryPending(m) }, icon('refresh', 'sm'));
  }
  return el('span', { class: `tick ${m.status === 'read' ? 'read' : ''}` },
    icon(m.status === 'sent' ? 'check' : 'doublecheck', 'sm'));
}

function retryPending(m) {
  const chatId = m.chatId || cur?.chatId;
  if (!chatId) return;
  store.removeMessage(chatId, m.id);
  const item = outbox.enqueue({ chatId, body: m.body, replyTo: m.quoted?.id || null });
  store.addMessage(chatId, pendingMessage(item));
  outbox.flush();
}

export function closeChat() {
  if (cur) { cur.unsubs.forEach((u) => u()); if (cur.recorder) cur.recorder.cancel(); cur = null; }
  closeInfoPanel();
}

export async function openChat(slot, chatId, { onBack } = {}) {
  closeChat();
  const chat = store.getChat(chatId);
  if (!chat) return;
  cur = { chatId, slot, unsubs: [], replyTo: null, editing: null, typingOn: false, recorder: null };

  const thread = el('div', { class: 'thread', id: 'thread' });
  const composerWrap = el('div', { id: 'composer-wrap' });
  const head = buildHead(chat, onBack);
  const chev = icon('chevron');
  chev.style.transform = 'rotate(90deg)';
  const jump = el('button', { class: 'jump-btn', title: 'Nach unten',
    onClick: () => { thread.scrollTop = thread.scrollHeight; } }, chev);
  clear(slot).append(head, thread, jump, composerWrap);
  cur.thread = thread; cur.head = head; cur.composerWrap = composerWrap; cur.jump = jump;
  renderComposer();

  cur.unsubs.push(store.on('messages:' + chatId, () => renderThread()));
  cur.unsubs.push(store.on('typing:' + chatId, () => updateHeadSub()));
  cur.unsubs.push(store.on('presence', () => updateHeadSub()));
  cur.unsubs.push(store.on('chat:' + chatId, () => { const c = store.getChat(chatId);
    if (c) clear(head).append(...buildHead(c, onBack).childNodes); }));

  thread.appendChild(flag('skeletons') ? skeletonMessages(6)
    : el('div', { class: 'daysep', text: 'Lade …' }));
  try {
    const { messages } = await api.get(`/chats/${chatId}/messages?limit=40`);
    store.setHistory(chatId, messages, { all: messages.length < 40 });
  } catch (e) { toast(e.message || 'Nachrichten konnten nicht geladen werden.', 'err'); }
  renderThread(true);
  markRead();

  thread.addEventListener('scroll', onScroll);
  wireDropZone(thread);
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
    el('button', { class: 'iconbtn back-only', title: 'Zurück', onClick: onBack }, icon('back')),
    el('div', { class: 'peer', onClick: () => openChatInfo(chat) }, [
      av,
      el('div', {}, [el('div', { class: 'title', text: chat.self ? 'Notiz an mich' : chat.title }), sub]),
    ]),
    el('div', { class: 'actions' }, [
      isDirect && !chat.self
        ? el('button', { class: 'iconbtn', title: 'Videoanruf', onClick: () => startCall(peer, true) }, icon('video')) : null,
      isDirect && !chat.self
        ? el('button', { class: 'iconbtn', title: 'Sprachanruf', onClick: () => startCall(peer, false) }, icon('phone')) : null,
      el('button', { class: 'iconbtn', title: 'Suchen (Strg+F)', onClick: () => toggleChatSearch() }, icon('search')),
      el('button', { class: 'iconbtn', title: 'Menü', onClick: (e) => chatMenu(e, chat) }, icon('menu')),
    ].filter(Boolean)),
  ]);
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
  if (typing.length) { sub.textContent = 'tippt …'; sub.classList.add('typing'); return; }
  sub.classList.remove('typing');
  if (chat.type === 'group') {
    sub.textContent = `${chat.members?.length || chat.memberIds?.length || 0} Mitglieder`;
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
  thread.classList.toggle('selecting', !!cur.select);
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
  updateJump();
  if (cur.search?.q) applySearchHighlights();
}

function renderMessage(m, chat, first) {
  const mine = m.senderId === store.state.me?.id;
  const jumbo = prefs.get('largeEmoji') && m.body && !m.attachment && EMOJI_ONLY.test(m.body.trim());
  const bubble = el('div', { class: `bubble ${jumbo ? 'jumbo' : ''}`, id: 'msg-' + m.id });

  if (!mine && chat.type === 'group' && first) {
    const member = chat.members?.find((u) => u.id === m.senderId);
    bubble.appendChild(el('div', { class: 'sender', text: member?.displayName || 'Unbekannt' }));
  }

  if (m.quoted) {
    const q = m.quoted;
    bubble.appendChild(el('div', { class: 'reply-quote', onClick: () => scrollToMessage(q.id) }, [
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
    if (m.attachment) bubble.appendChild(renderAttachment(m.attachment, { onImageClick: () => openChatMedia(m) }));
    if (m.body) bubble.appendChild(el('span', { html: richText(m.body) }));
  }

  if (!m.deleted) {
    const starred = prefs.isStarred(cur.chatId, m.id);
    const meta = el('span', { class: 'meta' }, [
      starred ? icon('star', 'sm starred-flag fill') : null,
      m.editedAt ? el('span', { class: 'edited', text: 'bearbeitet · ' }) : null,
      el('span', { text: timeOf(m.createdAt) }),
      mine ? statusTick(m) : null,
    ].filter(Boolean));
    bubble.appendChild(meta);
  }

  const reactWrap = renderReactions(m);
  const selected = cur.select && cur.select.has(m.id);
  const wrap = el('div', { class: `msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''} ${selected ? 'selected' : ''}` },
    [bubble, reactWrap].filter(Boolean));
  if (!m.deleted) {
    wrap.appendChild(buildMsgActions(m, mine));
    wrap.addEventListener('contextmenu', (e) => msgMenu(e, m, mine));
    // On touch devices there's no hover, so a tap on the bubble reveals the
    // action bar (desktop keeps the hover behaviour). In selection mode a tap
    // toggles the message instead. Ignore taps on links/attachments/buttons.
    wrap.addEventListener('click', (e) => {
      if (cur.select) {
        if (e.target.closest('a, .reaction')) return;
        toggleSelect(m.id, wrap);
        return;
      }
      if (matchMedia('(hover: hover)').matches) return;
      if (e.target.closest('a, .att-img, .att-file, .reaction, button')) return;
      if (window.getSelection && String(window.getSelection())) return;
      document.querySelectorAll('.msg.show-actions').forEach((n) =>
        n !== wrap && n.classList.remove('show-actions'));
      wrap.classList.toggle('show-actions');
    });
  }
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
  const quick = QUICK_REACTIONS.map((emoji) =>
    el('button', { class: 'qreact', title: `Mit ${emoji} reagieren`,
      onClick: () => toggleReaction(m, emoji) }, emoji));
  return el('div', { class: 'msg-actions' }, [
    ...quick,
    el('button', { class: 'iconbtn', title: 'Weitere Reaktion', onClick: (e) => reactionPicker(e, m) }, icon('react')),
    el('button', { class: 'iconbtn', title: 'Antworten', onClick: () => setReply(m) }, icon('reply')),
    el('button', { class: 'iconbtn', title: 'Mehr', onClick: (e) => msgMenu(e, m, mine) }, icon('menu')),
  ]);
}

function msgMenu(e, m, mine) {
  const starred = prefs.isStarred(cur.chatId, m.id);
  const chat = store.getChat(cur.chatId);
  const canReplyPrivately = chat?.type === 'group' && !mine && m.senderId;
  openMenu(e, [
    { label: 'Antworten', icon: 'reply', onClick: () => setReply(m) },
    canReplyPrivately ? { label: 'Privat antworten', icon: 'user',
      onClick: () => import('./contacts.js').then((c) => c.startDirect(m.senderId)) } : null,
    { label: 'Weiterleiten', icon: 'forward', onClick: () => forwardMessage(m) },
    { label: 'Auswählen', icon: 'check', onClick: () => enterSelect(m) },
    { label: starred ? 'Markierung entfernen' : 'Markieren', icon: 'star',
      onClick: () => { prefs.toggleStar(cur.chatId, m.id, starSnapshot(m)); renderThread(); } },
    mine && m.type === 'text' && !m.attachment
      ? { label: 'Bearbeiten', icon: 'edit', onClick: () => setEdit(m) } : null,
    (m.body || m.type === 'text')
      ? { label: 'Kopieren', icon: 'copy', onClick: () => {
          navigator.clipboard?.writeText(m.body || '').then(() => toast('Kopiert.')); } } : null,
    flag('shareButtons') && m.body
      ? { label: 'Teilen', icon: 'forward', onClick: () => import('./share.js').then((s) => s.shareMessage(m)) } : null,
    mine ? { label: 'Info', icon: 'info', onClick: () => messageInfo(m) } : null,
    { sep: true },
    { label: 'Für mich löschen', icon: 'trash', onClick: () => hideMessage(m) },
    mine ? { label: 'Für alle löschen', icon: 'trash', danger: true,
      onClick: () => deleteMessage(m) } : null,
  ].filter(Boolean));
}

function reactionPicker(e, m) {
  openMenu(e, REACTIONS.map((emoji) => ({ label: emoji, onClick: () => toggleReaction(m, emoji) })));
}

// Snapshot stored alongside a star so the Saved pane can render it without a
// round-trip (there's no "fetch one message" endpoint).
function starSnapshot(m) {
  const chat = store.getChat(cur.chatId);
  const mine = m.senderId === store.state.me?.id;
  const senderName = mine ? 'Du'
    : (chat?.members?.find((u) => u.id === m.senderId)?.displayName
       || chat?.otherUser?.displayName || chat?.title || '');
  return { preview: messagePreview(m), senderName, createdAt: m.createdAt,
    chatTitle: chat?.self ? 'Notiz an mich' : (chat?.title || '') };
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
async function hideMessage(m) {
  try { await api.post(`/chats/${cur.chatId}/messages/${m.id}/hide`);
    store.removeMessage(cur.chatId, m.id); }
  catch (err) { toast(err.message, 'err'); }
}

async function messageInfo(m) {
  const mdl = modal({ title: 'Nachrichten-Info', body: (b) => b.append(el('div', { class: 'hint', text: 'Lade …' })) });
  try {
    const { receipts } = await api.get(`/chats/${cur.chatId}/messages/${m.id}/receipts`);
    clear(mdl.body);
    mdl.body.append(el('div', { class: 'bubble', style: { maxWidth: '100%', marginBottom: '12px' } },
      el('span', { text: messagePreview(m) })));
    if (!receipts.length) { mdl.body.append(el('div', { class: 'hint', text: 'Noch nicht zugestellt.' })); return; }
    mdl.body.append(el('div', { class: 'list-section', text: 'Gelesen' }));
    for (const r of receipts.filter((x) => x.readAt)) mdl.body.append(receiptRow(r, r.readAt, true));
    const delivered = receipts.filter((x) => !x.readAt && x.deliveredAt);
    if (delivered.length) {
      mdl.body.append(el('div', { class: 'list-section', text: 'Zugestellt' }));
      for (const r of delivered) mdl.body.append(receiptRow(r, r.deliveredAt, false));
    }
  } catch (e) { clear(mdl.body); mdl.body.append(el('div', { class: 'formerr', text: e.message })); }
}
function receiptRow(r, ts, read) {
  return el('div', { class: 'urow' }, [
    avatar(r.user, 40, { kind: 'user' }),
    el('div', { class: 'meta' }, [
      el('div', { class: 'uname', text: r.user.displayName }),
      el('div', { class: 'uabout', text: (read ? 'Gelesen ' : 'Zugestellt ') + new Date(ts).toLocaleString('de-DE') }),
    ]),
    icon(read ? 'doublecheck' : 'check', read ? 'read' : ''),
  ]);
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
      return el('div', { class: `poll-opt ${voted ? 'voted' : ''}`, onClick: () => votePoll(m, i) }, [
        el('div', { class: 'row' }, [el('span', { text: o.text }), el('span', { text: `${o.votes || 0}` })]),
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
    wrap.appendChild(el('div', { class: 'composer locked', text: '🔒 Dieser Kanal ist schreibgeschützt.' }));
    return;
  }
  if (cur.recorder) { renderRecBar(wrap); return; }

  if (cur.replyTo) wrap.appendChild(contextBar('reply', cur.replyTo, () => { cur.replyTo = null; renderComposer(); }));
  if (cur.editing) wrap.appendChild(contextBar('edit', cur.editing, () => { cur.editing = null; renderComposer(); }));

  const ta = el('textarea', { rows: '1', placeholder: 'Nachricht schreiben …',
    spellcheck: prefs.get('spellcheck') ? 'true' : 'false' });
  if (cur.editing) ta.value = cur.editing.body || '';
  const sendBtn = el('button', { class: 'send', title: 'Senden', onClick: submit }, icon('send'));
  const micBtn = el('button', { class: 'send', title: 'Sprachnachricht', onClick: startVoice }, icon('mic'));
  const right = el('div', { style: { display: 'contents' } });

  const refreshRight = () => {
    clear(right);
    right.appendChild(ta.value.trim() || cur.editing ? sendBtn : micBtn);
  };

  ta.addEventListener('input', () => { autosize(ta); emitTyping(ta.value.length > 0); refreshRight(); });
  ta.addEventListener('keydown', (e) => {
    const enterSends = prefs.get('enterToSend');
    if (e.key === 'Enter' && !e.shiftKey && enterSends) { e.preventDefault(); submit(); }
    if (e.key === 'Enter' && e.ctrlKey && !enterSends) { e.preventDefault(); submit(); }
  });
  ta.addEventListener('paste', (e) => onPaste(e));

  const emojiBtn = el('button', { class: 'iconbtn', title: 'Emoji',
    onClick: () => openEmojiPicker(emojiBtn, (em) => insertAtCursor(ta, em)) }, icon('emoji'));

  const composer = el('div', { class: 'composer' }, [
    el('button', { class: 'iconbtn', title: 'Anhängen', onClick: (e) => attachMenu(e) }, icon('attach')),
    el('button', { class: 'iconbtn', title: 'Schnellantwort', onClick: (e) => quickReplyMenu(e, ta) }, icon('bolt')),
    el('div', { class: 'grow' }, [emojiBtn, ta]),
    right,
  ]);
  wrap.appendChild(composer);
  cur.ta = ta;
  refreshRight();
  setTimeout(() => ta.focus(), 0);

  async function submit() {
    closeEmoji();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; autosize(ta); emitTyping(false); refreshRight();
    if (cur.editing) {
      const m = cur.editing; cur.editing = null; renderComposer();
      try { await api.patch(`/chats/${cur.chatId}/messages/${m.id}`, { body: text }); }
      catch (e) { toast(e.message, 'err'); }
      return;
    }
    const replyTo = cur.replyTo?.id || null;
    cur.replyTo = null; renderComposer();
    try {
      const r = await api.post(`/chats/${cur.chatId}/messages`, { body: text, ...(replyTo ? { replyTo } : {}) });
      store.addMessage(cur.chatId, r.message);
    } catch (e) {
      // Offline / unreachable: park the message in the persistent outbox and show
      // an optimistic "pending" bubble instead of losing what the user typed.
      const offline = e.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (flag('outbox') && offline) {
        const item = outbox.enqueue({ chatId: cur.chatId, body: text, replyTo });
        store.addMessage(cur.chatId, pendingMessage(item));
        toast('Offline – wird gesendet, sobald du wieder verbunden bist.');
      } else {
        toast(e.message, 'err'); ta.value = text; refreshRight();
      }
    }
  }
}

function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

// ---- voice recording ------------------------------------------------------
async function startVoice() {
  try {
    cur.recorder = await startRecorder();
    renderComposer();
  } catch (e) { toast(e.message || 'Mikrofon nicht verfügbar.', 'err'); cur.recorder = null; }
}
function renderRecBar(wrap) {
  const time = el('span', { class: 'rec-time', text: '0:00' });
  const start = cur.recorder.started;
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  const stop = (send) => async () => {
    clearInterval(timer);
    const rec = cur.recorder; cur.recorder = null;
    if (!send) { rec.cancel(); renderComposer(); return; }
    let res; try { res = await rec.stop(); } catch { res = null; }
    renderComposer();
    if (res?.file && res.file.size > 0) {
      try { const msg = await sendVoice(cur.chatId, res.file, res.durationMs);
        store.addMessage(cur.chatId, msg); } catch (e) { toast(e.message || 'Senden fehlgeschlagen', 'err'); }
    }
  };
  wrap.appendChild(el('div', { class: 'composer recording' }, [
    el('button', { class: 'iconbtn', title: 'Abbrechen', onClick: stop(false) }, icon('trash')),
    el('div', { class: 'rec-bar' }, [
      el('span', { class: 'rec-dot' }), time,
      el('span', { class: 'rec-hint', text: 'Aufnahme läuft …' }),
    ]),
    el('button', { class: 'send', title: 'Senden', onClick: stop(true) }, icon('send')),
  ]));
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

// Canned replies (managed in Einstellungen → Chats): tap to drop one into the
// composer, ready to edit or send.
function quickReplyMenu(e, ta) {
  const replies = prefs.get('quickReplies') || [];
  if (!replies.length) { toast('Lege Schnellantworten in den Einstellungen an.'); return; }
  openMenu(e, replies.map((text) => ({ label: text, onClick: () => insertAtCursor(ta, text) })));
}

function attachMenu(e) {
  openMenu(e, [
    { label: 'Foto / Video', icon: 'image', onClick: () => attach('image/*,video/*') },
    { label: 'Datei', icon: 'file', onClick: () => attach('') },
    { label: 'Kontakt', icon: 'user', onClick: () => shareContact() },
    { label: 'Standort', icon: 'pin', onClick: () => sendLocation() },
    { label: 'Zeichnen', icon: 'paint', onClick: () => import('./draw.js').then((m) => m.drawModal(cur.chatId)) },
    { label: 'Umfrage', icon: 'poll', onClick: () => import('./groups.js').then((m) => m.newPollModal(cur.chatId)) },
    { label: 'Geplante Nachricht', icon: 'schedule', onClick: () => scheduleModal() },
  ]);
}

// Share one of your contacts (from an existing direct chat) as a message with
// their name and number. Looks the phone up on demand if the chat summary
// didn't carry it. No server change — it's a normal text message.
function shareContact() {
  const chatId = cur.chatId;
  const directs = store.chatsSorted().filter((c) => c.type === 'direct' && !c.self && c.otherUser);
  const mdl = modal({ title: 'Kontakt senden', body: (b) => {
    if (!directs.length) { b.append(el('div', { class: 'pane-empty', text: 'Noch keine Kontakte.' })); return; }
    b.append(el('p', { class: 'hint', text: 'Wähle einen Kontakt zum Teilen.' }));
    for (const c of directs) {
      const u = c.otherUser;
      b.append(el('button', { class: 'urow', onClick: () => pick(u) }, [
        avatar(u, 44, { kind: 'user' }),
        el('div', { class: 'meta' }, el('div', { class: 'uname', text: u.displayName })),
      ]));
    }
  } });
  async function pick(u) {
    mdl.close();
    let phone = u.phone;
    if (!phone) { try { const r = await api.get(`/users/${u.id}`); phone = r.user?.phone; } catch { /* optional */ } }
    const body = `👤 Kontakt: ${u.displayName}` + (phone ? `\n📞 ${phone}` : '');
    try { const r = await api.post(`/chats/${chatId}/messages`, { body }); store.addMessage(chatId, r.message); }
    catch (e) { toast(e.message || 'Senden fehlgeschlagen', 'err'); }
  }
}

// Share the current device location as a message with a maps link. No server
// change needed — it rides along as a normal text message (the link is tappable
// in every client, web and native).
function sendLocation() {
  if (!navigator.geolocation) { toast('Standort wird nicht unterstützt.', 'err'); return; }
  const chatId = cur.chatId;
  toast('Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude.toFixed(6);
    const lng = pos.coords.longitude.toFixed(6);
    const body = `📍 Mein Standort: https://maps.google.com/?q=${lat},${lng}`;
    try {
      const r = await api.post(`/chats/${chatId}/messages`, { body });
      store.addMessage(chatId, r.message);
    } catch (err) { toast(err.message || 'Senden fehlgeschlagen', 'err'); }
  }, (err) => {
    toast(err.code === err.PERMISSION_DENIED ? 'Standort-Zugriff verweigert.' : 'Standort nicht verfügbar.', 'err');
  }, { enableHighAccuracy: true, timeout: 10000 });
}
async function attach(accept) {
  const file = await pickFile(accept);
  if (!file) return;
  await uploadAndSend(file);
}
async function uploadAndSend(file) {
  const chatId = cur.chatId;
  try {
    toast('Lädt hoch …');
    const msg = await sendAttachment(chatId, file, { replyTo: cur.replyTo?.id || null });
    cur.replyTo = null; renderComposer();
    store.addMessage(chatId, msg);
  } catch (e) { toast(e.message || 'Upload fehlgeschlagen', 'err'); }
}

// ---- scheduled messages ---------------------------------------------------
function scheduleModal() {
  const ta = el('textarea', { class: 'input', rows: '3', placeholder: 'Nachricht …' });
  const when = el('input', { class: 'input', type: 'datetime-local' });
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  when.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const err = el('div', { class: 'formerr' });
  const m = modal({
    title: 'Geplante Nachricht',
    body: (b) => b.append(
      el('div', { class: 'field' }, [el('label', { text: 'Nachricht' }), ta]),
      el('div', { class: 'field' }, [el('label', { text: 'Senden am' }), when]), err),
    foot: [el('button', { class: 'btn primary', onClick: submit }, [icon('schedule'), 'Planen'])],
  });
  async function submit() {
    err.textContent = '';
    const body = ta.value.trim();
    const sendAt = new Date(when.value).getTime();
    if (!body) { err.textContent = 'Bitte einen Text eingeben.'; return; }
    if (!sendAt || sendAt < Date.now() + 30000) { err.textContent = 'Wähle einen Zeitpunkt in der Zukunft.'; return; }
    try { await api.post(`/chats/${cur.chatId}/schedule`, { body, sendAt }); m.close();
      toast('Nachricht geplant.', 'ok'); }
    catch (e) { err.textContent = e.message; }
  }
}

async function listScheduled() {
  const mdl = modal({ title: 'Geplante Nachrichten', body: (b) => b.append(el('div', { class: 'hint', text: 'Lade …' })) });
  try {
    const { scheduled } = await api.get(`/chats/${cur.chatId}/scheduled`);
    clear(mdl.body);
    if (!scheduled?.length) { mdl.body.append(el('div', { class: 'pane-empty', text: 'Nichts geplant.' })); return; }
    for (const s of scheduled) {
      mdl.body.append(el('div', { class: 'set-row' }, [
        el('div', { class: 'set-ic' }, icon('schedule', 'sm')),
        el('div', { class: 'set-main' }, [
          el('div', { class: 'set-title', text: s.body || '📎 Anhang' }),
          el('div', { class: 'set-sub', text: new Date(s.sendAt).toLocaleString('de-DE') }),
        ]),
        el('button', { class: 'iconbtn', title: 'Löschen', onClick: async (e) => {
          try { await api.del(`/chats/${cur.chatId}/scheduled/${s.id}`); e.target.closest('.set-row').remove(); }
          catch (err) { toast(err.message, 'err'); } } }, icon('trash')),
      ]));
    }
  } catch (e) { clear(mdl.body); mdl.body.append(el('div', { class: 'formerr', text: e.message })); }
}

// ---- typing throttle ------------------------------------------------------
function emitTyping(on) {
  if (!prefs.get('sendTyping')) return;
  if (on === cur.typingOn && on) return;
  if (on !== cur.typingOn) { socket.send('typing', { chatId: cur.chatId, typing: on }); cur.typingOn = on; }
  clearTimeout(cur.typingTimer);
  if (on) cur.typingTimer = setTimeout(() => {
    socket.send('typing', { chatId: cur.chatId, typing: false }); cur.typingOn = false;
  }, 4000);
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

function updateJump() {
  if (!cur?.jump) return;
  cur.jump.classList.toggle('show', !nearBottom(cur.thread));
}

async function onScroll(e) {
  const thread = e.target;
  updateJump();
  if (thread.scrollTop > 60 || store.state.loadedAll.has(cur.chatId) || cur.loadingOlder) return;
  const msgs = store.getHistory(cur.chatId);
  if (!msgs.length) return;
  cur.loadingOlder = true;
  try {
    const { messages } = await api.get(`/chats/${cur.chatId}/messages?limit=40&before=${msgs[0].createdAt}`);
    if (messages.length) store.prependHistory(cur.chatId, messages, { all: messages.length < 40 });
    else store.state.loadedAll.add(cur.chatId);
  } catch { /* ignore */ }
  cur.loadingOlder = false;
}

// ---- drag & drop / paste to send ------------------------------------------
function wireDropZone(thread) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((t) => thread.addEventListener(t, (e) => { stop(e); thread.classList.add('dropping'); }));
  ['dragleave', 'drop'].forEach((t) => thread.addEventListener(t, (e) => { stop(e); thread.classList.remove('dropping'); }));
  thread.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadAndSend(file);
  });
}
function onPaste(e) {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { const file = item.getAsFile(); if (file) { e.preventDefault(); uploadAndSend(file); } }
}

// ---- in-chat search -------------------------------------------------------
export function toggleChatSearch() {
  if (!cur) return;
  if (cur.searchBar) return closeChatSearch();
  if (cur.select) exitSelect();
  const input = el('input', { class: 'cs-input', placeholder: 'In dieser Unterhaltung suchen …' });
  const count = el('span', { class: 'cs-count' });
  const upIco = icon('chevron'); upIco.style.transform = 'rotate(-90deg)';
  const downIco = icon('chevron'); downIco.style.transform = 'rotate(90deg)';
  const bar = el('div', { class: 'chat-search' }, [
    icon('search', 'sm'), input, count,
    el('button', { class: 'iconbtn', title: 'Vorheriges', onClick: () => stepSearch(-1) }, upIco),
    el('button', { class: 'iconbtn', title: 'Nächstes', onClick: () => stepSearch(1) }, downIco),
    el('button', { class: 'iconbtn', title: 'Schließen', onClick: () => closeChatSearch() }, icon('close')),
  ]);
  cur.searchBar = bar;
  cur.search = { q: '', matches: [], idx: 0, count };
  cur.slot.insertBefore(bar, cur.thread);
  input.addEventListener('input', () => { cur.search.q = input.value.trim(); runSearch(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeChatSearch(); }
  });
  setTimeout(() => input.focus(), 0);
}

function closeChatSearch() {
  if (!cur?.searchBar) return;
  cur.searchBar.remove(); cur.searchBar = null; cur.search = null;
  document.querySelectorAll('.bubble.hit, .bubble.hit-current')
    .forEach((b) => b.classList.remove('hit', 'hit-current'));
}

function runSearch() {
  const s = cur.search; if (!s) return;
  const q = s.q.toLowerCase();
  s.matches = !q ? [] : store.getHistory(cur.chatId)
    .filter((m) => !m.deleted && (m.body || '').toLowerCase().includes(q))
    .map((m) => m.id);
  s.idx = 0;
  applySearchHighlights();
  if (s.matches.length) scrollToMessage(s.matches[0]);
}

function applySearchHighlights() {
  const s = cur.search; if (!s) return;
  document.querySelectorAll('.bubble.hit, .bubble.hit-current')
    .forEach((b) => b.classList.remove('hit', 'hit-current'));
  s.matches.forEach((id, i) => {
    const b = document.getElementById('msg-' + id);
    if (b) { b.classList.add('hit'); if (i === s.idx) b.classList.add('hit-current'); }
  });
  s.count.textContent = s.matches.length ? `${s.idx + 1}/${s.matches.length}` : (s.q ? '0/0' : '');
}

function stepSearch(dir) {
  const s = cur?.search; if (!s || !s.matches.length) return;
  s.idx = (s.idx + dir + s.matches.length) % s.matches.length;
  applySearchHighlights();
  scrollToMessage(s.matches[s.idx]);
}

// ---- multi-select ---------------------------------------------------------
function enterSelect(m) {
  if (cur.searchBar) closeChatSearch();
  cur.select = new Set(m ? [m.id] : []);
  renderThread();
  showSelectBar();
}
function exitSelect() {
  if (!cur?.select) return;
  cur.select = null;
  cur.selectBar?.remove(); cur.selectBar = null; cur.selectCount = null;
  renderThread();
}
function toggleSelect(id, wrap) {
  if (!cur.select) return;
  if (cur.select.has(id)) { cur.select.delete(id); wrap.classList.remove('selected'); }
  else { cur.select.add(id); wrap.classList.add('selected'); }
  if (cur.selectCount) cur.selectCount.textContent = `${cur.select.size} ausgewählt`;
}
function selectedMsgs() {
  return store.getHistory(cur.chatId).filter((m) => cur.select.has(m.id));
}
function showSelectBar() {
  const count = el('span', { class: 'sel-count', text: '1 ausgewählt' });
  cur.selectCount = count;
  const bar = el('div', { class: 'select-bar' }, [
    el('button', { class: 'iconbtn', title: 'Abbrechen', onClick: () => exitSelect() }, icon('close')),
    count,
    el('div', { style: { flex: '1' } }),
    el('button', { class: 'iconbtn', title: 'Weiterleiten', onClick: () => {
      const ms = selectedMsgs(); if (ms.length) forwardMessages(ms); exitSelect(); } }, icon('forward')),
    el('button', { class: 'iconbtn', title: 'Markieren', onClick: () => {
      for (const m of selectedMsgs()) if (!prefs.isStarred(cur.chatId, m.id)) prefs.toggleStar(cur.chatId, m.id, starSnapshot(m));
      toast('Markiert.', 'ok'); exitSelect(); } }, icon('star')),
    el('button', { class: 'iconbtn', title: 'Kopieren', onClick: () => {
      const text = selectedMsgs().map((m) => m.body || messagePreview(m)).join('\n');
      navigator.clipboard?.writeText(text).then(() => toast('Kopiert.')); exitSelect(); } }, icon('copy')),
    el('button', { class: 'iconbtn', title: 'Löschen', onClick: () => bulkDelete() }, icon('trash')),
  ]);
  cur.selectBar = bar;
  cur.slot.insertBefore(bar, cur.thread);
}
async function bulkDelete() {
  const ms = selectedMsgs(); if (!ms.length) return;
  if (!await confirmModal({ title: 'Nachrichten löschen',
    message: `${ms.length} Nachricht${ms.length > 1 ? 'en' : ''} für dich entfernen?`,
    confirmText: 'Löschen', danger: true })) return;
  for (const m of ms) {
    try { await api.post(`/chats/${cur.chatId}/messages/${m.id}/hide`); store.removeMessage(cur.chatId, m.id); }
    catch (e) { toast(e.message, 'err'); }
  }
  exitSelect();
}

// ---- chat menu / info -----------------------------------------------------
function chatMenu(e, chat) {
  openMenu(e, [
    { label: 'Infos', icon: 'info', onClick: () => openChatInfo(chat) },
    { label: 'Suchen', icon: 'search', onClick: () => toggleChatSearch() },
    { label: 'Nachrichten auswählen', icon: 'check', onClick: () => enterSelect(null) },
    { label: chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten', icon: 'mute', onClick: () => toggleMute(chat) },
    { label: 'Verschwindende Nachrichten', icon: 'clock', onClick: () => expireModal(chat) },
    { label: 'Geplante Nachrichten', icon: 'schedule', onClick: () => listScheduled() },
    { label: chat.archived ? 'Aus Archiv' : 'Archivieren', icon: 'archive', onClick: () => toggleArchive(chat) },
    { label: 'Chat exportieren', icon: 'download', onClick: () => exportChat(chat) },
    chat.type === 'group' ? { label: 'Gruppe verlassen', icon: 'logout', danger: true,
      onClick: () => import('./groups.js').then((m) => m.leaveGroup(chat.id)) } : null,
  ].filter(Boolean));
}

// Export the loaded conversation history as a plain-text file.
function exportChat(chat) {
  const msgs = store.getHistory(chat.id);
  if (!msgs.length) { toast('Nichts zu exportieren.'); return; }
  const title = chat.self ? 'Notiz an mich' : chat.title;
  const lines = msgs.map((m) => {
    const who = m.senderId === store.state.me?.id ? 'Du'
      : (chat.members?.find((u) => u.id === m.senderId)?.displayName || chat.otherUser?.displayName || chat.title || '');
    const when = new Date(m.createdAt).toLocaleString('de-DE');
    return `[${when}] ${who}: ${m.deleted ? '(gelöscht)' : messagePreview(m)}`;
  });
  const blob = new Blob([`Ping — ${title}\n\n${lines.join('\n')}\n`], { type: 'text/plain' });
  const u = URL.createObjectURL(blob);
  const a = el('a', { href: u, download: `ping-${(title || 'chat').replace(/\W+/g, '-').toLowerCase()}.txt` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  toast('Chat exportiert.', 'ok');
}
async function toggleMute(chat) {
  try { await api.post(`/chats/${chat.id}/mute`, { muted: !chat.muted });
    chat.muted = !chat.muted; store.emit('chats'); } catch (e) { toast(e.message, 'err'); }
}
async function toggleArchive(chat) {
  try { await api.post(`/chats/${chat.id}/archive`, { archived: !chat.archived });
    chat.archived = !chat.archived; store.emit('chats'); toast(chat.archived ? 'Archiviert.' : 'Aus dem Archiv geholt.'); }
  catch (e) { toast(e.message, 'err'); }
}
function expireModal(chat) {
  const opts = [['Aus', 0], ['1 Stunde', 3600], ['24 Stunden', 86400], ['7 Tage', 604800], ['90 Tage', 7776000]];
  openMenuLike(opts.map(([label, seconds]) => ({ label, onClick: async () => {
    try { const r = await api.post(`/chats/${chat.id}/expire`, { seconds });
      if (r.chat) store.upsertChat(r.chat); toast('Aktualisiert.', 'ok'); }
    catch (e) { toast(e.message, 'err'); } } })), 'Selbstlöschende Nachrichten');
}
function openMenuLike(items, title) {
  const m = modal({ title, body: (b) => {
    for (const it of items) b.append(el('button', { class: 'set-row clickable',
      style: { width: '100%', border: '0', background: 'none', textAlign: 'left' },
      onClick: () => { m.close(); it.onClick(); } }, [
      el('div', { class: 'set-main' }, el('div', { class: 'set-title', text: it.label })),
    ]));
  } });
}
function openChatInfo(chat) {
  openInfoPanel(chat);
}

// Open the gallery scoped to every image/video in the open conversation,
// starting at the tapped message.
function openChatMedia(msg) {
  const items = store.getHistory(cur.chatId)
    .filter((x) => !x.deleted && x.attachment && ['image', 'gif', 'video'].includes(x.attachment.kind))
    .map((x) => x.attachment);
  const start = items.findIndex((a) => a === msg.attachment);
  import('./gallery.js').then((m) => m.openGallery(items, Math.max(0, start)));
}

// Render a message body to safe HTML: escape, protect URLs, optionally apply
// lightweight text formatting (*bold* _italic_ ~strike~ `code` ||spoiler||),
// then restore the URLs as links. Mirrors the native app's formatting set.
function richText(text) {
  const fmt = prefs.get('messageFormatting');
  // Split on URLs so formatting never touches a link (underscores in a URL
  // aren't mistaken for italics); only the non-URL parts get formatted.
  return String(text).split(/(https?:\/\/[^\s<]+)/g).map((seg, i) => {
    const safe = escapeHtml(seg);
    if (i % 2 === 1) return `<a href="${safe}" target="_blank" rel="noopener">${safe}</a>`;
    return fmt ? applyFormatting(safe) : safe;
  }).join('');
}
function applyFormatting(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler" title="Zum Aufdecken antippen">$1</span>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<del>$1</del>');
}
