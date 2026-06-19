/* prefs.js — local, device-side preferences (no server round-trip). Owns the
   things the native apps also keep on-device: theme, accent colour, chat
   wallpaper, accessibility toggles, plus per-device chat state that has no
   server endpoint (pinned chats, starred messages, "marked unread"). Persisted
   to localStorage and applied to :root so the whole CSS re-themes instantly. */

const KEY = 'ping.prefs';

const DEFAULTS = {
  theme: 'system',        // 'dark' | 'light' | 'system' (follows the OS)
  amoled: false,          // AMOLED true-black variant of the dark theme
  accent: '#4d9bff',
  wallpaper: '',          // '' | preset id | data URL
  fontScale: 1,           // 0.9 .. 1.3
  compact: false,         // denser chat list
  largeEmoji: true,       // emoji-only messages render bigger
  highContrast: false,
  reduceMotion: false,
  underlineLinks: false,  // always underline links (accessibility)
  bigTargets: false,      // larger tap/click targets (accessibility)
  enterToSend: true,
  spellcheck: true,       // browser spellcheck in the composer
  sendTyping: true,       // broadcast "tippt …" to the other side
  notifEnabled: false,    // browser notifications
  notifPreview: true,
  notifSound: true,       // play a soft chime with each notification
  callRingtone: true,     // play a ringtone for incoming / a ringback for outgoing calls
  dndUntil: 0,            // suppress notifications until this timestamp (Do Not Disturb)
  bubbleStyle: 'rounded', // 'rounded' | 'square' chat bubbles
  fontFamily: 'jakarta',  // 'jakarta' | 'system' | 'serif' | 'mono' — app-wide typeface
  messageFormatting: true, // render *bold* _italic_ ~strike~ `code` ||spoiler||
  quickReplies: ['👍 Alles klar!', 'Bin gleich da 🏃', 'Melde mich später 🙂',
    'Danke dir! 🙏', 'Kannst du kurz anrufen?'], // canned composer replies
  readReceipts: true,     // cosmetic on web (server doesn't gate it)
  lockEnabled: false,     // app PIN lock on this device
  lockHash: '',           // SHA-256(salt:pin)
  lockSalt: '',           // random per-device salt
  lockTimeoutMs: 120000,  // auto-lock after this much inactivity
  desktopAutostart: false,    // Windows shell: launch Ping at login
  desktopCloseToTray: true,   // Windows shell: closing hides to the tray
  diagnostics: false,     // opt-in: send anonymous diagnostics + crash reports
  pinned: [],             // chatId[]
  markedUnread: [],       // chatId[]
  starred: {},            // chatId -> messageId[]   (fast membership lookup)
  starredSnap: {},        // "chatId:msgId" -> snapshot for the Saved pane
};

export const ACCENTS = ['#4d9bff', '#7b6cff', '#3fe0bd', '#ff8a5b', '#f472b6',
  '#34d399', '#fbbf24', '#ff5d73'];

// Selectable app typefaces. 'jakarta' keeps the bundled Plus Jakarta Sans; the
// rest fall back to fonts the OS already ships, so there's nothing to download.
export const FONTS = [
  ['jakarta', 'Plus Jakarta (Standard)', '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif'],
  ['system', 'System', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif'],
  ['serif', 'Serif', 'Georgia, "Times New Roman", "Noto Serif", serif'],
  ['mono', 'Monospace', 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'],
];

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

const VISUAL = new Set(['theme', 'amoled', 'accent', 'wallpaper', 'fontScale', 'highContrast',
  'reduceMotion', 'bubbleStyle', 'fontFamily', 'underlineLinks', 'bigTargets']);

// Resolve 'system' to a concrete scheme by asking the OS; 'dark'/'light' pass
// through unchanged. Everything visual keys off this, not the raw pref.
function osPrefersLight() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); }
  catch { return false; }
}
export function effectiveTheme() {
  return prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme
    : (osPrefersLight() ? 'light' : 'dark');
}
export const isLight = () => effectiveTheme() === 'light';

// Re-apply when the OS scheme flips while we're in 'system' mode.
try {
  window.matchMedia && window.matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => { if (prefs.theme === 'system') applyVisual(); });
} catch { /* no matchMedia (e.g. headless test) */ }

export function applyVisual() {
  const r = document.documentElement;
  r.setAttribute('data-theme', effectiveTheme());
  // AMOLED true-black only applies on top of the dark theme.
  r.setAttribute('data-black', prefs.amoled && effectiveTheme() === 'dark' ? 'on' : 'off');
  r.setAttribute('data-contrast', prefs.highContrast ? 'high' : 'normal');
  r.setAttribute('data-motion', prefs.reduceMotion ? 'reduce' : 'full');
  r.setAttribute('data-underline', prefs.underlineLinks ? 'on' : 'off');
  r.setAttribute('data-targets', prefs.bigTargets ? 'large' : 'normal');
  r.setAttribute('data-bubbles', prefs.bubbleStyle || 'rounded');
  r.style.setProperty('--accent', prefs.accent || DEFAULTS.accent);
  r.style.setProperty('--font-scale', String(prefs.fontScale || 1));
  const font = FONTS.find((f) => f[0] === prefs.fontFamily);
  if (font && prefs.fontFamily !== 'jakarta') r.style.setProperty('--font', font[2]);
  else r.style.removeProperty('--font'); // keep the stylesheet's default
  const wp = WALLPAPERS.find((w) => w.id === prefs.wallpaper);
  const css = prefs.wallpaper && prefs.wallpaper.startsWith('data:')
    ? `center / cover no-repeat url(${prefs.wallpaper})`
    : (wp ? wp.css : '');
  document.body.style.setProperty('--chat-wallpaper', css || 'none');
}

export function toggleTheme() {
  // Toggle the *effective* scheme, landing on a concrete value (leaves 'system').
  set('theme', isLight() ? 'dark' : 'light');
}

// ---- settings backup / restore -------------------------------------------
// A portable snapshot of every device-side preference — lets users carry their
// look & behaviour to another browser, or keep a backup before experimenting.
export function exportPrefs() {
  return { app: 'ping-web', kind: 'prefs', version: 1, exportedAt: Date.now(), prefs: { ...prefs } };
}
export function importPrefs(data) {
  const incoming = data && data.prefs && typeof data.prefs === 'object' ? data.prefs : data;
  if (!incoming || typeof incoming !== 'object') throw new Error('Ungültige Sicherungsdatei.');
  // Only adopt keys we actually know — ignore anything foreign.
  for (const k of Object.keys(DEFAULTS)) if (k in incoming) prefs[k] = incoming[k];
  persist();
  applyVisual();
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
