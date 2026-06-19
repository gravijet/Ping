/* idb.js — a tiny promise-based IndexedDB wrapper (no dependencies). It backs the
   offline cache (cache.js): the last-seen chat list and recent messages per chat
   so Ping opens instantly and stays readable with no network.

   Deliberately minimal — two object stores and the handful of operations the
   cache needs. All IndexedDB access is lazy (inside functions), so this module
   is safe to *import* in a non-browser environment (the unit tests import the
   pure helpers in cache.js without ever opening a database). */

const DB_NAME = 'ping-web';
const DB_VERSION = 1;
const STORES = ['kv', 'messages'];

let dbPromise = null;

/** True when this environment has a usable IndexedDB (browser, secure context). */
export function available() {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
  catch { return false; }
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!available()) { reject(new Error('IndexedDB nicht verfügbar')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      // kv: generic key→value (chat-list snapshot, cache owner, metadata).
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      // messages: one record per chat, keyed by chatId.
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'chatId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB-Fehler'));
    req.onblocked = () => reject(new Error('IndexedDB blockiert'));
  });
  return dbPromise;
}

// Run one operation in a transaction and resolve with the request's result once
// the transaction commits (so writes are durable before we report success).
function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let result;
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const get = (store, key) => run(store, 'readonly', (os) => os.get(key));
export const put = (store, value) => run(store, 'readwrite', (os) => os.put(value));
export const del = (store, key) => run(store, 'readwrite', (os) => os.delete(key));
export const getAll = (store) => run(store, 'readonly', (os) => os.getAll());
export const count = (store) => run(store, 'readonly', (os) => os.count());
export const clear = (store) => run(store, 'readwrite', (os) => os.clear());

/** Wipe every store (used on logout / cache-owner change). Best-effort. */
export async function clearAll() {
  for (const s of STORES) { try { await clear(s); } catch { /* ignore */ } }
}
