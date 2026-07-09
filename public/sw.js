/* Sandstorm service worker: cache-first for hashed build assets,
 * network-first (with cache fallback) for data and navigation, so the
 * app never shows stale scores when online but still opens offline. */
const CACHE = 'sandstorm-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  if (url.pathname.includes('/assets/')) {
    // Hashed filenames: immutable, cache-first.
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const hit = await cache.match(request)
        if (hit) return hit
        const resp = await fetch(request)
        if (resp.ok) cache.put(request, resp.clone())
        return resp
      }),
    )
  } else {
    // Data + navigation: network-first, cache fallback for offline.
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone()
            caches.open(CACHE).then(cache => cache.put(request, clone))
          }
          return resp
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    )
  }
})
