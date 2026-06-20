/* sw.js — Ping Web service worker. Makes the app installable and usable
   offline by precaching the app shell and serving same-origin static assets
   cache-first. It is deliberately conservative about what it caches:

     • The app shell (HTML/JS/CSS/fonts) is cached so Ping loads with no network.
     • /api, /ws and authed media (/api/uploads, avatars) are NEVER cached —
       they are per-user and security-sensitive, so they always hit the network.
     • Navigations fall back to the cached shell when offline (SPA behaviour).

   Bump CACHE_VERSION on every web release; the activate handler purges old
   caches so stale assets can never linger after a deploy. */

const CACHE_VERSION = 'ping-web-v0.29.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// The critical shell — enough to boot the app offline. The remaining,
// lazily-imported modules (status.js, groups.js, …) are filled in at runtime
// the first time they are fetched, so a second offline visit has them too.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/favicon.png',
  '/PlusJakartaSans.ttf',
  '/app.js',
  '/api.js',
  '/store.js',
  '/prefs.js',
  '/ui.js',
  '/socket.js',
  '/auth.js',
  '/chats.js',
  '/chat.js',
  '/contacts.js',
  '/settings.js',
  '/calls.js',
  '/palette.js',
  '/lock.js',
  '/native.js',
  '/webpush.js',
  '/flags.js',
  '/telemetry.js',
  '/share.js',
  '/skeleton.js',
  '/outbox.js',
  '/mentions.js',
  '/drafts.js',
  '/folders.js',
  '/activity.js',
  '/shortcuts.js',
  '/themes.js',
  '/insights.js',
  '/idb.js',
  '/cache.js',
  '/syncqueue.js',
  '/validate.js',
  '/linkpreview.js',
  '/device.js',
  '/reminders.js',
  '/quickreplies.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is atomic-ish: if one asset 404s the whole install fails, so add
    // them individually and tolerate the odd miss (a renamed module, say).
    await Promise.all(SHELL_ASSETS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Let the page trigger an immediate update after a new SW is installed.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Requests we must always pass straight through to the network (per-user,
// authenticated or realtime — caching them would leak data between accounts or
// serve stale state).
function isBypassed(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname === '/api'
    || url.pathname.startsWith('/ws')
    || url.pathname.startsWith('/uploads/');
}

function isStaticAsset(url) {
  return /\.(?:js|css|ttf|woff2?|png|svg|webp|json|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only ever touch our own origin; cross-origin (CDNs etc.) goes to network.
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  // SPA navigations: network-first, fall back to the cached shell offline so
  // deep links and refreshes still boot the app without a connection.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match('/index.html'))
          || (await caches.match('/'))
          || Response.error();
      }
    })());
    return;
  }

  // Static assets: cache-first, then refresh the cache in the background
  // (stale-while-revalidate) so updates land on the next load.
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});

/* ---- Web Push -------------------------------------------------------------
   The OS wakes the worker for a `push` even when no tab is open; we decrypt the
   payload (the browser does that for us) and raise the notification. A tap opens
   / focuses the right chat; the "Als gelesen" action marks it read server-side
   using a token the page mirrored into IndexedDB (webpush.js). */

const SW_DB = 'ping-sw';
const SW_STORE = 'kv';

function idbGet(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open(SW_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SW_STORE);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction(SW_STORE, 'readonly');
        const get = tx.objectStore(SW_STORE).get(key);
        get.onsuccess = () => { resolve(get.result); req.result.close(); };
        get.onerror = () => { resolve(undefined); req.result.close(); };
      } catch {
        resolve(undefined);
      }
    };
    req.onerror = () => resolve(undefined);
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || 'Ping';
  const data = payload.data || {};
  const options = {
    body: payload.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || data.chatId || undefined,
    // Re-alert for a fresh message in a chat the user has already been notified
    // about, rather than silently coalescing it away.
    renotify: !!(payload.tag || data.chatId),
    data,
    actions: data.chatId
      ? [
          { action: 'open', title: 'Öffnen' },
          { action: 'markread', title: 'Als gelesen' },
        ]
      : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

async function markChatRead(chatId) {
  const token = await idbGet('token');
  if (!token || !chatId) return;
  try {
    await fetch(`/api/chats/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* offline — the chat reconciles its unread state on next load */
  }
  // Nudge any open tab to refresh its badges/unread counts.
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) c.postMessage({ type: 'refresh-badges' });
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const chatId = data.chatId;
  event.notification.close();

  if (event.action === 'markread') {
    event.waitUntil(markChatRead(chatId));
    return;
  }

  // Open or focus a window, then ask it to route to the chat.
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'open-chat', chatId, route: data.route });
        return;
      }
    }
    const url = chatId ? `/?chat=${encodeURIComponent(chatId)}` : '/';
    await self.clients.openWindow(url);
  })());
});

// When the browser rotates a subscription out from under us, re-subscribe with
// the same VAPID key and re-register it with the server (using the mirrored
// token), so push keeps working without the user lifting a finger.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const token = await idbGet('token');
    if (!token) return;
    try {
      const res = await fetch('/api/push/web/vapid', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const key = Uint8Array.from(
        atob((publicKey + '==='.slice((publicKey.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0)
      );
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const json = sub.toJSON();
      await fetch('/api/push/web/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
    } catch {
      /* best effort — the next page load will re-sync */
    }
  })());
});
