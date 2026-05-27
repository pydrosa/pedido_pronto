// supabase/functions/send-push/index.ts
// Deploy: supabase functions deploy send-push
//
// Required secrets (set via: supabase secrets set KEY=VALUE):
//   VAPID_SUBJECT   = mailto:seu@email.com
//   VAPID_PUBLIC_KEY  = (sua chave pública VAPID)
//   VAPID_PRIVATE_KEY = (sua chave privada VAPID)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Minimal Web Push implementation for Deno
// Uses the web-push protocol with VAPID authentication
async function sendWebPush(
  subscription: PushSubscriptionJSON,
  payload: string,
  vapidKeys: { subject: string; publicKey: string; privateKey: string }
) {
  const endpoint = subscription.endpoint!
  const keys = subscription.keys as { p256dh: string; auth: string }

  // Import VAPID private key
  const privateKeyBytes = base64UrlDecode(vapidKeys.privateKey)
  const vapidKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )

  // Create VAPID JWT
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600

  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const body = btoa(JSON.stringify({ aud: audience, exp, sub: vapidKeys.subject }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const sigData = new TextEncoder().encode(`${header}.${body}`)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, sigData)
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${header}.${body}.${sigB64}`
  const authHeader = `vapid t=${jwt}, k=${vapidKeys.publicKey}`

  // Encrypt payload
  const encrypted = await encryptPayload(payload, keys.p256dh, keys.auth)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: encrypted,
  })

  return { status: response.status, ok: response.ok }
}

async function encryptPayload(payload: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const p256dh = base64UrlDecode(p256dhB64)
  const auth = base64UrlDecode(authB64)
  const payloadBytes = new TextEncoder().encode(payload)

  // Generate ephemeral key pair
  const ephemeralKey = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  const receiverKey = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  )

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey },
    ephemeralKey.privateKey,
    256
  )

  // HKDF for content encryption key and nonce
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const ephemeralPublicKey = await crypto.subtle.exportKey('raw', ephemeralKey.publicKey)

  const ikm = await hkdfExtract(auth, new Uint8Array(sharedSecret))
  const prk = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk, buildInfo('aesgcm', p256dh, new Uint8Array(ephemeralPublicKey)), 16)
  const nonce = await hkdfExpand(prk, buildInfo('nonce', p256dh, new Uint8Array(ephemeralPublicKey)), 12)

  // Encrypt
  const encKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const paddedPayload = new Uint8Array([...new Uint8Array(2), ...payloadBytes])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    encKey,
    paddedPayload
  )

  // Build aes128gcm content
  const ephPubBytes = new Uint8Array(ephemeralPublicKey)
  const header = new Uint8Array([
    ...salt,
    ...[0, 0, 16, 0], // record size (4096 default) + key id length
    ephPubBytes.length,
    ...ephPubBytes,
  ])

  return new Uint8Array([...header, ...new Uint8Array(encrypted)])
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const result = await crypto.subtle.sign('HMAC', key, keyMaterial)
  return new Uint8Array(result)
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const result = await crypto.subtle.sign('HMAC', key, new Uint8Array([...info, 1]))
  return new Uint8Array(result).slice(0, length)
}

function buildInfo(type: string, receiverKey: Uint8Array, senderKey: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(`Content-Encoding: ${type}\0P-256\0`)
  const lenRec = new Uint8Array([(receiverKey.length >> 8) & 0xff, receiverKey.length & 0xff])
  const lenSnd = new Uint8Array([(senderKey.length >> 8) & 0xff, senderKey.length & 0xff])
  return new Uint8Array([...typeBytes, ...lenRec, ...receiverKey, ...lenSnd, ...senderKey])
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

// ── Handler ───────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, subscription, customerName, orderNumber } = await req.json()

    if (!subscription) {
      return new Response(JSON.stringify({ error: 'No subscription' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const parsedSub: PushSubscriptionJSON = JSON.parse(subscription)

    const payload = JSON.stringify({
      title: 'Pedido Pronto! 🎉',
      body: `${customerName}, seu pedido #${orderNumber} está pronto para retirada!`,
      orderId,
      url: `/pedido/${orderId}`,
    })

    const result = await sendWebPush(parsedSub, payload, {
      subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@pedidopronto.app',
      publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    })

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-push] Error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
