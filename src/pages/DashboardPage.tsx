import { Clock, CheckCircle, ListOrdered, TrendingUp, ChevronRight, Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useOrders } from '@/hooks/useOrders'
import OrderCard from '@/components/establishment/OrderCard'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default function DashboardPage() {
  const { establishment } = useAuth()
  const { activeOrders, readyOrders, todayOrders, loading, markReady, markCollected } = useOrders()

  const greet = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greet()}, {establishment?.name?.split(' ')[0] ?? 'bem-vindo'}!
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Link to="/novo-pedido" className="btn-primary text-sm px-4 py-2.5">
          + Novo pedido
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Aguardando', value: activeOrders.length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
          { label: 'Prontos', value: readyOrders.length, icon: Bell, color: 'text-brand-600', bg: 'bg-brand-50' },
          { label: 'Hoje', value: todayOrders.length, icon: ListOrdered, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Este mês', value: establishment?.orders_this_month ?? 0, icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4">
            <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Ready orders — needs action */}
      {readyOrders.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Prontos — aguardando retirada ({readyOrders.length})
          </h2>
          <div className="space-y-3">
            {readyOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onMarkReady={markReady}
                onMarkCollected={markCollected}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Em preparo ({activeOrders.length})
          </h2>
          {activeOrders.length > 3 && (
            <Link to="/pedidos" className="text-xs text-brand-600 flex items-center gap-1 hover:underline">
              Ver todos <ChevronRight size={14} />
            </Link>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="card p-8 flex flex-col items-center text-center">
            <CheckCircle size={36} className="text-gray-200 mb-3" />
            <p className="text-gray-500 font-medium">Nenhum pedido em espera</p>
            <p className="text-gray-400 text-sm mt-1">
              Crie um novo pedido para começar
            </p>
            <Link to="/novo-pedido" className="btn-primary text-sm mt-4 px-4">
              + Novo pedido
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {activeOrders.slice(0, 5).map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onMarkReady={markReady}
                onMarkCollected={markCollected}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
