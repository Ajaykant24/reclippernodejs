/* Reclipper service worker.
 * Deliberately minimal + network-first so the app is installable (Add to Home
 * Screen) without ever serving stale HTML/JS. We never cache navigations or the
 * app bundle; we only fall back to a tiny offline shell when the network is down.
 */
const OFFLINE_VERSION = 'reclipper-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Drop any old caches from previous versions.
      const keys = await caches.keys()
      await Promise.all(keys.filter(k => k !== OFFLINE_VERSION).map(k => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  // Only handle same-origin GETs; let everything else (API, fonts, video) pass through.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Network-first: always try the live network so deploys show immediately.
  event.respondWith(
    fetch(request).catch(async () => {
      // Offline fallback: for page navigations, return the cached app shell if we have it.
      if (request.mode === 'navigate') {
        const cached = await caches.match('/')
        if (cached) return cached
      }
      return new Response('', { status: 504, statusText: 'Offline' })
    }),
  )
})
