/* quickreplies.js — canned composer replies ("Schnellantworten"), now synced
   across every device.

   The server (/me/quick-replies) is the source of truth, so a reply you create
   on your phone shows up on the desktop too. A localStorage mirror keeps them
   available instantly and offline. Legacy device-only replies (the old plain
   `prefs.quickReplies` string array) are migrated up to the account on first
   sync, then this module owns them.

   Each reply may carry a short, whitespace-free "/shortcut" the composer expands
   inline (type "/gn8 " → the full text). */

import { api } from './api.js';
import * as store from './store.js';
import * as prefs from './prefs.js';

const CACHE_KEY = 'ping.quickReplies.v2';        // [{id, shortcut, text}]
const MIGRATED_KEY = 'ping.quickReplies.migrated';

let cache = loadCache();

function loadCache() {
  try {
    const a = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return Array.isArray(a) ? a : null;
  } catch { return null; }
}

function persist() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache || [])); } catch { /* quota */ }
  store.emit('quickReplies');
}

/** Current replies. Before the first sync, fall back to the legacy local strings
 *  so the UI is never empty. */
export function list() {
  if (cache) return cache;
  return (prefs.get('quickReplies') || []).map((text) => ({ id: null, shortcut: '', text }));
}

/** Pull the account's replies; one-time migration of any legacy local ones. */
export async function sync() {
  try {
    let server = (await api.get('/me/quick-replies')).quickReplies || [];
    if (!server.length && !localStorage.getItem(MIGRATED_KEY)) {
      const legacy = (prefs.get('quickReplies') || []).filter((t) => t && t.trim());
      for (const text of legacy) { try { await api.post('/me/quick-replies', { text }); } catch { /* skip */ } }
      if (legacy.length) server = (await api.get('/me/quick-replies')).quickReplies || [];
    }
    localStorage.setItem(MIGRATED_KEY, '1');
    cache = server;
    persist();
  } catch { /* offline: keep whatever we cached */ }
}

/** Apply a server-pushed list (WS 'quick-replies-updated'). */
export function apply(serverList) {
  if (Array.isArray(serverList)) { cache = serverList; persist(); }
}

export async function add({ shortcut = '', text }) {
  const { quickReply } = await api.post('/me/quick-replies', { shortcut, text });
  cache = [...(cache || []), quickReply];
  persist();
  return quickReply;
}

export async function update(id, patch) {
  const { quickReply } = await api.patch(`/me/quick-replies/${id}`, patch);
  cache = (cache || []).map((q) => (q.id === id ? quickReply : q));
  persist();
  return quickReply;
}

export async function remove(id) {
  await api.del(`/me/quick-replies/${id}`);
  cache = (cache || []).filter((q) => q.id !== id);
  persist();
}

/** If the whole composer value is a "/shortcut " token, return the reply text it
 *  expands to (else null). Kept deliberately strict so it never eats real text. */
export function expand(value) {
  const m = /^\/(\S+)[ \t]$/.exec(value || '');
  if (!m) return null;
  const hit = (cache || []).find(
    (q) => q.shortcut && q.shortcut.toLowerCase() === m[1].toLowerCase()
  );
  return hit ? hit.text : null;
}
