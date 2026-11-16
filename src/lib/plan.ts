import { Establishment, PLANS } from '@/types'

export function canCreateOrder(
  establishment: Pick<Establishment, 'plan' | 'orders_this_month'>
): { allowed: boolean; reason?: string } {
  const plan = PLANS.find((p) => p.id === establishment.plan)
  if (!plan) return { allowed: false, reason: 'Plano desconhecido' }

  if (plan.max_orders_per_month !== null && establishment.orders_this_month >= plan.max_orders_per_month) {
    return {
      allowed: false,
      reason: `Limite de ${plan.max_orders_per_month} pedidos/mês do plano ${plan.name} atingido. Faça upgrade para continuar.`,
    }
  }

  return { allowed: true }
}
