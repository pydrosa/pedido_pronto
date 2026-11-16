// supabase/functions/stripe-checkout/index.ts
// Cria uma sessão do Stripe Checkout para o estabelecimento assinar um plano
//
// Required secrets:
//   STRIPE_SECRET_KEY   = sk_live_...
//   STRIPE_PRICE_BASIC  = price_...
//   STRIPE_PRICE_PRO    = price_...
//   APP_URL             = https://pedidopronto.app

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PRICE_BY_PLAN: Record<string, string | undefined> = {
  basic: Deno.env.get('STRIPE_PRICE_BASIC'),
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

    const { plan } = await req.json() as { plan?: string }
    const priceId = plan ? PRICE_BY_PLAN[plan] : undefined
    if (!priceId) return jsonResponse({ error: 'Plano invalido' }, 400)

    const { data: establishment, error: estError } = await supabase
      .from('establishments')
      .select('id, email, stripe_customer_id')
      .eq('owner_id', user.id)
      .single()

    if (estError || !establishment) return jsonResponse({ error: 'Estabelecimento nao encontrado' }, 404)

    const appUrl = Deno.env.get('APP_URL') ?? 'https://pedidopronto.app'

    // client_reference_id + metadata identificam o estabelecimento no
    // webhook — não dá para confiar em stripe_customer_id nesse primeiro
    // checkout porque o establishment ainda não tem um customer vinculado.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: establishment.stripe_customer_id || undefined,
      customer_email: establishment.stripe_customer_id ? undefined : establishment.email,
      client_reference_id: establishment.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { establishment_id: establishment.id },
      subscription_data: { metadata: { establishment_id: establishment.id } },
      success_url: `${appUrl}/configuracoes?checkout=success`,
      cancel_url: `${appUrl}/planos?checkout=cancelled`,
    })

    return jsonResponse({ url: session.url })
  } catch (err) {
    console.error('[stripe-checkout] Error:', err)
    return jsonResponse({ error: String(err) }, 500)
  }
})
