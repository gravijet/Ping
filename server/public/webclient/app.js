/* app.js — Ping Web bootstrap. Owns the session lifecycle, builds the messenger
   shell (nav rail · list pane · main pane), switches between sections
   (Chats / Status / Anrufe / Gespeichert) and translates realtime socket events
   into store mutations the views react to. */

import { api, getToken, setToken, onUnauthorized, authedObjectUrl, clearBlobCache } from './api.js';
import * as socket from './socket.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, toast, setImageResolver } from './ui.js';
import { renderAuth } from './auth.js';
import { renderChatList } from './chats.js';
import { openChat, closeChat } from './chat.js';
import { newChatModal } from './contacts.js';
import { openSettings } from './settings.js';
import { wireCalls } from './calls.js';

setImageResolver(authedObjectUrl);
prefs.applyVisual();

const root = document.getElementById('app');

// ---- theme (kept exported: settings.js imports it) ------------------------
export function toggleTheme() { prefs.toggleTheme(); store.emit('prefs'); }

// ---- session lifecycle ----------------------------------------------------
onUnauthorized(() => doLogout(true));

async function boot() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api.get('/me');
    store.state.me = user;
    await enterApp();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { setToken(null); showAuth(); }
    else { showAuth(); toast(e.message || 'Verbindungsfehler', 'err'); }
  }
}

function showAuth() {
  closeChat();
  root.setAttribute('aria-busy', 'false');
  renderAuth(root, onAuthed);
}

async function onAuthed(token, user) {
  setToken(token);
  store.state.me = user;
  await enterApp();
}

export async function doLogout(silent) {
  socket.disconnect();
  setToken(null);
  clearBlobCache();
  store.state.chats.clear();
  store.state.messages.clear();
  store.state.me = null;
  store.state.activeId = null;
  if (!silent) toast('Abgemeldet.');
  showAuth();
}

// ---- the messenger shell --------------------------------------------------
let mainSlot = null;
let sideHead = null;
let sideBody = null;
let currentSection = 'chats';

async function enterApp() {
  root.setAttribute('aria-busy', 'false');
  buildShell();
  wireSocket();
  socket.connect(getToken());
  wireCalls();
  api.get('/config').then((c) => { store.state.config = c; }).catch(() => {});
  try {
    const { chats } = await api.get('/chats');
    store.setChats(chats);
  } catch (e) { toast(e.message || 'Chats konnten nicht geladen werden.', 'err'); }
  refreshBadges();
}

function buildShell() {
  const me = store.state.me;
  const navrail = buildNavRail(me);
  const side = el('aside', { class: 'side' }, [
    el('div', { class: 'side-head', id: 'side-head' }),
    el('div', { class: 'side-body', id: 'side-body' }),
  ]);
  sideHead = side.querySelector('#side-head');
  sideBody = side.querySelector('#side-body');

  const main = el('main', { class: 'main', id: 'main' }, splash());
  mainSlot = main;

  const shell = el('div', { class: 'shell', id: 'shell' }, [navrail, side, main]);
  clear(root).appendChild(shell);
  setSection('chats');
}

function buildNavRail(me) {
  const items = el('div', { class: 'nav-items', style: { display: 'contents' } }, [
    navItem('chats', 'chat', 'Chats'),
    navItem('status', 'status', 'Status'),
    navItem('calls', 'phone', 'Anrufe'),
    navItem('saved', 'star', 'Gespeichert'),
  ]);
  const isLight = () => prefs.get('theme') === 'light';
  const themeBtn = el('button', { class: 'nav-item', 'data-label': 'Design',
    title: 'Hell/Dunkel', onClick: () => { toggleTheme(); refreshThemeBtn(); } },
    icon(isLight() ? 'moon' : 'sun'));
  function refreshThemeBtn() { clear(themeBtn).appendChild(icon(isLight() ? 'moon' : 'sun')); }

  const navAvatar = el('div', { class: 'nav-avatar', id: 'nav-avatar', title: 'Profil & Einstellungen',
    onClick: openSettings }, avatar(me, 42, { kind: 'user' }));

  return el('aside', { class: 'navrail' }, [
    el('div', { class: 'nav-logo', text: 'P' }),
    items,
    el('div', { class: 'nav-spacer' }),
    themeBtn,
    el('button', { class: 'nav-item', 'data-label': 'Einstellungen', title: 'Einstellungen',
      onClick: openSettings }, icon('settings')),
    navAvatar,
  ]);
}

function navItem(section, iconName, label) {
  const b = el('button', { class: `nav-item ${currentSection === section ? 'active' : ''}`,
    'data-label': label, title: label, onClick: () => setSection(section) }, icon(iconName));
  b.dataset.section = section;
  return b;
}

function setSection(name) {
  currentSection = name;
  document.querySelectorAll('.nav-item[data-section]').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === name));
  renderSection();
  // On a phone we treat the list pane as the visible "page".
  document.getElementById('shell')?.classList.remove('has-active');
}

function renderSection() {
  if (!sideHead) return;
  clear(sideHead); clear(sideBody);
  if (currentSection === 'chats') return renderChatsSection();
  if (currentSection === 'status') {
    sideBody.append(loading());
    return import('./status.js').then((m) => m.renderStatusPane(sideHead, sideBody));
  }
  if (currentSection === 'calls') {
    sideBody.append(loading());
    return import('./calls-view.js').then((m) =>
      m.renderCallsPane(sideHead, sideBody, openChatInShell));
  }
  if (currentSection === 'saved') {
    sideBody.append(loading());
    return import('./saved.js').then((m) =>
      m.renderSavedPane(sideHead, sideBody, openChatInShell));
  }
}

function loading() { return el('div', { class: 'pane-empty', text: 'Lade …' }); }

function renderChatsSection() {
  sideHead.append(
    el('div', { class: 'pane-title', text: 'Chats' }),
    el('div', { class: 'actions' }, [
      iconBtn('edit', 'Neuer Chat', () => newChatModal()),
      iconBtn('group', 'Neue Gruppe', () => import('./groups.js').then((m) => m.newGroupModal())),
    ]),
  );
  const search = el('div', { class: 'search' }, [
    el('div', { class: 'search-box' }, [
      icon('search', 'sm'),
      el('input', {
        type: 'text', placeholder: 'Suchen oder neuen Chat starten', value: store.state.search || '',
        oninput: (e) => { store.state.search = e.target.value; store.emit('chats'); },
      }),
    ]),
  ]);
  const list = el('div', { class: `chatlist ${prefs.get('compact') ? 'compact' : ''}`, id: 'chatlist' });
  sideBody.append(search, list);
  renderChatList(list, (chatId) => openChatInShell(chatId));
}

function splash() {
  return el('div', { class: 'splash' }, [
    el('div', { class: 'glyph', text: 'P' }),
    el('h2', { text: 'Ping Web' }),
    el('p', { text: 'Wähle links einen Chat aus oder starte einen neuen. ' +
      'Deine Nachrichten werden in Echtzeit synchronisiert.' }),
    el('div', { class: 'lock' }, [icon('lock', 'sm'), el('span',
      { text: 'Verschlüsselt über HTTPS · kein Tracking' })]),
  ]);
}

export function showSplash() {
  if (mainSlot) clear(mainSlot).appendChild(splash());
  document.getElementById('shell')?.classList.remove('has-active');
}

function openChatInShell(chatId) {
  // Opening a chat always brings the user back to the Chats section context.
  if (currentSection !== 'chats') setSection('chats');
  store.state.activeId = chatId;
  prefs.setMarkedUnread(chatId, false);
  document.getElementById('shell')?.classList.add('has-active');
  openChat(mainSlot, chatId, { onBack: () => { store.state.activeId = null; showSplash();
    store.emit('chats'); } });
  store.emit('chats');
}
// Let other modules (search results, contacts, groups) jump into a chat.
export { openChatInShell };

function iconBtn(name, title, onClick) {
  return el('button', { class: 'iconbtn', title, onClick }, icon(name));
}

// ---- nav badges -----------------------------------------------------------
export function setNavBadge(section, count) {
  const item = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (!item) return;
  item.querySelector('.nav-badge')?.remove();
  if (count > 0) item.appendChild(el('span', { class: 'nav-badge',
    text: count > 99 ? '99+' : String(count) }));
}

function refreshBadges() {
  let unread = 0;
  for (const c of store.state.chats.values()) {
    if (c.unread) unread += 1;
    else if (prefs.isMarkedUnread(c.id)) unread += 1;
  }
  setNavBadge('chats', unread);
}

// ---- realtime: socket events → store --------------------------------------
let wired = false;
function wireSocket() {
  if (wired) return; wired = true;

  store.on('open-chat', (chatId) => openChatInShell(chatId));
  store.on('open-splash', () => showSplash());
  store.on('chats', refreshBadges);

  // Refresh the nav-rail avatar after the user edits their own profile.
  store.on('me-updated', () => {
    const me = store.state.me;
    const slot = document.getElementById('nav-avatar');
    if (slot && me) clear(slot).append(avatar(me, 42, { kind: 'user' }));
  });

  socket.on('ready', (p) => {
    if (p.online) store.setOnline(p.online);
    if (p.user) store.state.me = { ...store.state.me, ...p.user };
  });

  socket.on('presence', (p) => store.setPresence(p.userId, p.online, p.lastSeen));
  socket.on('chat-created', (p) => { if (p.chat) store.upsertChat(p.chat); });
  socket.on('message', (p) => applyIncomingMessage(p.message));
  socket.on('message-updated', (p) => {
    if (!p.message) return;
    store.replaceMessage(p.message.chatId, p.message);
  });
  socket.on('typing', (p) => store.setTyping(p.chatId, p.userId, p.typing));

  socket.on('receipt', (p) => {
    store.updateReceiptStatus(p.chatId, p.messageId, p.status);
    const chat = store.getChat(p.chatId);
    if (chat?.lastMessage?.id === p.messageId) { chat.lastMessage.status = p.status; store.emit('chats'); }
  });

  socket.on('read-self', (p) => {
    const chat = store.getChat(p.chatId);
    if (chat) { chat.unread = 0; store.emit('chats'); }
    for (const id of p.messageIds || []) {
      const hist = store.getHistory(p.chatId);
      const m = hist.find((x) => x.id === id);
      if (m && m.status) m.status = 'read';
    }
    store.emit('messages:' + p.chatId);
  });

  socket.on('user-updated', (p) => { if (p.user) store.emit('user:' + p.user.id, p.user); });
  socket.on('force-logout', () => { toast('Du wurdest abgemeldet.', 'err'); doLogout(true); });
  socket.onStatus((connected) => store.emit('connection', connected));
}

function applyIncomingMessage(msg) {
  if (!msg) return;
  const meId = store.state.me?.id;
  const isMine = msg.senderId === meId;
  const isActive = store.state.activeId === msg.chatId;

  store.addMessage(msg.chatId, msg);

  const chat = store.getChat(msg.chatId);
  if (chat) {
    chat.lastMessage = msg;
    chat.updatedAt = msg.createdAt;
    if (!isMine && !isActive) chat.unread = (chat.unread || 0) + 1;
    store.emit('chats');
  } else {
    api.get('/chats/' + msg.chatId).then(({ chat: c }) => store.upsertChat(c)).catch(() => {});
  }

  if (!isMine) {
    socket.send('delivered', { chatId: msg.chatId });
    if (isActive) socket.send('read', { chatId: msg.chatId });
    maybeNotify(msg, chat, isActive);
  }
}

// ---- desktop/browser notifications ----------------------------------------
function maybeNotify(msg, chat, isActive) {
  if (!prefs.get('notifEnabled')) return;
  if (isActive && document.hasFocus()) return;
  if (chat?.muted) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const title = chat?.title || 'Ping';
    const body = prefs.get('notifPreview')
      ? (msg.body || (msg.attachment ? '📎 Anhang' : 'Neue Nachricht'))
      : 'Neue Nachricht';
    const n = new Notification(title, { body, tag: msg.chatId, silent: false });
    n.onclick = () => { window.focus(); openChatInShell(msg.chatId); n.close(); };
  } catch { /* ignore */ }
}

boot();
