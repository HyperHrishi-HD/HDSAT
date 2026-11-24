/* HDSAT service worker.
 *
 * What this caches, and what it deliberately does not:
 *   - The app shell (index.html, icons, manifest) is precached so an installed
 *     app opens instantly and still opens with no network.
 *   - Hashed build assets (/assets/index-<hash>.js|css, fonts) are immutable,
 *     so they are served cache-first and only ever re-fetched when the hash
 *     changes.
 *   - Navigations prefer the live shell and only fall back to the cached one
 *     offline. Serving a cached shell first leaves the tab pointing at asset
 *     hashes the latest deploy has deleted, which breaks the app until reload.
 *   - Everything else — /api/ on the Python host, Supabase auth and REST, the
 *     Desmos iframe — is never cached and never replayed. A stale sign-in
 *     response or a stale saved answer would be worse than being offline.
 */

const VERSION = 'hdsat-v15';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

/** Never touched by the cache: account data, mail, calculators, analytics. */
const BYPASS = ['/api/', '/auth/', '/rest/', '/storage/', '/realtime/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing shell file must not fail the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

function isAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico)$/i.test(url.pathname)
  );
}

function bypasses(url, request) {
  if (url.origin !== self.location.origin) return true;
  if (BYPASS.some((prefix) => url.pathname.startsWith(prefix))) return true;
  if (request.headers.has('range')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (bypasses(url, request)) return;

  // Navigations: use the live shell when reachable, so a deploy is picked up
  // immediately. The cached shell is only for offline use; serving it first
  // can point a tab at asset hashes that no longer exist on the server.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          // No short timeout here. A slow Python host used to fall back to the
          // previous shell after 2.5 s; that shell points at hashed assets the
          // latest deploy has deleted, which renders a blank page. Wait for the
          // live document and bypass the HTTP cache so a deploy is picked up.
          const response = await fetch(request, { cache: 'no-store' });
          if (response?.ok) {
            await cache.put('/index.html', response.clone()).catch(() => undefined);
          }
          if (response) return response;
        } catch {
          // Offline: fall through to the cached shell.
        }
        const cached = (await cache.match('/index.html')) || (await cache.match('/'));
        return (
          cached ||
          new Response('HDSAT is offline and has not been opened on this device yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      })()
    );
    return;
  }

  // Immutable build output: cache-first, fill the cache on the way through.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      })()
    );
  }
});
