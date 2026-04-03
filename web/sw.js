const CACHE_NAME = 'ufrp-shell-v1';

const SHELL_PATHS = new Set([
  '/',
  '/index.php',
  '/manifest.webmanifest',
  '/client.js',
  '/client-offline.js',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/apple-touch-icon.png'
]);

function normalizePathname(urlString) {
  try {
    const u = new URL(urlString, self.location.origin);
    return u.pathname || '/';
  } catch (_) {
    return '/';
  }
}

function cacheKeyForRequest(request) {
  const pathname = normalizePathname(request.url);
  if (request.mode === 'navigate') {
    return new Request('/index.php', { method: 'GET' });
  }
  return new Request(pathname, { method: 'GET' });
}

async function putInCache(request, response) {
  if (!response || response.status !== 200 || request.method !== 'GET') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(cacheKeyForRequest(request), response.clone());
}

async function matchFromCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const exact = await cache.match(cacheKeyForRequest(request));
  if (exact) return exact;

  if (request.mode === 'navigate') {
    return await cache.match('/index.php') || await cache.match('/');
  }

  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(Array.from(SHELL_PATHS));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname || '/';
  const isShellRequest =
    request.mode === 'navigate' ||
    SHELL_PATHS.has(pathname);

  if (!isShellRequest) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      await putInCache(request, response);
      return response;
    } catch (_) {
      const cached = await matchFromCache(request);
      if (cached) return cached;
      throw _;
    }
  })());
});
