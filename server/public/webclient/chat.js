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
import { forwardMessage } from './forward.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍){1,8}$/u;
let cur = null;

export function closeChat() {
  if (cur) { cur.unsubs.forEach((u) => u()); if (cur.recorder) cur.recorder.cancel(); cur = null; }
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

  thread.appendChild(el('div', { class: 'daysep', text: 'Lade …' }));
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
    el('button', { class: 'iconbtn back-only', title: 'Zurück',
      onClick: onBack, style: { display: innerWidth <= 980 ? '' : 'none' } }, icon('back')),
    el('div', { class: 'peer', onClick: () => openChatInfo(chat) }, [
      av,
      el('div', {}, [el('div', { class: 'title', text: chat.self ? 'Notiz an mich' : chat.title }), sub]),
    ]),
    el('div', { class: 'actions' }, isDirect && !chat.self ? [
      el('button', { class: 'iconbtn', title: 'Videoanruf', onClick: () => startCall(peer, true) }, icon('video')),
      el('button', { class: 'iconbtn', title: 'Sprachanruf', onClick: () => startCall(peer, false) }, icon('phone')),
      el('button', { class: 'iconbtn', title: 'Menü', onClick: (e) => chatMenu(e, chat) }, icon('menu')),
    ] : [
      el('button', { class: 'iconbtn', title: 'Menü', onClick: (e) => chatMenu(e, chat) }, icon('menu')),
    ]),
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
    if (m.attachment) bubble.appendChild(renderAttachment(m.attachment));
    if (m.body) bubble.appendChild(el('span', { html: linkify(m.body) }));
  }

  if (!m.deleted) {
    const starred = prefs.isStarred(cur.chatId, m.id);
    const meta = el('span', { class: 'meta' }, [
      starred ? icon('star', 'sm starred-flag fill') : null,
      m.editedAt ? el('span', { class: 'edited', text: 'bearbeitet · ' }) : null,
      el('span', { text: timeOf(m.createdAt) }),
      mine ? el('span', { class: `tick ${m.status === 'read' ? 'read' : ''}` },
        icon(m.status === 'sent' ? 'check' : 'doublecheck', 'sm')) : null,
    ].filter(Boolean));
    bubble.appendChild(meta);
  }

  const reactWrap = renderReactions(m);
  const wrap = el('div', { class: `msg ${mine ? 'out' : 'in'} ${first ? 'first' : ''}` },
    [bubble, reactWrap].filter(Boolean));
  if (!m.deleted) {
    wrap.appendChild(buildMsgActions(m, mine));
    wrap.addEventListener('contextmenu', (e) => msgMenu(e, m, mine));
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
  return el('div', { class: 'msg-actions' }, [
    el('button', { class: 'iconbtn', title: 'Reagieren', onClick: (e) => reactionPicker(e, m) }, icon('react')),
    el('button', { class: 'iconbtn', title: 'Antworten', onClick: () => setReply(m) }, icon('reply')),
    el('button', { class: 'iconbtn', title: 'Mehr', onClick: (e) => msgMenu(e, m, mine) }, icon('menu')),
  ]);
}

function msgMenu(e, m, mine) {
  const starred = prefs.isStarred(cur.chatId, m.id);
  openMenu(e, [
    { label: 'Antworten', icon: 'reply', onClick: () => setReply(m) },
    { label: 'Weiterleiten', icon: 'forward', onClick: () => forwardMessage(m) },
    { label: starred ? 'Markierung entfernen' : 'Markieren', icon: 'star',
      onClick: () => { prefs.toggleStar(cur.chatId, m.id, starSnapshot(m)); renderThread(); } },
    mine && m.type === 'text' && !m.attachment
      ? { label: 'Bearbeiten', icon: 'edit', onClick: () => setEdit(m) } : null,
    (m.body || m.type === 'text')
      ? { label: 'Kopieren', icon: 'copy', onClick: () => {
          navigator.clipboard?.writeText(m.body || '').then(() => toast('Kopiert.')); } } : null,
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

  const ta = el('textarea', { rows: '1', placeholder: 'Nachricht schreiben …' });
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
    } catch (e) { toast(e.message, 'err'); ta.value = text; refreshRight(); }
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

function attachMenu(e) {
  openMenu(e, [
    { label: 'Foto / Video', icon: 'image', onClick: () => attach('image/*,video/*') },
    { label: 'Datei', icon: 'file', onClick: () => attach('') },
    { label: 'Umfrage', icon: 'poll', onClick: () => import('./groups.js').then((m) => m.newPollModal(cur.chatId)) },
    { label: 'Geplante Nachricht', icon: 'schedule', onClick: () => scheduleModal() },
  ]);
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

// ---- chat menu / info -----------------------------------------------------
function chatMenu(e, chat) {
  openMenu(e, [
    { label: 'Infos', icon: 'info', onClick: () => openChatInfo(chat) },
    { label: chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten', icon: 'mute', onClick: () => toggleMute(chat) },
    { label: 'Verschwindende Nachrichten', icon: 'clock', onClick: () => expireModal(chat) },
    { label: 'Geplante Nachrichten', icon: 'schedule', onClick: () => listScheduled() },
    { label: chat.archived ? 'Aus Archiv' : 'Archivieren', icon: 'archive', onClick: () => toggleArchive(chat) },
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
  import('./groups.js').then((m) => m.openChatInfo(chat))
    .catch(() => import('./contacts.js').then((m) => m.openProfile(chat.otherUser)));
}

function linkify(text) {
  return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
