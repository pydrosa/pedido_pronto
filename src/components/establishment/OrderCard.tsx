import { useState } from 'react'
import { CheckCircle, Package, Trash2, Clock, QrCode, BellRing } from 'lucide-react'
import { Order } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { generateQRCodeDataURL } from '@/lib/qrcode'

interface Props {
  order: Order
  onMarkReady: (id: string) => Promise<boolean>
  onMarkCollected: (id: string) => Promise<void>
  onNotifyAgain?: (id: string) => Promise<boolean>
  onDelete?: (id: string) => Promise<void>
  showDelete?: boolean
}

// A partir de quantos minutos de espera o cartão chama atenção.
const LATE_AFTER_MIN = 15

export default function OrderCard({ order, onMarkReady, onMarkCollected, onNotifyAgain, onDelete, showDelete }: Props) {
  const [loading, setLoading] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [qrUrl, setQrUrl] = useState('')

  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: ptBR })
  const waitedMin = (Date.now() - new Date(order.created_at).getTime()) / 60000
  const isLate = order.status === 'waiting' && waitedMin >= LATE_AFTER_MIN

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

  const handleNotifyAgain = async () => {
    if (!onNotifyAgain) return
    setLoading(true)
    await onNotifyAgain(order.id)
    setLoading(false)
  }

  const handleDelete = async () => {
    if (!onDelete) return
    const question =
      order.status === 'collected'
        ? `Remover o pedido #${order.order_number} do histórico?`
        : `Cancelar o pedido #${order.order_number}? O cliente deixa de ser avisado.`
    if (!confirm(question)) return
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
      <div className={`card p-4 transition-all ${
        order.status === 'ready' ? 'border-green-200 bg-green-50/30' : isLate ? 'border-red-200' : ''
      }`}>
        {/* No celular as ações vão para baixo: o nome não é mais cortado e o
            botão principal ocupa a largura do polegar. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <p className="font-semibold text-gray-900 truncate">
                #{order.order_number} — {order.customer_name}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`badge ${cls}`}>{label}</span>
              <span className={`text-xs flex items-center gap-1 ${isLate ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                <Clock size={11} />
                {timeAgo}
              </span>
              {order.push_subscription && (
                <span className="text-xs text-brand-600 flex items-center gap-1" title="O cliente ativou o aviso no celular">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                  Aviso ativo
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* empurra os ícones para a esquerda e o botão principal para a direita no celular */}
            <button
              onClick={handleShowQR}
              className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Ver QR Code"
              aria-label={`Ver QR Code do pedido ${order.order_number}`}
            >
              <QrCode size={18} />
            </button>

            {order.status === 'waiting' && (
              <button
                onClick={handleMarkReady}
                disabled={loading}
                className="btn-success text-sm px-4 py-2.5 flex-1 sm:flex-none order-last"
              >
                {loading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckCircle size={15} />
                )}
                Pronto
              </button>
            )}

            {order.status === 'ready' && onNotifyAgain && (
              <button
                onClick={handleNotifyAgain}
                disabled={loading}
                className="p-2.5 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-50"
                title="Chamar de novo"
                aria-label={`Avisar de novo o cliente do pedido ${order.order_number}`}
              >
                <BellRing size={18} />
              </button>
            )}

            {order.status === 'ready' && (
              <button
                onClick={handleCollected}
                disabled={loading}
                className="btn-secondary text-sm px-4 py-2.5 flex-1 sm:flex-none order-last"
              >
                <Package size={15} />
                Retirado
              </button>
            )}

            {showDelete && onDelete && (
              <button
                onClick={handleDelete}
                className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title={order.status === 'collected' ? 'Remover do histórico' : 'Cancelar pedido'}
                aria-label={`${order.status === 'collected' ? 'Remover' : 'Cancelar'} pedido ${order.order_number}`}
              >
                <Trash2 size={16} />
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
            <p className="text-xs text-gray-500 mt-3 text-center">
              Mostre este QR Code ao cliente para ele acompanhar o pedido
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
