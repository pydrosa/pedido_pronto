import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Order } from '@/types'
import {
  subscribeToPush,
  isPushSupported,
  vibrate,
  serializeSubscription,
} from '@/lib/push'
import toast from 'react-hot-toast'

type PageState = 'loading' | 'waiting' | 'ready' | 'collected' | 'not_found' | 'error'

export default function ClientOrderPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const hasTriggeredReady = useRef(false)

  // Load order on mount
  useEffect(() => {
    if (!orderId) { setPageState('not_found'); return }

    supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setPageState('not_found'); return }
        const o = data as Order
        setOrder(o)
        setPageState(o.status === 'waiting' ? 'waiting' : o.status === 'ready' ? 'ready' : 'collected')
        setPushEnabled(!!o.push_subscription)
      })
  }, [orderId])

  // Realtime subscription
  useEffect(() => {
    if (!orderId) return

    const channel = supabase
      .channel(`client-order:${orderId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      }, (payload) => {
        const updated = payload.new as Order
        setOrder(updated)

        if (updated.status === 'ready' && !hasTriggeredReady.current) {
          hasTriggeredReady.current = true
          setPageState('ready')
          vibrate([300, 100, 300, 100, 500])
          // Also show browser notification if page is in background
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Pedido Pronto! 🎉', {
              body: `${updated.customer_name}, seu pedido #${updated.order_number} está pronto!`,
              icon: '/icons/icon-192.png',
              tag: `order-${orderId}`,
            })
          }
        } else if (updated.status === 'collected') {
          setPageState('collected')
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orderId])

  const enablePush = async () => {
    if (!order) return
    if (!isPushSupported()) {
      toast.error('Notificações não suportadas neste navegador.')
      return
    }
    setPushLoading(true)
    try {
      const sub = await subscribeToPush()
      if (!sub) {
        toast.error('Permissão de notificação negada. Ative nas configurações do navegador.')
        return
      }
      const serialized = serializeSubscription(sub)
      const { error } = await supabase
        .from('orders')
        .update({ push_subscription: serialized })
        .eq('id', order.id)

      if (error) throw error
      setPushEnabled(true)
      toast.success('Notificação ativada! Pode fechar o app.')
    } catch {
      toast.error('Erro ao ativar notificação.')
    } finally {
      setPushLoading(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <Screen>
        <Loader2 size={32} className="text-brand-400 animate-spin" />
        <p className="text-gray-400 text-sm mt-3">Carregando pedido...</p>
      </Screen>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (pageState === 'not_found') {
    return (
      <Screen>
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={30} className="text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Pedido não encontrado</h1>
        <p className="text-gray-400 text-sm mt-2 text-center max-w-xs">
          Este QR Code é inválido ou o pedido foi removido.
        </p>
      </Screen>
    )
  }

  // ── Ready 🎉 ──────────────────────────────────────────────────────────────
  if (pageState === 'ready') {
    return (
      <Screen>
        <div className="w-24 h-24 bg-brand-50 rounded-full flex items-center justify-center mb-6 animate-pop-in">
          <CheckCircle size={48} className="text-brand-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 animate-slide-up">
          Pedido pronto! 🎉
        </h1>
        <p className="text-gray-500 mt-2 text-center animate-slide-up">
          <strong>{order?.customer_name}</strong>, seu pedido <strong>#{order?.order_number}</strong> está pronto para retirada.
        </p>

        <div className="mt-6 w-full max-w-xs bg-brand-50 border border-brand-100 rounded-2xl p-4 animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Bell size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-brand-800 text-sm">Pedido Pronto</p>
              <p className="text-brand-600 text-xs mt-0.5">
                Dirija-se ao balcão para retirar seu pedido
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-300 mt-6">Seu celular vibrou para te avisar 📳</p>
      </Screen>
    )
  }

  // ── Collected ─────────────────────────────────────────────────────────────
  if (pageState === 'collected') {
    return (
      <Screen>
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-5">
          <CheckCircle size={36} className="text-gray-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Pedido retirado</h1>
        <p className="text-gray-400 text-sm mt-2">Obrigado pela visita! Até a próxima 👋</p>
      </Screen>
    )
  }

  // ── Waiting (default) ─────────────────────────────────────────────────────
  return (
    <Screen>
      {/* Animated waiting icon */}
      <div className="relative mb-6">
        <div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center">
          <Clock size={40} className="text-amber-500 animate-pulse-slow" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-amber-200 animate-ping opacity-30" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        Pedido #{order?.order_number}
      </h1>
      <p className="text-gray-500 mt-1">
        Olá, <strong>{order?.customer_name}</strong>!
      </p>
      <p className="text-gray-400 text-sm mt-1 mb-6">Seu pedido está sendo preparado...</p>

      {/* Push notification button */}
      {!pushEnabled ? (
        <button
          onClick={enablePush}
          disabled={pushLoading}
          className="btn-primary w-full max-w-xs py-4 text-base mb-4"
        >
          {pushLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Bell size={18} />
          )}
          {pushLoading ? 'Ativando...' : 'Ativar notificação e fechar'}
        </button>
      ) : (
        <div className="w-full max-w-xs bg-brand-50 border border-brand-100 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <Bell size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-800">Notificação ativada</p>
              <p className="text-xs text-brand-600">Pode fechar o app — vamos te avisar!</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center max-w-xs leading-relaxed">
        Você receberá uma notificação e o celular vai vibrar quando seu pedido ficar pronto.
      </p>

      {/* Powered by */}
      <div className="absolute bottom-6 flex items-center gap-1.5 opacity-40">
        <div className="w-5 h-5 bg-brand-600 rounded flex items-center justify-center">
          <Bell size={10} className="text-white" />
        </div>
        <span className="text-xs text-gray-500 font-medium">Pedido Pronto</span>
      </div>
    </Screen>
  )
}

// Centered screen wrapper
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 relative">
      {children}
    </div>
  )
}
