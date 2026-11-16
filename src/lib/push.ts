const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

// Convert base64 VAPID key to Uint8Array (required by subscribe())
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

function buffersEqual(left: ArrayBuffer | null, right: Uint8Array): boolean {
  if (!left) return false
  const leftBytes = new Uint8Array(left)
  if (leftBytes.length !== right.length) return false
  return leftBytes.every((byte, index) => byte === right[index])
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    await reg.update()
    return reg
  } catch (err) {
    console.error('[SW] Falha ao registrar:', err)
    return null
  }
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  return await Notification.requestPermission()
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  try {
    const permission = await requestPushPermission()
    if (permission !== 'granted') return null

    const reg = await registerServiceWorker()
    if (!reg) return null

    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      const existingKey = existing.options.applicationServerKey ?? null
      if (buffersEqual(existingKey, applicationServerKey)) return existing
      await existing.unsubscribe()
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    })

    return subscription
  } catch (err) {
    console.error('[Push] Falha ao subscrever:', err)
    return null
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function toSubscriptionPayload(sub: PushSubscription): PushSubscriptionJSON {
  return sub.toJSON()
}

// Trigger vibration on the device (client-side only, no push needed)
export function vibrate(pattern: number[] = [200, 100, 200, 100, 300]): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}
