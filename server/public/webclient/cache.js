/* cache.js — a read-through offline cache for the chat list and recent messages,
   backed by IndexedDB (idb.js). Together with the outbox (which queues *sends*)
   this makes Ping genuinely offline-first: the last chat list and the most
   recent messages per chat are persisted as they flow through the store, and
   replayed on boot so the app opens instantly and stays readable with no
   network.

   Design:
     • Writes are passive — we subscribe to store events ('chats', 'messages')
       and persist a debounced snapshot. Views never have to know we exist.
     • Reads are explicit — app.js hydrates the chat list before the first paint
       (hydrateChats), and chat.js asks for a chat's cached history on open
       (loadMessages) before the network responds.
     • The cache is scoped to one account: an "owner" record holds the signed-in
       user id; if it ever doesn't match, the whole cache is wiped before use so
       one account can never see another's cached data on a shared device.

   The pure transforms (capMessages / mergeMessages / estimateBytes) are exported
   and unit-tested; everything that touches IndexedDB is async and best-effort. */

import * as store from './store.js';
import * as idb from './idb.js';
import { flag } from './flags.js';

const MSG_CAP = 80;    // messages kept per chat (newest)
const CHAT_CAP = 200;  // chats kept in the list snapshot

let installed = false;

// ---- pure helpers (unit-tested, no IndexedDB) -----------------------------

/** Keep only the newest `n` *durable* messages, ascending by time. Optimistic
    "pending" bubbles (tmp- ids) live in the outbox, not the cache, so we drop
    them — otherwise a queued-then-failed send could linger forever. */
export function capMessages(msgs, n = MSG_CAP) {
  if (!Array.isArray(msgs)) return [];
  const real = msgs.filter((m) =>
    m && m.id && !m.pending && !String(m.id).startsWith('tmp-'));
  return real.slice(-n);
}

/** Merge cached + fresh message lists, de-duped by id (fresh wins), ascending. */
export function mergeMessages(cached, fresh) {
  const byId = new Map();
  for (const m of cached || []) if (m && m.id) byId.set(m.id, m);
  for (const m of fresh || []) if (m && m.id) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Rough byte size of a JSON-serialisable value (for the cache inspector). */
export function estimateBytes(value) {
  let json;
  try { json = JSON.stringify(value); } catch { return 0; }
  if (!json) return 0;
  try { return new Blob([json]).size; } catch { return json.length; }
}

function enabled() { return flag('offlineCache') && idb.available(); }

// ---- persistence (debounced, passive) -------------------------------------
let chatsTimer = null;
function saveChatsSoon() {
  if (!enabled()) return;
  clearTimeout(chatsTimer);
  chatsTimer = setTimeout(saveChats, 600);
}
async function saveChats() {
  if (!enabled()) return;
  try {
    const list = store.chatsSorted().slice(0, CHAT_CAP);
    await idb.put('kv', { key: 'chats', value: list, at: Date.now() });
    if (store.state.me?.id) await idb.put('kv', { key: 'owner', value: store.state.me.id });
  } catch { /* quota / private mode — caching is best-effort */ }
}

const msgTimers = new Map();
function saveMessagesSoon(chatId) {
  if (!enabled() || !chatId) return;
  clearTimeout(msgTimers.get(chatId));
  msgTimers.set(chatId, setTimeout(() => saveMessages(chatId), 800));
}
async function saveMessages(chatId) {
  if (!enabled()) return;
  try {
    const msgs = capMessages(store.getHistory(chatId));
    if (msgs.length) await idb.put('messages', { chatId, msgs, at: Date.now() });
    else await idb.del('messages', chatId);
  } catch { /* ignore */ }
}

// ---- hydration / reads ----------------------------------------------------

/** Replay the cached chat list into the store before the first paint. Returns
    true if anything was hydrated. Wipes the cache first if it belongs to a
    different account (shared-device safety). */
export async function hydrateChats() {
  if (!enabled() || store.state.chatsLoaded) return false;
  try {
    const owner = await idb.get('kv', 'owner');
    const meId = store.state.me?.id;
    if (owner?.value && meId && owner.value !== meId) { await idb.clearAll(); return false; }
    const rec = await idb.get('kv', 'chats');
    if (rec && Array.isArray(rec.value) && rec.value.length && !store.state.chatsLoaded) {
      store.setChats(rec.value);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Return a chat's cached messages (ascending) or null. */
export async function loadMessages(chatId) {
  if (!enabled()) return null;
  try {
    const rec = await idb.get('messages', chatId);
    return rec && Array.isArray(rec.msgs) && rec.msgs.length ? rec.msgs : null;
  } catch { return null; }
}

/** Stats for the debug panel's cache inspector. */
export async function stats() {
  if (!idb.available()) return { available: false, chats: 0, threads: 0, messages: 0, bytes: 0 };
  try {
    const chatsRec = await idb.get('kv', 'chats');
    const threads = await idb.getAll('messages');
    const chats = Array.isArray(chatsRec?.value) ? chatsRec.value.length : 0;
    let messages = 0;
    let bytes = estimateBytes(chatsRec?.value || []);
    for (const t of threads || []) { messages += (t.msgs || []).length; bytes += estimateBytes(t.msgs); }
    return { available: true, chats, threads: (threads || []).length, messages, bytes };
  } catch { return { available: true, chats: 0, threads: 0, messages: 0, bytes: 0, error: true }; }
}

/** Wipe everything (logout / manual clear). */
export async function clearAll() {
  try { await idb.clearAll(); } catch { /* ignore */ }
}

// ---- wiring ---------------------------------------------------------------
/** Subscribe to store changes and persist them. Call once at boot. */
export function install() {
  if (installed) return; installed = true;
  store.on('chats', saveChatsSoon);
  store.on('messages', (chatId) => saveMessagesSoon(chatId));
}
