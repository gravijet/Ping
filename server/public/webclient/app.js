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
import { openChat, closeChat, toggleChatSearch } from './chat.js';
import { newChatModal } from './contacts.js';
import { openSettings } from './settings.js';
import { wireCalls } from './calls.js';
import { openPalette, paletteOpen } from './palette.js';
import { initLock } from './lock.js';
import * as native from './native.js';
import * as telemetry from './telemetry.js';
import * as outbox from './outbox.js';
import * as cache from './cache.js';
import * as syncqueue from './syncqueue.js';
import { flag } from './flags.js';
import * as activity from './activity.js';
import * as drafts from './drafts.js';
import * as reminders from './reminders.js';
import * as quickreplies from './quickreplies.js';
import * as focus from './focus.js';
import { openSearch } from './search.js';
import { mentionsUser } from './mentions.js';
import { openShortcuts, shortcutsOpen } from './shortcuts.js';
import { safeId } from './validate.js';
import { syncWebPush } from './webpush.js';
import { messagePreview } from './format.js';

setImageResolver(authedObjectUrl);
prefs.applyVisual();

// Boot the cross-cutting client services once, before anything renders:
// privacy-first diagnostics (local unless opted in), the offline send-queue,
// and the service worker that makes Ping installable + offline-capable.
telemetry.install();
outbox.install();
cache.install();
syncqueue.install();
registerServiceWorker();

// Mirror per-chat drafts to the server (debounced) so a half-typed message
// follows you across devices. Purely additive — drafts still work fully local.
const draftSyncTimers = new Map();
drafts.setSyncHandler((chatId, text) => {
  clearTimeout(draftSyncTimers.get(chatId));
  draftSyncTimers.set(chatId, setTimeout(() => {
    api.put(`/chats/${chatId}/draft`, { text }).catch(() => {});
  }, 700));
});

// Build a Saved-pane snapshot for a starred message pulled from the server.
function starSnapshotFor(m) {
  const chat = store.getChat(m.chatId);
  const sender = chat?.members?.find((u) => u.id === m.senderId) || chat?.otherUser;
  return {
    preview: messagePreview(m),
    senderName: sender?.displayName || '',
    chatTitle: chat?.title || '',
    createdAt: m.createdAt,
  };
}

// Pull the user's saved (starred) messages into the local star store, so the
// "Gespeichert" pane reflects stars set on any of their devices.
async function seedStars() {
  try {
    const { messages } = await api.get('/me/starred');
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
      if (!prefs.isStarred(m.chatId, m.id)) prefs.toggleStar(m.chatId, m.id, starSnapshotFor(m));
    }
    store.emit('prefs');
  } catch { /* offline — local stars stand */ }
}

const root = document.getElementById('app');

// ---- theme (kept exported: settings.js imports it) ------------------------
export function toggleTheme() { prefs.toggleTheme(); store.emit('prefs'); }
// Keep the nav-rail theme button's icon in sync when the theme is toggled from
// elsewhere (command palette, keyboard, settings).
export function refreshThemeNav() {
  const btn = document.getElementById('nav-theme');
  if (btn) clear(btn).appendChild(icon(prefs.isLight() ? 'moon' : 'sun'));
}

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
  cache.clearAll(); // never leave one account's chats cached for the next
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
  // Offline-first: replay the cached chat list before the first paint so the app
  // opens instantly (and works with no network); the live /chats fetch below
  // reconciles it a moment later.
  const hydrated = await cache.hydrateChats();
  buildShell();
  wireSocket();
  wireShortcuts();
  socket.connect(getToken());
  wireCalls();
  initLock();
  wireNative();
  api.get('/config').then((c) => { store.state.config = c; }).catch(() => {});
  try {
    const { chats } = await api.get('/chats');
    store.setChats(chats);
    // Hydrate server-synced drafts onto this device (only when nothing newer is
    // typed locally — drafts.hydrate is a no-op if the local text already wins).
    for (const c of chats || []) if (c.draft) drafts.hydrate(c.id, c.draft);
  } catch (e) {
    // With a cache we stay usable offline — don't alarm the user.
    if (!hydrated) toast(e.message || 'Chats konnten nicht geladen werden.', 'err');
  }
  // Folders + saved messages sync from the server (best-effort, never blocking).
  import('./folders.js').then((m) => m.loadFolders().then(() => {
    store.emit('folders'); if (currentSection === 'chats') renderSection();
  })).catch(() => {});
  seedStars();
  // Reminders + quick replies sync from the server (best-effort, never blocking).
  if (flag('reminders')) reminders.sync();
  if (flag('quickReplies')) quickreplies.sync();
  // Focus mode / quiet hours: load current state so the nav indicator is right.
  if (flag('focusMode')) focus.sync().then(refreshFocusNav);
  refreshBadges();
  refreshActivityBadge();
  updateConnectionBanner();
  handleDeepLink();
  // Re-establish (or tear down) the browser push subscription to match the
  // user's saved preference — silent, never prompts.
  syncWebPush(prefs.get('webPush')).catch(() => {});
  telemetry.track('app_ready', { chats: store.state.chats.size });
  prefetchModules();
}

// Once interactive, warm the lazily-imported section modules during idle time so
// the first navigation to Status / Anrufe / Gespeichert / Gruppen feels instant.
// Pure prefetch into the module + HTTP cache — any failure is ignored. Skipped
// entirely when the connection asks us to save data (Data-Saver / slow / 2g):
// the warm-up is a nicety, not worth a metered byte.
let prefetched = false;
async function prefetchModules() {
  if (prefetched) return; prefetched = true;
  if (flag('adaptiveData')) {
    try {
      const { prefersDataSaver } = await import('./device.js');
      if (prefersDataSaver()) { telemetry.track('prefetch_skipped_datasaver'); return; }
    } catch { /* device.js unavailable — prefetch as usual */ }
  }
  const mods = ['./status.js', './calls-view.js', './saved.js', './groups.js', './devices.js'];
  const run = () => { for (const m of mods) import(m).catch(() => {}); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
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
  const themeBtn = el('button', { class: 'nav-item', id: 'nav-theme', 'data-label': 'Design',
    title: 'Hell/Dunkel', onClick: () => { toggleTheme(); refreshThemeNav(); } },
    icon(prefs.isLight() ? 'moon' : 'sun'));

  // Activity / notifications bell — opens the feed; carries an unseen-count badge.
  const activityBtn = flag('activityCenter')
    ? el('button', { class: 'nav-item', id: 'nav-activity', 'data-label': 'Aktivität',
        title: 'Aktivität', onClick: () => activity.openActivityPanel(openChatInShell) }, icon('bell'))
    : null;

  // Global full-text search — opens the dedicated search surface.
  const searchBtn = flag('messageSearch')
    ? el('button', { class: 'nav-item', id: 'nav-search', 'data-label': 'Suche',
        title: 'Suche (Strg/⌘ K)', onClick: () => openSearch(openChatInShell) }, icon('search'))
    : null;

  // Focus / quiet-hours toggle — lights up while push is being held back.
  const focusBtn = flag('focusMode')
    ? el('button', { class: 'nav-item', id: 'nav-focus', 'data-label': 'Fokus',
        title: 'Fokus & Ruhezeiten', onClick: () => focus.openFocus() }, icon('moon'))
    : null;

  const navAvatar = el('div', { class: 'nav-avatar', id: 'nav-avatar', title: 'Profil & Einstellungen',
    onClick: openSettings }, avatar(me, 42, { kind: 'user' }));

  return el('aside', { class: 'navrail' }, [
    el('div', { class: 'nav-logo', text: 'P' }),
    items,
    el('div', { class: 'nav-spacer' }),
    searchBtn,
    focusBtn,
    activityBtn,
    themeBtn,
    el('button', { class: 'nav-item', 'data-label': 'Einstellungen', title: 'Einstellungen',
      onClick: openSettings }, icon('settings')),
    navAvatar,
  ]);
}

// Reflect the unseen activity count on the nav-rail bell.
function refreshActivityBadge() {
  const btn = document.getElementById('nav-activity');
  if (!btn) return;
  btn.querySelector('.nav-badge')?.remove();
  const n = activity.unseenCount();
  if (n > 0) btn.appendChild(el('span', { class: 'nav-badge', text: n > 99 ? '99+' : String(n) }));
}

// Light up the nav-rail focus button while push is being held back, and show a
// small badge so the state is obvious at a glance.
function refreshFocusNav() {
  const btn = document.getElementById('nav-focus');
  if (!btn) return;
  const on = flag('focusMode') && focus.isSilenced();
  btn.classList.toggle('focus-on', on);
  btn.querySelector('.nav-dot')?.remove();
  if (on) btn.appendChild(el('span', { class: 'nav-dot', 'aria-hidden': 'true' }));
  btn.title = on ? 'Fokus aktiv — Benachrichtigungen pausiert' : 'Fokus & Ruhezeiten';
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
  // Subtle, reduced-motion-safe entrance on section switch.
  sideBody.classList.remove('fade-in'); void sideBody.offsetWidth; sideBody.classList.add('fade-in');
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
      iconBtn('doublecheck', 'Alle als gelesen', markAllRead),
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
  sideBody.append(search, buildChatFilters(), list);
  renderChatList(list, (chatId) => openChatInShell(chatId));
}

// Quick filters above the chat list: the built-ins (Alle · Ungelesen ·
// Favoriten · Gruppen) followed by the user's folders and a "+" to manage them.
function buildChatFilters() {
  const builtins = [['all', 'Alle'], ['unread', 'Ungelesen'], ['fav', 'Favoriten'], ['groups', 'Gruppen']];
  const folders = (store.state.folders || []).map((f) => [
    'folder:' + f.id, (f.emoji ? f.emoji + ' ' : '') + f.name,
  ]);
  const seg = el('div', { class: 'seg chat-filters' });
  const select = (id) => {
    store.state.chatFilter = id;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.filter === id));
    store.emit('chats');
  };
  for (const [id, label] of [...builtins, ...folders]) {
    seg.appendChild(el('button', { class: store.state.chatFilter === id ? 'on' : '',
      dataset: { filter: id }, onClick: () => select(id) }, label));
  }
  seg.appendChild(el('button', { class: 'chat-filter-add', dataset: { filter: '__manage' },
    title: 'Ordner verwalten', 'aria-label': 'Ordner verwalten',
    onClick: () => import('./folders.js').then((m) => m.openFolderManager()) }, icon('plus', 'sm')));
  return seg;
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

function openChatInShell(chatId, messageId) {
  // Opening a chat always brings the user back to the Chats section context.
  if (currentSection !== 'chats') setSection('chats');
  store.state.activeId = chatId;
  prefs.setMarkedUnread(chatId, false);
  store.clearMention(chatId);
  document.getElementById('shell')?.classList.add('has-active');
  openChat(mainSlot, chatId, { focusMessageId: messageId, onBack: () => {
    store.state.activeId = null; showSplash(); store.emit('chats'); } });
  store.emit('chats');
}
// Let other modules (search results, contacts, groups) jump into a chat.
export { openChatInShell };

function iconBtn(name, title, onClick) {
  return el('button', { class: 'iconbtn', title, onClick }, icon(name));
}

// Mark every chat as read (clears unread counts + the manual "unread" flag).
async function markAllRead() {
  const chats = [...store.state.chats.values()];
  for (const c of chats) {
    prefs.setMarkedUnread(c.id, false);
    if (c.unread) {
      try { await api.post(`/chats/${c.id}/read`); } catch { /* ignore */ }
      c.unread = 0;
    }
  }
  store.emit('chats');
  toast('Alle als gelesen markiert.', 'ok');
}

// ---- command palette ------------------------------------------------------
// One searchable surface for jumping to chats and running common actions, so
// these never need to live in a dozen separate menus.
export function openCommandPalette() {
  if (paletteOpen()) return;
  const cmds = [
    { title: 'Neuer Chat', icon: 'edit', keywords: 'new chat kontakt nachricht', run: () => newChatModal() },
    { title: 'Neue Gruppe', icon: 'group', keywords: 'group gruppe', run: () => import('./groups.js').then((m) => m.newGroupModal()) },
    { title: 'Nachrichten durchsuchen', icon: 'search', keywords: 'search suche finden volltext', run: () => {
      if (flag('messageSearch')) return openSearch(openChatInShell);
      setSection('chats'); setTimeout(() => document.querySelector('.search-box input')?.focus(), 0); } },
    flag('focusMode') ? { title: 'Fokus & Ruhezeiten', icon: 'moon', keywords: 'focus fokus ruhe dnd nicht stören still quiet hours auto-antwort', run: () => focus.openFocus() } : null,
    { title: 'Chats', icon: 'chat', keywords: 'unterhaltungen', run: () => setSection('chats') },
    { title: 'Status', icon: 'status', keywords: 'stories', run: () => setSection('status') },
    { title: 'Anrufe', icon: 'phone', keywords: 'calls anrufverlauf', run: () => setSection('calls') },
    { title: 'Gespeichert', icon: 'star', keywords: 'saved starred markiert', run: () => setSection('saved') },
    { title: 'Einstellungen', icon: 'settings', hint: 'Strg ,', keywords: 'settings profil konto', run: () => openSettings() },
    flag('activityCenter') ? { title: 'Aktivität', icon: 'bell', keywords: 'activity benachrichtigungen feed reaktionen erwähnungen', run: () => activity.openActivityPanel(openChatInShell) } : null,
    flag('reminders') ? { title: 'Erinnerungen', icon: 'clock', keywords: 'erinnerung erinnere reminder nudge fällig', run: () => reminders.openReminders(openChatInShell) } : null,
    { title: 'Tastenkürzel', icon: 'bolt', hint: '?', keywords: 'shortcuts keyboard tastatur hilfe', run: () => openShortcuts() },
    { title: 'Design wechseln', icon: 'moon', keywords: 'theme dark light hell dunkel', run: () => { toggleTheme(); refreshThemeNav(); } },
    { title: 'App sperren', icon: 'lock', keywords: 'lock pin sperre privat', run: () => import('./lock.js').then((m) => m.lockNow()) },
    { title: 'Gerät verknüpfen', icon: 'link', keywords: 'device link qr handy', run: () => import('./devices.js').then((m) => m.linkDeviceModal()) },
    flag('shareButtons') ? { title: 'Ping teilen / einladen', icon: 'forward', keywords: 'share invite teilen einladen link freunde', run: () => import('./share.js').then((m) => m.shareInvite()) } : null,
    flag('debugPanel') ? { title: 'Debug & Diagnose', icon: 'bolt', hint: 'Strg ⇧ D', keywords: 'debug diagnose entwickler flags logs absturz', run: () => import('./debug.js').then((m) => m.openDebugPanel()) } : null,
    { title: 'Abmelden', icon: 'logout', keywords: 'logout signout', run: () => doLogout(false) },
  ].filter(Boolean);
  openPalette({ commands: cmds, onOpenChat: openChatInShell });
}

// ---- keyboard shortcuts ---------------------------------------------------
let shortcutsWired = false;
function wireShortcuts() {
  if (shortcutsWired) return; shortcutsWired = true;
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    // "?" (Shift+/) — keyboard shortcut cheat sheet. Ignored while typing.
    if (!mod && e.key === '?') {
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      if (!shortcutsOpen()) { e.preventDefault(); openShortcuts(); }
      return;
    }
    // Ctrl/⌘+K — open the command palette.
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCommandPalette(); return; }
    // Ctrl/⌘+, — open settings.
    if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
    // Ctrl/⌘+N — new chat.
    if (mod && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); newChatModal(); return; }
    // Ctrl/⌘+F — search within the open conversation.
    if (mod && (e.key === 'f' || e.key === 'F')) {
      if (store.state.activeId) { e.preventDefault(); toggleChatSearch(); }
      return;
    }
    // Ctrl/⌘+Shift+D — developer & diagnostics panel.
    if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      if (flag('debugPanel')) { e.preventDefault(); import('./debug.js').then((m) => m.openDebugPanel()); }
      return;
    }
    // Alt+↑/↓ — move to the previous / next chat.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); switchChat(e.key === 'ArrowDown' ? 1 : -1); return;
    }
  });
}

// Jump to the previous/next chat in the visible (non-archived) list.
function switchChat(dir) {
  const list = store.chatsSorted().filter((c) => !c.archived);
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === store.state.activeId);
  const next = list[(i + dir + list.length) % list.length] || list[0];
  if (next) { if (currentSection !== 'chats') setSection('chats'); openChatInShell(next.id); }
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
  let unreadTotal = 0;
  for (const c of store.state.chats.values()) {
    if (c.unread) { unread += 1; unreadTotal += c.unread; }
    else if (prefs.isMarkedUnread(c.id)) unread += 1;
  }
  setNavBadge('chats', unread);
  // Mirror the total onto the Windows taskbar icon when running in the shell.
  native.setUnread(unreadTotal);
  // …and onto the OS app icon of an installed PWA (App Badging API). A genuine
  // OS-level badge that survives the tab being closed; cleared at zero.
  try {
    if ('setAppBadge' in navigator) {
      if (unreadTotal > 0) navigator.setAppBadge(unreadTotal);
      else navigator.clearAppBadge?.();
    }
  } catch { /* unsupported / permission — ignore */ }
}

// ---- Windows desktop bridge (no-ops in a normal browser) ------------------
let nativeWired = false;
function wireNative() {
  if (nativeWired || !native.isShell()) return;
  nativeWired = true;
  native.onNative('open-chat', (d) => { if (d.chatId) { window.focus?.(); openChatInShell(d.chatId); } });
  native.onNative('lock', () => import('./lock.js').then((m) => m.lockNow()));
  native.onNative('settings', () => openSettings());
  native.onNative('command', () => openCommandPalette());
  native.onNative('new-chat', () => newChatModal());
  // "Als gelesen" from a desktop toast action: clear the chat's unread state.
  native.onNative('mark-read', async (d) => {
    if (!d.chatId) return;
    try { await api.post(`/chats/${d.chatId}/read`); } catch { /* offline */ }
    const c = store.getChat(d.chatId);
    if (c && c.unread) { c.unread = 0; store.emit('chats'); }
    refreshBadges();
  });
  // "Nicht stören" from the tray: silence notifications for a while.
  native.onNative('dnd', (d) => {
    const mins = Number(d.minutes) || 60;
    prefs.set('dndUntil', Date.now() + mins * 60000);
    toast('Nicht stören aktiviert.', 'ok');
  });
  // Sync the host with the user's saved desktop preferences.
  native.setAutostart(prefs.get('desktopAutostart'));
  native.setCloseToTray(prefs.get('desktopCloseToTray'));
}

// ---- realtime: socket events → store --------------------------------------
let wired = false;
function wireSocket() {
  if (wired) return; wired = true;

  store.on('open-chat', (chatId) => openChatInShell(chatId));
  store.on('open-splash', () => showSplash());
  store.on('chats', refreshBadges);
  // Keep the nav-rail focus indicator in sync with the focus/quiet-hours state.
  store.on('focus', refreshFocusNav);
  // Rebuild the chat-list filter bar whenever the folder set changes.
  store.on('folders', () => { if (currentSection === 'chats') renderSection(); });
  // Keep the nav-rail bell badge in sync as activity is recorded.
  activity.onChange(refreshActivityBadge);

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
  socket.on('chat-created', (p) => {
    if (!p.chat) return;
    const fresh = !store.getChat(p.chat.id);
    store.upsertChat(p.chat);
    if (fresh) activity.record({ kind: 'newchat', chatId: p.chat.id, title: p.chat.title,
      text: p.chat.type === 'group' ? 'Du wurdest zu einer Gruppe hinzugefügt' : 'Neuer Chat' });
  });
  socket.on('message', (p) => applyIncomingMessage(p.message));
  socket.on('message-updated', (p) => {
    if (!p.message) return;
    maybeReactionActivity(p.message); // compare BEFORE we overwrite the cached copy
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

  // 0.27.0 — pins / stars / drafts / folders sync events.
  socket.on('chat-pins-updated', (p) => {
    const chat = store.getChat(p.chatId);
    if (chat) chat.pinnedCount = p.count || 0;
    store.emit('pins:' + p.chatId, p); // the open chat refreshes its banner
  });
  socket.on('starred-updated', () => { seedStars(); });
  socket.on('draft-updated', (p) => {
    drafts.hydrate(p.chatId, p.text || '');
    store.emit('chats'); // refresh the "✎ Entwurf" hint
  });
  socket.on('folders-updated', (p) => {
    if (Array.isArray(p.folders)) store.state.folders = p.folders;
    store.emit('folders'); // the store.on('folders') subscription re-renders
  });
  // Reminders: a due one firing, or list changes from another device.
  socket.on('reminder', (p) => { if (p.reminder) reminders.onFired(p.reminder); });
  socket.on('reminder-created', (p) => { if (p.reminder) reminders.onCreated(p.reminder); });
  socket.on('reminder-deleted', (p) => { if (p.id) reminders.onDeleted(p.id); });
  // Quick replies: kept in sync across this user's devices.
  socket.on('quick-replies-updated', (p) => quickreplies.apply(p.quickReplies));

  socket.on('focus-updated', (p) => { if (p.focus) focus.apply(p.focus); });

  socket.on('force-logout', () => { toast('Du wurdest abgemeldet.', 'err'); doLogout(true); });
  socket.onStatus((connected) => store.emit('connection', connected));

  // Connection banner reacts to realtime status + the browser's own online/offline.
  store.on('connection', updateConnectionBanner);
  window.addEventListener('online', updateConnectionBanner);
  window.addEventListener('offline', updateConnectionBanner);
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
    // @-mention of me in a group: badge the chat (until opened) + log activity.
    if (flag('mentions') && chat?.type === 'group' && mentionsUser(msg.body, chat, meId)) {
      if (!isActive) store.setMention(msg.chatId);
      activity.record({ kind: 'mention', chatId: msg.chatId, key: `mention:${msg.id}`,
        title: chat?.title || 'Erwähnung', text: 'Du wurdest erwähnt' });
    }
    syncqueue.markDelivered(msg.chatId);
    if (isActive) syncqueue.markRead(msg.chatId);
    maybeNotify(msg, chat, isActive);
  }
}

// When a realtime message-update lands on one of MY messages with a newly added
// reaction, surface it in the activity feed. Runs before the store copy is
// replaced so we can diff old vs new reaction counts.
function maybeReactionActivity(updated) {
  const meId = store.state.me?.id;
  if (!meId || updated.senderId !== meId) return;
  const prev = store.getHistory(updated.chatId).find((m) => m.id === updated.id);
  if (!prev) return;
  const before = prev.reactions || {};
  const after = updated.reactions || {};
  let emoji = null;
  let best = 0;
  for (const [e, n] of Object.entries(after)) {
    const delta = n - (before[e] || 0);
    if (delta > best) { best = delta; emoji = e; }
  }
  if (!emoji) return;
  const chat = store.getChat(updated.chatId);
  activity.record({ kind: 'reaction', chatId: updated.chatId, emoji,
    key: `reaction:${updated.id}:${emoji}`, title: chat?.title || 'Reaktion',
    text: `${emoji} auf deine Nachricht` });
}

// ---- desktop/browser notifications ----------------------------------------
function maybeNotify(msg, chat, isActive) {
  if (!prefs.get('notifEnabled')) return;
  if ((prefs.get('dndUntil') || 0) > Date.now()) return; // Do Not Disturb
  if (isActive && document.hasFocus()) return;
  if (chat?.muted) return;
  const title = chat?.title || 'Ping';
  const body = prefs.get('notifPreview')
    ? (msg.body || (msg.attachment ? '📎 Anhang' : 'Neue Nachricht'))
    : 'Neue Nachricht';
  // In the Windows shell the host owns OS notifications + the tray (it can show
  // them even when the window is hidden); fall back to the Web Notification API.
  if (native.isShell()) {
    native.nativeNotify({ title, body, chatId: msg.chatId });
    if (prefs.get('notifSound')) playChime();
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: msg.chatId, silent: prefs.get('notifSound') });
    n.onclick = () => { window.focus(); openChatInShell(msg.chatId); n.close(); };
    if (prefs.get('notifSound')) playChime();
  } catch { /* ignore */ }
}

// A short, soft two-tone chime synthesised on the fly (no audio asset needed).
let audioCtx = null;
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [[880, 0], [1175, 0.11]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.24);
    });
  } catch { /* audio not available */ }
}

// ---- service worker -------------------------------------------------------
// Registers /sw.js for offline support + installability. The worker is a pure
// enhancement: if registration fails the app still works, just online-only.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return; // not file:// or odd shells
  let reloading = false;
  // When the new worker takes control (after the user accepts), reload once so
  // the freshly cached assets are the ones actually running.
  navigator.serviceWorker.addEventListener?.('controllerchange', () => {
    if (reloading) return; reloading = true; location.reload();
  });
  // Messages from the worker: a tapped push notification asks us to open a chat;
  // a "mark read" action asks us to refresh the unread badges.
  navigator.serviceWorker.addEventListener?.('message', (e) => {
    const d = e.data || {};
    if (d.type === 'open-chat' && d.chatId) {
      window.focus?.();
      if (store.getChat(d.chatId)) openChatInShell(d.chatId);
    } else if (d.type === 'refresh-badges') {
      refreshBadges();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // A build that finished installing before this load is already waiting.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // Installed over an existing controller → a new version is ready. Ask
          // the user rather than silently swapping assets mid-session.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(sw);
        });
      });
    }).catch(() => { /* enhancement only */ });
  });
}

// A slim, dismissible banner offering to load a freshly deployed version.
let updateOffered = false;
function offerUpdate(worker) {
  if (updateOffered) return; updateOffered = true;
  const bar = el('div', { class: 'update-banner', role: 'status' }, [
    el('span', { text: 'Eine neue Version von Ping ist verfügbar.' }),
    el('button', { class: 'btn primary sm', onClick: () => worker.postMessage('skip-waiting') }, 'Neu laden'),
    el('button', { class: 'iconbtn', title: 'Später', onClick: () => bar.remove() }, icon('close')),
  ]);
  document.body.appendChild(bar);
}

// ---- connection banner ----------------------------------------------------
// A slim bar that surfaces "offline" / "reconnecting" so a dropped connection
// never feels like the app silently broke. Hidden while fully connected.
let connBanner = null;
function updateConnectionBanner() {
  if (!flag('connectionBanner')) return;
  if (!connBanner) {
    connBanner = el('div', { class: 'conn-banner', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(connBanner);
  }
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const connected = socket.isConnected();
  if (!store.state.me) { connBanner.className = 'conn-banner'; return; }
  if (!online) {
    connBanner.textContent = 'Offline – neue Nachrichten werden gesendet, sobald du wieder verbunden bist.';
    connBanner.className = 'conn-banner show offline';
  } else if (!connected) {
    connBanner.textContent = 'Verbindung wird wiederhergestellt …';
    connBanner.className = 'conn-banner show reconnecting';
  } else {
    connBanner.className = 'conn-banner';
  }
}

// ---- deep links -----------------------------------------------------------
// Supports ?chat=<id> (open a conversation you're a member of) for shareable
// links. The query is cleared from the URL afterwards so a refresh is clean.
function handleDeepLink() {
  try {
    const params = new URLSearchParams(location.search);
    const chatId = safeId(params.get('chat'));
    if (chatId && store.getChat(chatId)) openChatInShell(chatId);
    // ?u=<userId> — open a person's profile card (and offer to start a chat).
    const userId = safeId(params.get('u'));
    if (userId && flag('profileLinks')) openProfileById(userId);
    // PWA app-shortcuts (manifest) land here as query params.
    if (params.get('compose') === '1') newChatModal();
    if (params.get('view') === 'activity' && flag('activityCenter')) activity.openActivityPanel(openChatInShell);
    if (chatId || userId || params.get('invite') || params.get('compose') || params.get('view')) {
      history.replaceState(null, '', location.pathname);
    }
  } catch { /* malformed URL — ignore */ }
}

// Resolve a shared ?u=<id> to its public profile card. Auth is already
// established here (handleDeepLink runs after the session is up).
async function openProfileById(userId) {
  try {
    const { user } = await api.get('/users/' + userId);
    if (user) { const c = await import('./contacts.js'); c.openProfile(user); }
  } catch (e) {
    toast(e.status === 404 ? 'Dieses Profil gibt es nicht.' : (e.message || 'Profil konnte nicht geladen werden.'), 'err');
  }
}

boot();
