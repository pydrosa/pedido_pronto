// supabase/functions/send-push/index.ts
// Deploy: supabase functions deploy send-push
//
// Required secrets:
//   VAPID_SUBJECT     = mailto:seu@email.com
//   VAPID_PUBLIC_KEY  = public VAPID key
//   VAPID_PRIVATE_KEY = private VAPID key

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SendPushBody = {
  orderId?: string
  subscription?: string
  customerName?: string
  orderNumber?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, subscription, customerName, orderNumber } = await req.json() as SendPushBody

    if (!orderId) return jsonResponse({ error: 'Missing orderId' }, 400)
    if (!subscription) return jsonResponse({ error: 'Missing subscription' }, 400)

    const vapidSubject = getRequiredEnv('VAPID_SUBJECT')
    const vapidPublicKey = getRequiredEnv('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = getRequiredEnv('VAPID_PRIVATE_KEY')
    const parsedSubscription = JSON.parse(subscription)

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const payload = JSON.stringify({
      title: 'Pedido Pronto!',
      body: `${customerName || 'Cliente'}, seu pedido #${orderNumber || ''} esta pronto para retirada!`,
      orderId,
      url: `/pedido/${orderId}`,
    })

    const result = await webpush.sendNotification(parsedSubscription, payload, {
      TTL: 86400,
      urgency: 'high',
    })

    return jsonResponse({
      ok: true,
      statusCode: result.statusCode,
      headers: result.headers,
    })
  } catch (err) {
    const error = err as Error & { statusCode?: number; body?: string; headers?: Record<string, string> }
    console.error('[send-push] Error:', error)

    return jsonResponse({
      ok: false,
      error: error.message || String(error),
      statusCode: error.statusCode,
      body: error.body,
      headers: error.headers,
    }, 500)
  }
})
