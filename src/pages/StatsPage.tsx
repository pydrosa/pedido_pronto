import { TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { useOrders } from '@/hooks/useOrders'
import { useAuth } from '@/hooks/useAuth'
import { PLANS } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default function StatsPage() {
  const { orders } = useOrders()
  const { establishment } = useAuth()

  const plan = PLANS.find((p) => p.id === establishment?.plan) ?? PLANS[0]

  const today = orders.filter((o) => {
    const d = new Date(o.created_at)
    return d.toDateString() === new Date().toDateString()
  })

  const collected = orders.filter((o) => o.status === 'collected')

  const avgWaitMs = collected
    .filter((o) => o.ready_at)
    .reduce((sum, o) => {
      const diff = new Date(o.ready_at!).getTime() - new Date(o.created_at).getTime()
      return sum + diff
    }, 0) / (collected.length || 1)

  const avgMinutes = Math.round(avgWaitMs / 60000)

  const notified = orders.filter((o) => o.notified_at).length
  const notifRate = orders.length > 0 ? Math.round((notified / orders.length) * 100) : 0

  const metrics = [
    { label: 'Pedidos hoje', value: today.length, icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Tempo médio (min)', value: avgMinutes || '—', icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Retirados', value: collected.length, icon: CheckCircle, color: 'text-brand-600', bg: 'bg-brand-50' },
    { label: 'Taxa de notificação', value: `${notifRate}%`, icon: AlertCircle, color: 'text-purple-500', bg: 'bg-purple-50' },
  ]

  const usagePercent = plan.max_orders_per_month
    ? Math.min(100, Math.round(((establishment?.orders_this_month ?? 0) / plan.max_orders_per_month) * 100))
    : null

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Estatísticas</h1>
        <p className="text-gray-400 text-sm mt-0.5">Desempenho do seu estabelecimento</p>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4">
            <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Plan usage */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Uso do plano</h2>
          <span className="badge bg-brand-50 text-brand-600 capitalize">
            {plan.name}
          </span>
        </div>
        <div className="flex justify-between text-sm text-gray-500 mb-2">
          <span>Pedidos este mês</span>
          <span className="font-medium text-gray-900">
            {establishment?.orders_this_month ?? 0}
            {plan.max_orders_per_month ? ` / ${plan.max_orders_per_month}` : ' / ilimitado'}
          </span>
        </div>
        {usagePercent !== null && (
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                usagePercent >= 90 ? 'bg-red-400' : usagePercent >= 70 ? 'bg-amber-400' : 'bg-brand-500'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        )}
        {usagePercent !== null && usagePercent >= 80 && (
          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
            <AlertCircle size={12} />
            Você está usando {usagePercent}% do limite. Considere fazer upgrade.
          </p>
        )}
      </div>

      {/* Recent activity */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Atividade recente</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhuma atividade ainda</p>
        ) : (
          <div className="space-y-3">
            {orders.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  o.status === 'waiting' ? 'bg-amber-400' :
                  o.status === 'ready' ? 'bg-green-400' : 'bg-gray-300'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    #{o.order_number} — {o.customer_name}
                  </p>
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">
                  {formatDistanceToNow(new Date(o.created_at), { addSuffix: true, locale: ptBR })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
