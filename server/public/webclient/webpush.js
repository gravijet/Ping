/* webpush.js — the browser side of Web Push. Subscribes this browser to the
   push service via the W3C Push API and registers the subscription with the
   server (POST /api/push/web/subscribe), so Ping can raise a notification for a
   new message even when the tab — or the whole browser — is closed. The service
   worker (sw.js) receives the encrypted payload and shows the notification.

   The auth token is mirrored into a tiny IndexedDB key/value store the worker
   can read, so the "Als gelesen" notification action can mark a chat read
   without any tab open. Everything degrades to a no-op where Push isn't
   available (or the server has no VAPID keys configured). */

import { api, getToken } from './api.js';

const SW_DB = 'ping-sw';
const SW_STORE = 'kv';

// ---- tiny IndexedDB key/value (shared verbatim with sw.js) -----------------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SW_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SW_STORE, 'readwrite');
    tx.objectStore(SW_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function idbDel(key) {
  const db = await idbOpen();
  await new Promise((resolve) => {
    const tx = db.transaction(SW_STORE, 'readwrite');
    tx.objectStore(SW_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  db.close();
}

// ---- helpers ---------------------------------------------------------------
export function webPushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let _vapid; // { enabled, publicKey } — fetched once per session.
async function getVapid() {
  if (_vapid) return _vapid;
  try {
    _vapid = await api.get('/push/web/vapid');
  } catch {
    _vapid = { enabled: false, publicKey: '' };
  }
  return _vapid;
}

/** True if the server has web push configured (used to show/hide the toggle). */
export async function webPushAvailable() {
  if (!webPushSupported()) return false;
  return !!(await getVapid()).enabled;
}

async function readyRegistration() {
  // Ensure the worker is registered + active before touching pushManager.
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.ready;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    /* registerServiceWorker() in app.js already handles this; ignore races */
  }
  return navigator.serviceWorker.ready;
}

// ---- public API ------------------------------------------------------------

/**
 * Turn web push on: request notification permission (if needed), subscribe, and
 * register with the server. Returns true on success. Throws a user-facing
 * message when permission is denied so the settings toggle can surface it.
 */
export async function enableWebPush() {
  if (!webPushSupported()) throw new Error('Push wird hier nicht unterstützt.');
  const vapid = await getVapid();
  if (!vapid.enabled || !vapid.publicKey) throw new Error('Server-Push ist nicht eingerichtet.');

  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Erlaubnis verweigert.');
  }

  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }
  await registerSubscription(sub);
  return true;
}

/** Push a subscription up to the server + mirror the auth token for the worker. */
async function registerSubscription(sub) {
  const json = sub.toJSON();
  await api.post('/push/web/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  });
  // The worker needs the token (for the mark-read action) + the endpoint (to
  // tell the server when the browser rotates the subscription).
  await idbSet('token', getToken());
  await idbSet('endpoint', json.endpoint);
}

/** Turn web push off: unsubscribe locally and drop it server-side. */
export async function disableWebPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await api.post('/push/web/unsubscribe', { endpoint }).catch(() => {});
    }
  } catch {
    /* best effort */
  }
  await idbDel('token');
  await idbDel('endpoint');
}

/** True if this browser currently holds a push subscription. */
export async function isWebPushSubscribed() {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Called after login: if the user previously enabled push, make sure the
 * subscription still exists and the server (+ the worker's token mirror) is
 * up to date. Silent — never prompts. Safe to call on every app start.
 */
export async function syncWebPush(wantEnabled) {
  if (!webPushSupported() || Notification.permission !== 'granted') return;
  if (!(await webPushAvailable())) return;
  try {
    const reg = await readyRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (wantEnabled) {
      if (sub) await registerSubscription(sub);
      else await enableWebPush();
    } else if (sub) {
      await disableWebPush();
    }
  } catch {
    /* a failed silent sync is not worth bothering the user about */
  }
}
