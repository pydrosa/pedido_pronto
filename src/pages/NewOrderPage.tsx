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
          toast.error('Pedido criado, mas o QR Code não foi gerado.')
        })
    }
  }, [createdOrder])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    const order = await createOrder(form)
    setLoading(false)
    if (order) setCreatedOrder(order)
  }

  const handleMarkReady = async () => {
    if (!createdOrder) return
    // markReady já mostra o toast certo (avisado, sem aviso ou falha).
    const ok = await markReady(createdOrder.id)
    if (ok) navigate('/')
  }

  const handleReset = () => {
    setCreatedOrder(null)
    setQrDataUrl('')
    setForm({ customer_name: '' })
  }

  const copyLink = async () => {
    if (!createdOrder) return
    try {
      await navigator.clipboard.writeText(getOrderUrl(createdOrder.id))
      toast.success('Link copiado!')
    } catch {
      toast.error('Não foi possível copiar o link.')
    }
  }

  if (createdOrder) {
    return (
      <div className="max-w-sm mx-auto animate-fade-in space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={handleReset}
            aria-label="Voltar e criar outro pedido"
            className="p-3 -ml-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mostre ao cliente</h1>
            <p className="text-sm text-gray-500">Ele aponta a câmera do celular para o QR Code</p>
          </div>
        </div>

        <div className="card p-6 flex flex-col items-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR Code do pedido ${createdOrder.order_number}`}
              className="w-64 h-64 animate-pop-in"
            />
          ) : (
            <div className="w-64 h-64 bg-gray-50 rounded-xl animate-pulse" />
          )}

          <div className="mt-4 text-center">
            <p className="text-4xl font-bold text-gray-900 tabular-nums">#{createdOrder.order_number}</p>
            <p className="text-gray-500 text-sm mt-1">{createdOrder.customer_name}</p>
          </div>
        </div>

        {/* Ação principal do balcão: atender o próximo cliente. */}
        <button onClick={handleReset} className="btn-primary w-full py-4 text-base" autoFocus>
          <RotateCcw size={18} />
          Próximo pedido
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={copyLink} className="btn-secondary w-full text-sm py-3">
            <Copy size={16} />
            Copiar link
          </button>
          <button onClick={handleMarkReady} className="btn-secondary w-full text-sm py-3">
            <CheckCircle size={16} />
            Já está pronto
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo pedido</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Gere o QR Code e mostre ao cliente
        </p>
      </div>

      <div className="card p-6">
        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label htmlFor="customer-name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome do cliente <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              id="customer-name"
              type="text"
              className="input"
              placeholder="Ex.: João"
              value={form.customer_name}
              onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
              maxLength={60}
              autoComplete="off"
              enterKeyHint="go"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Sem nome, o pedido é chamado só pelo número, gerado em sequência.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-4 text-base"
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
          <strong className="text-gray-700">Como funciona:</strong> após gerar o QR Code,
          mostre ao cliente. Ele escaneia com o celular e recebe um aviso
          assim que você marcar o pedido como pronto.
        </p>
      </div>
    </div>
  )
}
