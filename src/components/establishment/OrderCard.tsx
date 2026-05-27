import { useState } from 'react'
import { CheckCircle, Package, Trash2, Clock, QrCode } from 'lucide-react'
import { Order } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { generateQRCodeDataURL } from '@/lib/qrcode'

interface Props {
  order: Order
  onMarkReady: (id: string) => Promise<boolean>
  onMarkCollected: (id: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  showDelete?: boolean
}

export default function OrderCard({ order, onMarkReady, onMarkCollected, onDelete, showDelete }: Props) {
  const [loading, setLoading] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [qrUrl, setQrUrl] = useState('')

  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: ptBR })

  const handleMarkReady = async () => {
    setLoading(true)
    await onMarkReady(order.id)
    setLoading(false)
  }

  const handleCollected = async () => {
    setLoading(true)
    await onMarkCollected(order.id)
    setLoading(false)
  }

  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirm(`Remover pedido #${order.order_number}?`)) return
    await onDelete(order.id)
  }

  const handleShowQR = async () => {
    if (!qrUrl) {
      const url = await generateQRCodeDataURL(order.id)
      setQrUrl(url)
    }
    setShowQR(true)
  }

  const statusConfig = {
    waiting: { label: 'Aguardando', cls: 'badge-waiting', dot: 'bg-amber-400' },
    ready:   { label: 'Pronto',     cls: 'badge-ready',   dot: 'bg-green-400 animate-pulse' },
    collected:{ label: 'Retirado',  cls: 'badge-collected',dot: 'bg-gray-300' },
  }
  const { label, cls, dot } = statusConfig[order.status]

  return (
    <>
      <div className={`card p-4 transition-all ${order.status === 'ready' ? 'border-green-200 bg-green-50/30' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <p className="font-semibold text-gray-900 truncate">
                #{order.order_number} — {order.customer_name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`badge ${cls}`}>{label}</span>
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock size={11} />
                {timeAgo}
              </span>
              {order.push_subscription && (
                <span className="text-xs text-brand-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                  Push ativo
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleShowQR}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Ver QR Code"
            >
              <QrCode size={16} />
            </button>

            {order.status === 'waiting' && (
              <button
                onClick={handleMarkReady}
                disabled={loading}
                className="btn-success text-sm px-3 py-1.5"
              >
                {loading ? (
                  <span className="w-3.5 h-3.5 border border-green-700/40 border-t-green-700 rounded-full animate-spin" />
                ) : (
                  <CheckCircle size={15} />
                )}
                Pronto
              </button>
            )}

            {order.status === 'ready' && (
              <button
                onClick={handleCollected}
                disabled={loading}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                <Package size={15} />
                Retirado
              </button>
            )}

            {showDelete && onDelete && order.status === 'collected' && (
              <button
                onClick={handleDelete}
                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Modal */}
      {showQR && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowQR(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 flex flex-col items-center shadow-2xl max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-bold text-gray-900 mb-1">Pedido #{order.order_number}</p>
            <p className="text-sm text-gray-400 mb-4">{order.customer_name}</p>
            {qrUrl && <img src={qrUrl} alt="QR Code" className="w-48 h-48 rounded-xl" />}
            <p className="text-xs text-gray-400 mt-3 text-center">
              Mostre este QR Code ao cliente para rastrear o pedido
            </p>
            <button
              onClick={() => setShowQR(false)}
              className="btn-secondary w-full mt-4 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
