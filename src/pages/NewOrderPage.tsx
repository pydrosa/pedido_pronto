import { useState, useEffect } from 'react'
import { QrCode, CheckCircle, Copy, RotateCcw, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOrders } from '@/hooks/useOrders'
import { generateQRCodeDataURL, getOrderUrl } from '@/lib/qrcode'
import { Order } from '@/types'
import toast from 'react-hot-toast'

export default function NewOrderPage() {
  const { createOrder, markReady } = useOrders()
  const navigate = useNavigate()
  const [form, setForm] = useState({ customer_name: '' })
  const [loading, setLoading] = useState(false)
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    if (createdOrder) {
      setQrDataUrl('')
      generateQRCodeDataURL(createdOrder.id)
        .then(setQrDataUrl)
        .catch((error) => {
          console.error('[QR] Erro ao gerar QR Code:', error)
          toast.error('Pedido criado, mas o QR Code nao foi gerado.')
        })
    }
  }, [createdOrder])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.customer_name) return
    setLoading(true)
    const order = await createOrder(form)
    setLoading(false)
    if (order) setCreatedOrder(order)
  }

  const handleMarkReady = async () => {
    if (!createdOrder) return
    await markReady(createdOrder.id)
    toast.success('Pedido marcado como pronto! Cliente notificado.')
    navigate('/')
  }

  const handleReset = () => {
    setCreatedOrder(null)
    setQrDataUrl('')
    setForm({ customer_name: '' })
  }

  const copyLink = () => {
    if (!createdOrder) return
    navigator.clipboard.writeText(getOrderUrl(createdOrder.id))
    toast.success('Link copiado!')
  }

  if (createdOrder) {
    return (
      <div className="max-w-sm mx-auto animate-fade-in space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft size={20} className="text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">QR Code gerado!</h1>
            <p className="text-sm text-gray-400">Mostre ao cliente para escanear</p>
          </div>
        </div>

        <div className="card p-6 flex flex-col items-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR Code do pedido ${createdOrder.order_number}`}
              className="w-52 h-52 animate-pop-in"
            />
          ) : (
            <div className="w-52 h-52 bg-gray-50 rounded-xl animate-pulse" />
          )}

          <div className="mt-4 text-center">
            <p className="text-lg font-bold text-gray-900">Pedido #{createdOrder.order_number}</p>
            <p className="text-gray-500 text-sm">{createdOrder.customer_name}</p>
          </div>

          <div className="mt-4 w-full bg-brand-50 rounded-xl p-3 text-center">
            <p className="text-xs text-brand-600 font-medium">
              Cliente escaneia e aguarda a notificacao
            </p>
          </div>
        </div>

        <button
          onClick={handleMarkReady}
          className="btn-primary w-full py-3.5 text-base"
        >
          <CheckCircle size={20} />
          Marcar como pronto agora
        </button>

        <button onClick={copyLink} className="btn-secondary w-full">
          <Copy size={16} />
          Copiar link do pedido
        </button>

        <button onClick={handleReset} className="btn-secondary w-full">
          <RotateCcw size={16} />
          Criar outro pedido
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo pedido</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Informe o cliente e gere o QR Code
        </p>
      </div>

      <div className="card p-6">
        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome do cliente
            </label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Joao Silva"
              value={form.customer_name}
              onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
              required
              autoFocus
            />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs text-gray-500 leading-relaxed">
              O numero do pedido sera gerado automaticamente em sequencia.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !form.customer_name}
            className="btn-primary w-full py-3.5 text-base"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Gerando QR Code...
              </span>
            ) : (
              <>
                <QrCode size={20} />
                Gerar QR Code
              </>
            )}
          </button>
        </form>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-700">Como funciona:</strong> apos gerar o QR Code,
          mostre ao cliente. Ele escaneia com o celular e recebe uma notificacao
          assim que voce marcar o pedido como pronto.
        </p>
      </div>
    </div>
  )
}
