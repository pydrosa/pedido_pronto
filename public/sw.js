/* Service Worker — Pedido Pronto
   Handles background Web Push notifications */

const CACHE_NAME = 'pedido-pronto-v2'
const STATIC_ASSETS = ['/', '/index.html']

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Fetch (cache-first for static, network for API) ──────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/') || event.request.url.includes('supabase')) return
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  )
})

// ── Push Notification ─────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Pedido Pronto!', body: 'Seu pedido está pronto para retirada.', orderId: '' }

  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {}

  const options = {
    body: data.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [200, 100, 200, 100, 300],
    tag: `order-${data.orderId}`,
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'view', title: 'Ver pedido' },
      { action: 'close', title: 'Fechar' },
    ],
    data: { orderId: data.orderId, url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

// ── Notification Click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'close') return

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus()
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl)
      })
  )
})
