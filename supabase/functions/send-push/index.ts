// supabase/functions/send-push/index.ts
// Deploy: supabase functions deploy send-push
//
// Required secrets:
//   VAPID_SUBJECT             = mailto:seu@email.com
//   VAPID_PUBLIC_KEY          = public VAPID key
//   VAPID_PRIVATE_KEY         = private VAPID key
//   SUPABASE_URL              = (auto-provided by Supabase)
//   SUPABASE_ANON_KEY         = (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY = (auto-provided by Supabase)
//   APP_URL                   = https://pedidopronto.app (opcional, restringe CORS)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const allowedOrigin = Deno.env.get('APP_URL') || '*'

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SendPushBody = {
  orderId?: string
}

// Só serviços de push conhecidos. A subscription é gravada pelo navegador do
// cliente (sem login); sem esta lista, a função faria POST para qualquer URL
// que alguém gravasse ali (SSRF). Mantenha em sincronia com
// update_order_push_subscription (migration 20261116000000).
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge, Samsung, Opera, Brave
  /\.push\.services\.mozilla\.com$/,       // Firefox
  /\.push\.apple\.com$/,                   // Safari (iOS e macOS)
  /\.notify\.windows\.com$/,               // Edge / Windows
]

function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string') return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    return ALLOWED_PUSH_HOSTS.some((pattern) => pattern.test(url.hostname.toLowerCase()))
  } catch {
    return false
  }
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
    // 1. O chamador precisa estar autenticado — sem isso, qualquer pessoa
    //    com a anon key (pública, está no bundle do front-end) poderia usar
    //    esta função como um relay aberto de Web Push.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ ok: false, error: 'Missing Authorization header' }, 401)

    const supabaseUrl = getRequiredEnv('SUPABASE_URL')
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY')

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await callerClient.auth.getUser()
    if (userError || !user) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

    const { orderId } = await req.json() as SendPushBody
    if (!orderId) return jsonResponse({ ok: false, error: 'Missing orderId' }, 400)

    // 2. Busca o pedido e a subscription pelo service role — nunca confia
    //    em subscription vinda do corpo da requisição — e confirma que o
    //    pedido pertence ao estabelecimento do chamador.
    const serviceClient = createClient(supabaseUrl, getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'))

    const { data: order, error: orderError } = await serviceClient
      .from('orders')
      .select('id, customer_name, order_number, push_subscription, establishments!inner(owner_id)')
      .eq('id', orderId)
      .single()

    if (orderError || !order) return jsonResponse({ ok: false, error: 'Order not found' }, 404)

    const establishment = order.establishments as unknown as { owner_id: string } | null
    if (!establishment || establishment.owner_id !== user.id) {
      return jsonResponse({ ok: false, error: 'Forbidden' }, 403)
    }

    if (!order.push_subscription) {
      return jsonResponse({ ok: false, error: 'Order has no push subscription' }, 400)
    }

    if (!isAllowedPushEndpoint(order.push_subscription.endpoint)) {
      console.error('[send-push] Endpoint de push fora da lista permitida, pedido', orderId)
      await serviceClient.from('orders').update({ push_subscription: null }).eq('id', orderId)
      return jsonResponse({ ok: false, error: 'Push endpoint not allowed' }, 400)
    }

    const vapidSubject = getRequiredEnv('VAPID_SUBJECT')
    const vapidPublicKey = getRequiredEnv('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = getRequiredEnv('VAPID_PRIVATE_KEY')

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const payload = JSON.stringify({
      title: 'Pedido Pronto!',
      body:
        order.customer_name && order.customer_name !== 'Cliente'
          ? `${order.customer_name}, seu pedido #${order.order_number} está pronto para retirada!`
          : `Seu pedido #${order.order_number} está pronto para retirada!`,
      orderId,
      url: `/pedido/${orderId}`,
    })

    try {
      // TTL curto: um "pedido pronto" entregue horas depois só confunde.
      const result = await webpush.sendNotification(order.push_subscription, payload, {
        TTL: 1800,
        urgency: 'high',
      })
      return jsonResponse({ ok: true, statusCode: result.statusCode })
    } catch (pushErr) {
      const statusCode = (pushErr as { statusCode?: number }).statusCode
      console.error('[send-push] Falha no envio:', statusCode, (pushErr as Error).message)

      // 404/410 = o navegador do cliente cancelou a inscrição. Limpa para o
      // painel parar de mostrar "aviso ativo" num pedido que não avisa mais.
      if (statusCode === 404 || statusCode === 410) {
        await serviceClient.from('orders').update({ push_subscription: null }).eq('id', orderId)
        return jsonResponse({ ok: false, error: 'Inscrição de push expirada' }, 200)
      }
      return jsonResponse({ ok: false, error: 'Falha ao enviar push', statusCode }, 200)
    }
  } catch (err) {
    // Detalhes só no log do servidor — nada de corpo/cabeçalhos de terceiros
    // nem mensagens internas na resposta.
    console.error('[send-push] Error:', err)
    return jsonResponse({ ok: false, error: 'Erro interno ao enviar push' }, 500)
  }
})
