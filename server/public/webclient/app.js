/* app.js — Ping Web bootstrap. Owns the session lifecycle, builds the messenger
   shell, and translates realtime socket events into store mutations that the
   views react to. */

import { api, getToken, setToken, onUnauthorized, authedObjectUrl, clearBlobCache } from './api.js';
import * as socket from './socket.js';
import * as store from './store.js';
import { el, clear, icon, avatar, toast, openMenu, setImageResolver } from './ui.js';
import { renderAuth } from './auth.js';
import { renderChatList } from './chats.js';
import { openChat, closeChat } from './chat.js';
import { newChatModal } from './contacts.js';
import { openSettings } from './settings.js';
import { wireCalls } from './calls.js';

setImageResolver(authedObjectUrl);

const root = document.getElementById('app');

// ---- theme ----------------------------------------------------------------
const THEME_KEY = 'ping.theme';
export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}
export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'light' ? 'dark' : 'light');
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

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

async function enterApp() {
  root.setAttribute('aria-busy', 'false');
  buildShell();
  wireSocket();
  socket.connect(getToken());
  wireCalls();
  // Load config (feature flags / maintenance) and the chat list in parallel.
  api.get('/config').then((c) => { store.state.config = c; }).catch(() => {});
  try {
    const { chats } = await api.get('/chats');
    store.setChats(chats);
  } catch (e) { toast(e.message || 'Chats konnten nicht geladen werden.', 'err'); }
}

function buildShell() {
  const me = store.state.me;
  const side = el('aside', { class: 'side' }, [
    el('div', { class: 'side-head' }, [
      el('div', { class: 'me', title: 'Profil & Einstellungen', onClick: openSettings }, [
        avatar(me, 40),
        el('div', { class: 'name', text: me.displayName }),
      ]),
      el('div', { class: 'actions' }, [
        iconBtn('status', 'Status', () => import('./status.js').then((m) => m.openStatus())),
        iconBtn('edit', 'Neuer Chat', () => newChatModal()),
        iconBtn('menu', 'Menü', (e) => mainMenu(e)),
      ]),
    ]),
    el('div', { class: 'search' }, [
      el('div', { class: 'search-box' }, [
        icon('search', 'sm'),
        el('input', {
          type: 'text', placeholder: 'Suchen oder neuen Chat starten',
          oninput: (e) => { store.state.search = e.target.value; store.emit('chats'); },
        }),
      ]),
    ]),
    el('div', { class: 'chatlist', id: 'chatlist' }),
  ]);

  const main = el('main', { class: 'main', id: 'main' }, splash());
  mainSlot = main;

  const shell = el('div', { class: 'shell', id: 'shell' }, [side, main]);
  clear(root).appendChild(shell);

  renderChatList(side.querySelector('#chatlist'), (chatId) => openChatInShell(chatId));
}

function splash() {
  return el('div', { class: 'splash' }, [
    el('div', { class: 'glyph', text: 'Ping' }),
    el('h2', { text: 'Ping Web' }),
    el('p', { text: 'Wähle links einen Chat aus oder starte einen neuen. ' +
      'Deine Nachrichten werden in Echtzeit synchronisiert.' }),
    el('div', { class: 'lock' }, [icon('lock', 'sm'), el('span',
      { text: 'Ende-zu-Server verschlüsselt über HTTPS' })]),
  ]);
}

export function showSplash() {
  if (mainSlot) clear(mainSlot).appendChild(splash());
  document.getElementById('shell')?.classList.remove('has-active');
}

function openChatInShell(chatId) {
  store.state.activeId = chatId;
  document.getElementById('shell')?.classList.add('has-active');
  openChat(mainSlot, chatId, { onBack: () => { store.state.activeId = null; showSplash();
    store.emit('chats'); } });
  store.emit('chats'); // refresh active highlight
}

function iconBtn(name, title, onClick) {
  return el('button', { class: 'iconbtn', title, onClick }, icon(name));
}

function mainMenu(e) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  openMenu(e, [
    { label: 'Neue Gruppe', icon: 'group', onClick: () =>
      import('./groups.js').then((m) => m.newGroupModal()) },
    { label: 'Status', icon: 'status', onClick: () =>
      import('./status.js').then((m) => m.openStatus()) },
    { label: 'Einstellungen', icon: 'settings', onClick: openSettings },
    { label: isLight ? 'Dunkles Design' : 'Helles Design',
      icon: isLight ? 'moon' : 'sun', onClick: toggleTheme },
    { sep: true },
    { label: 'Abmelden', icon: 'logout', danger: true, onClick: () => doLogout(false) },
  ]);
}

// ---- realtime: socket events → store --------------------------------------
let wired = false;
function wireSocket() {
  if (wired) return; wired = true;

  // Other views ask the shell to open a chat (after creating/looking one up).
  store.on('open-chat', (chatId) => openChatInShell(chatId));
  store.on('open-splash', () => showSplash());

  // Refresh the sidebar identity after the user edits their own profile.
  store.on('me-updated', () => {
    const me = store.state.me;
    const slot = document.querySelector('.side-head .me');
    if (slot && me) clear(slot).append(avatar(me, 40), el('div', { class: 'name', text: me.displayName }));
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
    // We don't know this chat yet — fetch it so the list stays correct.
    api.get('/chats/' + msg.chatId).then(({ chat: c }) => store.upsertChat(c)).catch(() => {});
  }

  if (!isMine) {
    socket.send('delivered', { chatId: msg.chatId });
    if (isActive) socket.send('read', { chatId: msg.chatId });
  }
}

boot();
