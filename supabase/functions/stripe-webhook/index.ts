// supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook
//
// Required secrets:
//   STRIPE_SECRET_KEY        = sk_live_...
//   STRIPE_WEBHOOK_SECRET    = whsec_...
//
// Configure no Stripe Dashboard:
//   Webhook URL: https://<project>.supabase.co/functions/v1/stripe-webhook
//   Events: customer.subscription.updated, customer.subscription.deleted,
//            checkout.session.completed

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const PLAN_PRICE_MAP: Record<string, 'basic' | 'pro'> = {
  [Deno.env.get('STRIPE_PRICE_BASIC') ?? 'price_basic']: 'basic',
  [Deno.env.get('STRIPE_PRICE_PRO') ?? 'price_pro']: 'pro',
}

serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response(`Webhook Error: ${err}`, { status: 400 })
  }

  console.log(`[stripe-webhook] Event: ${event.type}`)

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const customerId = session.customer as string
      const subscriptionId = session.subscription as string
      const establishmentId = session.client_reference_id || session.metadata?.establishment_id

      if (!establishmentId) {
        console.error('[stripe-webhook] Checkout session sem establishment_id:', session.id)
        break
      }

      // Get plan from subscription
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const priceId = sub.items.data[0]?.price.id
      const plan = PLAN_PRICE_MAP[priceId] ?? 'basic'

      // No primeiro checkout o establishment ainda não tem stripe_customer_id
      // salvo, então o vínculo precisa ser feito pelo id do estabelecimento
      // (client_reference_id/metadata), não pelo customer_id do Stripe.
      await supabase
        .from('establishments')
        .update({
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan,
        })
        .eq('id', establishmentId)

      console.log(`[stripe-webhook] Upgraded establishment ${establishmentId} to ${plan}`)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const priceId = sub.items.data[0]?.price.id
      const plan = PLAN_PRICE_MAP[priceId] ?? 'free'

      await supabase
        .from('establishments')
        .update({ plan, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer as string)

      console.log(`[stripe-webhook] Plan updated to ${plan}`)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription

      await supabase
        .from('establishments')
        .update({ plan: 'free', stripe_subscription_id: null })
        .eq('stripe_customer_id', sub.customer as string)

      console.log(`[stripe-webhook] Subscription cancelled, downgraded to free`)
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
