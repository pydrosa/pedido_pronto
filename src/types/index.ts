// ─── Database types (match Supabase schema) ──────────────────────────────────

export type OrderStatus = 'waiting' | 'ready' | 'collected'
export type Plan = 'free' | 'basic' | 'pro'

export interface Establishment {
  id: string
  name: string
  email: string
  plan: Plan
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  orders_this_month: number
  created_at: string
  owner_id: string
}

export interface Order {
  id: string
  establishment_id: string
  order_number: string
  customer_name: string
  status: OrderStatus
  push_subscription: PushSubscriptionJSON | null
  notified_at: string | null
  created_at: string
  ready_at: string | null
  collected_at: string | null
}

// O que a RPC pública get_order_public devolve para a tela do cliente.
// push_subscription só existe no retorno do banco antigo (antes da migration
// 20261116000000); o banco novo devolve push_enabled.
export interface PublicOrder {
  id: string
  order_number: string
  customer_name: string
  status: OrderStatus
  created_at: string
  ready_at: string | null
  collected_at: string | null
  push_enabled?: boolean
  push_subscription?: unknown
  establishment_name?: string | null
  orders_ahead?: number | null
}

// ─── UI / App types ───────────────────────────────────────────────────────────

export interface CreateOrderInput {
  customer_name: string
}

export interface PlanConfig {
  id: Plan
  name: string
  price: number
  max_orders_per_month: number | null // null = unlimited
  max_users: number | null
  web_push: boolean
  history_days: number | null // null = unlimited
  stripe_price_id: string
}

export const PLANS: PlanConfig[] = [
  {
    id: 'free',
    name: 'Grátis',
    price: 0,
    max_orders_per_month: 20,
    max_users: 1,
    web_push: false,
    history_days: 7,
    stripe_price_id: '',
  },
  {
    id: 'basic',
    name: 'Básico',
    price: 4900, // centavos
    max_orders_per_month: null,
    max_users: 3,
    web_push: true,
    history_days: 30,
    stripe_price_id: import.meta.env.VITE_STRIPE_PRICE_BASIC || '',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 12900,
    max_orders_per_month: null,
    max_users: null,
    web_push: true,
    history_days: null,
    stripe_price_id: import.meta.env.VITE_STRIPE_PRICE_PRO || '',
  },
]

// ─── Realtime payload ─────────────────────────────────────────────────────────

export interface OrderRealtimePayload {
  new: Order
  old: Partial<Order>
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
}
