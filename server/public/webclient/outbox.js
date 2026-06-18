/* outbox.js — a persistent send-queue for offline-first messaging. When a text
   send fails because the device is offline (or the request never reaches the
   server), the message is parked here in localStorage instead of being lost.
   It survives reloads and is flushed automatically the moment connectivity
   returns (the socket reconnects or the browser fires 'online').

   Each item carries a clientId so the UI can show an optimistic "pending"
   bubble and swap it for the real server message once it lands — and so a retry
   can never create a duplicate on the client. (The server assigns the canonical
   id; we de-dupe against it by replacing the temp bubble.)

   Conflict model: messages are append-only and independent, so there is nothing
   to merge — we simply send oldest-first and let the server order them by
   arrival. Items that fail with a real HTTP error (e.g. the chat was deleted)
   are dropped after a few attempts rather than retried forever. */

import { api } from './api.js';
import * as store from './store.js';

const KEY = 'ping.outbox';
const MAX_ATTEMPTS = 8;
let flushing = false;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; }
  catch { return []; }
}
function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
}

export function list() { return load(); }
export function pendingFor(chatId) { return load().filter((i) => i.chatId === chatId); }
export function count() { return load().length; }

/** Queue a text message for (re)delivery. Returns the queued item (incl. its
    clientId + tempId for the optimistic bubble). */
export function enqueue({ chatId, body, replyTo = null }) {
  const items = load();
  const item = {
    clientId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatId, body, replyTo,
    ts: Date.now(),
    attempts: 0,
  };
  item.tempId = `tmp-${item.clientId}`;
  items.push(item);
  save(items);
  store.emit('outbox');
  store.emit('outbox:' + chatId);
  return item;
}

function removeByClientId(clientId) {
  const items = load().filter((i) => i.clientId !== clientId);
  save(items);
}

/** Try to deliver everything in the queue, oldest first. Safe to call often;
    it no-ops while offline or already running. */
export async function flush() {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const items = load();
  if (!items.length) return;
  flushing = true;
  try {
    for (const item of items) {
      try {
        const r = await api.post(`/chats/${item.chatId}/messages`,
          { body: item.body, ...(item.replyTo ? { replyTo: item.replyTo } : {}) });
        removeByClientId(item.clientId);
        store.emit('outbox-sent', { clientId: item.clientId, tempId: item.tempId,
          chatId: item.chatId, message: r.message });
        store.emit('outbox');
        store.emit('outbox:' + item.chatId);
      } catch (e) {
        if (e && e.status === 0) break; // still offline — stop, keep the rest queued
        // A real server error: bump attempts, drop once we give up.
        const cur = load();
        const found = cur.find((i) => i.clientId === item.clientId);
        if (found) {
          found.attempts = (found.attempts || 0) + 1;
          if (found.attempts >= MAX_ATTEMPTS) {
            save(cur.filter((i) => i.clientId !== item.clientId));
            store.emit('outbox-failed', { clientId: item.clientId, tempId: item.tempId,
              chatId: item.chatId, error: e.message || 'Senden fehlgeschlagen' });
          } else {
            save(cur);
          }
          store.emit('outbox');
          store.emit('outbox:' + item.chatId);
        }
      }
    }
  } finally {
    flushing = false;
  }
}

/** Drop a queued item (e.g. the user cancels a stuck pending message). */
export function cancel(clientId) {
  const item = load().find((i) => i.clientId === clientId);
  removeByClientId(clientId);
  store.emit('outbox');
  if (item) store.emit('outbox:' + item.chatId);
}

/** Wire automatic flushing. Call once at boot. */
export function install() {
  // Reconnect of the realtime socket is the strongest "we're back online" signal.
  store.on('connection', (connected) => { if (connected) flush(); });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', flush);
    // Opportunistic: also try shortly after load in case items were left over.
    setTimeout(flush, 1500);
  }
}
