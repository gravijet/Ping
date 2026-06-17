/* prefs.js — local, device-side preferences (no server round-trip). Owns the
   things the native apps also keep on-device: theme, accent colour, chat
   wallpaper, accessibility toggles, plus per-device chat state that has no
   server endpoint (pinned chats, starred messages, "marked unread"). Persisted
   to localStorage and applied to :root so the whole CSS re-themes instantly. */

const KEY = 'ping.prefs';

const DEFAULTS = {
  theme: 'dark',          // 'dark' | 'light'
  accent: '#4d9bff',
  wallpaper: '',          // '' | preset id | data URL
  fontScale: 1,           // 0.9 .. 1.3
  compact: false,         // denser chat list
  largeEmoji: true,       // emoji-only messages render bigger
  highContrast: false,
  reduceMotion: false,
  enterToSend: true,
  notifEnabled: false,    // browser notifications
  notifPreview: true,
  readReceipts: true,     // cosmetic on web (server doesn't gate it)
  pinned: [],             // chatId[]
  markedUnread: [],       // chatId[]
  starred: {},            // chatId -> messageId[]   (fast membership lookup)
  starredSnap: {},        // "chatId:msgId" -> snapshot for the Saved pane
};

export const ACCENTS = ['#4d9bff', '#7b6cff', '#3fe0bd', '#ff8a5b', '#f472b6',
  '#34d399', '#fbbf24', '#ff5d73'];

export const WALLPAPERS = [
  { id: '', label: 'Standard', css: '' },
  { id: 'aurora', label: 'Aurora', css: 'radial-gradient(120% 90% at 0% 0%, #1b2b54, transparent 55%), radial-gradient(120% 90% at 100% 100%, #2a1b54, transparent 55%), #0a0e1a' },
  { id: 'sunset', label: 'Sonnenuntergang', css: 'linear-gradient(160deg, #2b1a3a, #3a1f2a 60%, #0a0e1a)' },
  { id: 'forest', label: 'Wald', css: 'linear-gradient(160deg, #0f2a24, #0a1c2a 60%, #070b14)' },
  { id: 'mono', label: 'Schiefer', css: 'linear-gradient(160deg, #14181f, #0a0c11)' },
];

let prefs = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Migrate the old standalone theme key.
    const legacyTheme = localStorage.getItem('ping.theme');
    return { ...DEFAULTS, ...(legacyTheme ? { theme: legacyTheme } : {}), ...raw };
  } catch { return { ...DEFAULTS }; }
}

function persist() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} }

export function get(k) { return prefs[k]; }
export function set(k, v) { prefs[k] = v; persist(); if (VISUAL.has(k)) applyVisual(); }
export function all() { return { ...prefs }; }

const VISUAL = new Set(['theme', 'accent', 'wallpaper', 'fontScale', 'highContrast', 'reduceMotion']);

export function applyVisual() {
  const r = document.documentElement;
  r.setAttribute('data-theme', prefs.theme);
  r.setAttribute('data-contrast', prefs.highContrast ? 'high' : 'normal');
  r.setAttribute('data-motion', prefs.reduceMotion ? 'reduce' : 'full');
  r.style.setProperty('--accent', prefs.accent || DEFAULTS.accent);
  r.style.setProperty('--font-scale', String(prefs.fontScale || 1));
  const wp = WALLPAPERS.find((w) => w.id === prefs.wallpaper);
  const css = prefs.wallpaper && prefs.wallpaper.startsWith('data:')
    ? `center / cover no-repeat url(${prefs.wallpaper})`
    : (wp ? wp.css : '');
  document.body.style.setProperty('--chat-wallpaper', css || 'none');
}

export function toggleTheme() {
  set('theme', prefs.theme === 'dark' ? 'light' : 'dark');
}

// ---- per-device chat state ------------------------------------------------
const has = (arr, id) => arr.includes(id);
export const isPinned = (id) => has(prefs.pinned, id);
export function togglePin(id) {
  prefs.pinned = isPinned(id) ? prefs.pinned.filter((x) => x !== id) : [id, ...prefs.pinned];
  persist();
}
export const isMarkedUnread = (id) => has(prefs.markedUnread, id);
export function setMarkedUnread(id, on) {
  prefs.markedUnread = on
    ? [...new Set([...prefs.markedUnread, id])]
    : prefs.markedUnread.filter((x) => x !== id);
  persist();
}

export const isStarred = (chatId, msgId) => (prefs.starred[chatId] || []).includes(msgId);
export function toggleStar(chatId, msgId, snapshot) {
  const list = prefs.starred[chatId] || [];
  const key = `${chatId}:${msgId}`;
  if (list.includes(msgId)) {
    prefs.starred[chatId] = list.filter((x) => x !== msgId);
    delete prefs.starredSnap[key];
  } else {
    prefs.starred[chatId] = [...list, msgId];
    if (snapshot) prefs.starredSnap[key] = { chatId, msgId, ...snapshot };
  }
  if (!prefs.starred[chatId].length) delete prefs.starred[chatId];
  persist();
}
export function starredEntries() {
  // Newest first; falls back to a bare {chatId,msgId} if there's no snapshot.
  const out = [];
  for (const [chatId, ids] of Object.entries(prefs.starred)) {
    for (const msgId of ids) out.push(prefs.starredSnap[`${chatId}:${msgId}`] || { chatId, msgId });
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
