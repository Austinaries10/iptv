// Network-first cache of the app shell so IPTV Plus opens offline and updates instantly when online
const CACHE = 'iptv-plus-v1'
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/utils.js',
  './js/storage.js',
  './js/m3u.js',
  './js/xtream.js',
  './js/epg.js',
  './js/player.js',
  './icon.svg',
  './manifest.webmanifest'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(event.request, copy))
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
