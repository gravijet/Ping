/* syncqueue.js — offline-first delivery of realtime *acknowledgements*. Where
   the outbox queues message sends over REST, this queues the lightweight
   "read" / "delivered" signals that ride the WebSocket. When the socket is down
   those signals are simply dropped (socket.send returns false), so a read you
   made offline would never reach the server. This parks them in localStorage,
   deduped per chat, and replays them the moment the socket reconnects.

   Dedup rules (a chat only needs its latest state):
     • repeated read/delivered for a chat collapse to one,
     • a queued "read" supersedes a "delivered" (read implies delivered),
     • so we never send a redundant or out-of-order ack.

   The pure transforms (addIntent / removeIntent / drainList) are exported and
   unit-tested; the storage + socket plumbing around them is thin. */

import * as socket from './socket.js';
import * as store from './store.js';
import { flag } from './flags.js';

const KEY = 'ping.syncqueue';

// ---- pure helpers (unit-tested) -------------------------------------------
function normalize(queue) {
  return { read: { ...(queue && queue.read) }, delivered: { ...(queue && queue.delivered) } };
}

/** Add a read/delivered intent for a chat, applying the dedup rules above. */
export function addIntent(queue, kind, chatId, ts = Date.now()) {
  const q = normalize(queue);
  if ((kind !== 'read' && kind !== 'delivered') || !chatId) return q;
  if (kind === 'read') {
    delete q.delivered[chatId];                 // read supersedes delivered
    q.read[chatId] = Math.max(q.read[chatId] || 0, ts);
  } else {
    if (q.read[chatId]) return q;               // a read is already queued
    q.delivered[chatId] = Math.max(q.delivered[chatId] || 0, ts);
  }
  return q;
}

/** Remove a single intent (after it has been sent). */
export function removeIntent(queue, kind, chatId) {
  const q = normalize(queue);
  if (q[kind]) delete q[kind][chatId];
  return q;
}

/** Flatten the queue to an ordered send list ("read" before "delivered"). */
export function drainList(queue) {
  const q = normalize(queue);
  return [
    ...Object.keys(q.read).map((chatId) => ({ kind: 'read', chatId })),
    ...Object.keys(q.delivered).map((chatId) => ({ kind: 'delivered', chatId })),
  ];
}

// ---- storage --------------------------------------------------------------
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function save(q) {
  try {
    if (!Object.keys(q.read || {}).length && !Object.keys(q.delivered || {}).length) {
      localStorage.removeItem(KEY);
    } else localStorage.setItem(KEY, JSON.stringify(q));
  } catch { /* quota — best-effort */ }
}

/** How many acks are waiting to be sent (for the debug panel). */
export function count() { return drainList(load()).length; }

// ---- public API -----------------------------------------------------------
/** Acknowledge that the open chat has been read (queues if offline). */
export function markRead(chatId) { enqueue('read', chatId); }
/** Acknowledge that an incoming message was delivered (queues if offline). */
export function markDelivered(chatId) { enqueue('delivered', chatId); }

function enqueue(kind, chatId) {
  if (!chatId) return;
  // Flag off → behave exactly like before (best-effort send, no persistence).
  if (!flag('syncReceipts')) { socket.send(kind, { chatId }); return; }
  save(addIntent(load(), kind, chatId));
  flush();
}

/** Replay every queued ack the socket will accept; keep the rest for later. */
export function flush() {
  let q = load();
  const items = drainList(q);
  if (!items.length) return;
  for (const it of items) {
    if (socket.send(it.kind, { chatId: it.chatId })) q = removeIntent(q, it.kind, it.chatId);
  }
  save(q);
}

/** Wire automatic flushing on reconnect. Call once at boot. */
export function install() {
  store.on('connection', (connected) => { if (connected) flush(); });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', flush);
    setTimeout(flush, 1500);
  }
}
