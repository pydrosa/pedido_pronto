/* Service Worker — Pedido Pronto
   Web Push em segundo plano + shell offline mínimo. */

const CACHE_NAME = 'pedido-pronto-v3'
const SHELL_URL = '/index.html'

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting()
})

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch ────────────────────────────────────────────────────────────────────
// Só navegações, e sempre "rede primeiro". A versão anterior servia "/" direto
// do cache para sempre: depois de um deploy, o index.html antigo apontava para
// arquivos JS que já não existiam e a tela ficava em branco. Agora o cache só
// entra quando o aparelho está sem conexão.
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.mode !== 'navigate') return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy))
        }
        return response
      })
      .catch(() => caches.match(SHELL_URL).then((cached) => cached || Response.error()))
  )
})

// ── Push Notification ─────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Pedido pronto!', body: 'Seu pedido está pronto para retirada.', orderId: '', url: '/' }

  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // payload inválido: usa o texto padrão
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 300],
    tag: `order-${data.orderId}`,
    renotify: true,
    requireInteraction: true,
    data: { orderId: data.orderId, url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

// ── Notification Click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
