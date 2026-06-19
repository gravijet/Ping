/* sw.js — Ping Web service worker. Makes the app installable and usable
   offline by precaching the app shell and serving same-origin static assets
   cache-first. It is deliberately conservative about what it caches:

     • The app shell (HTML/JS/CSS/fonts) is cached so Ping loads with no network.
     • /api, /ws and authed media (/api/uploads, avatars) are NEVER cached —
       they are per-user and security-sensitive, so they always hit the network.
     • Navigations fall back to the cached shell when offline (SPA behaviour).

   Bump CACHE_VERSION on every web release; the activate handler purges old
   caches so stale assets can never linger after a deploy. */

const CACHE_VERSION = 'ping-web-v0.23.0';
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
  '/flags.js',
  '/telemetry.js',
  '/share.js',
  '/skeleton.js',
  '/outbox.js',
  '/mentions.js',
  '/drafts.js',
  '/activity.js',
  '/shortcuts.js',
  '/themes.js',
  '/insights.js',
  '/idb.js',
  '/cache.js',
  '/syncqueue.js',
  '/validate.js',
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
