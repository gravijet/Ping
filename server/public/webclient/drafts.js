/* drafts.js — per-chat unsent message drafts. When you type into a chat and
   leave without sending, the text is parked in localStorage keyed by chat id and
   restored the next time you open that chat — so switching conversations (or a
   reload, or a crash) never loses what you were composing. The chat list shows a
   "✎ Entwurf: …" hint so a half-written reply isn't forgotten.

   Purely device-local: drafts never touch the server. Pure logic + storage, so
   it imports cleanly under the test DOM shim. */

const KEY = 'ping.drafts';
const MAX = 200; // cap stored drafts so a long-lived device can't grow unbounded
const subs = new Set();

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { return {}; }
}
function write(map) {
  try {
    // Trim to the most recently touched drafts if we somehow exceed the cap.
    const entries = Object.entries(map);
    if (entries.length > MAX) {
      entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
      map = Object.fromEntries(entries.slice(0, MAX));
    }
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* quota — ignore */ }
}

/** Subscribe to draft changes (chat list re-renders its indicator). */
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify(chatId) { for (const fn of subs) { try { fn(chatId); } catch { /* ignore */ } } }

/** The saved draft text for a chat, or '' if none. */
export function get(chatId) {
  const d = read()[chatId];
  return d && typeof d.text === 'string' ? d.text : '';
}

export function has(chatId) { return get(chatId).trim().length > 0; }

/** Save (or, for empty text, clear) the draft for a chat. */
export function set(chatId, text) {
  if (!chatId) return;
  const map = read();
  const trimmed = String(text || '');
  if (!trimmed.trim()) {
    if (map[chatId]) { delete map[chatId]; write(map); notify(chatId); }
    return;
  }
  const prev = map[chatId]?.text;
  if (prev === trimmed) return; // no-op, skip a needless write + notify
  map[chatId] = { text: trimmed.slice(0, 8000), t: Date.now() };
  write(map);
  notify(chatId);
}

export function clear(chatId) { set(chatId, ''); }

/** A short, single-line preview for the chat-list indicator. */
export function preview(chatId, max = 38) {
  const t = get(chatId).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
