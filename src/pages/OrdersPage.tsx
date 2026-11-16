import { useState } from 'react'
import { Search, Filter } from 'lucide-react'
import { useOrders } from '@/hooks/useOrders'
import OrderCard from '@/components/establishment/OrderCard'
import { OrderStatus } from '@/types'

const FILTERS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Aguardando', value: 'waiting' },
  { label: 'Prontos', value: 'ready' },
  { label: 'Retirados', value: 'collected' },
]

export default function OrdersPage() {
  const { orders, loading, loadingMore, hasMore, loadMore, markReady, markCollected, notifyAgain, deleteOrder } = useOrders()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')

  const filtered = orders.filter((o) => {
    const matchStatus = filter === 'all' || o.status === filter
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      o.order_number.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
        <p className="text-gray-400 text-sm mt-0.5">Histórico completo de pedidos</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-10"
          placeholder="Buscar por número ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
              filter === value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {label}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              filter === value ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {value === 'all'
                ? orders.length
                : orders.filter((o) => o.status === value).length}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center">
          <Filter size={32} className="text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">Nenhum pedido encontrado</p>
          <p className="text-gray-400 text-sm mt-1">Tente ajustar os filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onMarkReady={markReady}
              onMarkCollected={markCollected}
              onNotifyAgain={notifyAgain}
              onDelete={deleteOrder}
              showDelete
            />
          ))}

          {hasMore && filter === 'all' && !search && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-secondary w-full text-sm disabled:opacity-60"
            >
              {loadingMore ? 'Carregando...' : 'Carregar mais pedidos'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
