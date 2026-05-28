import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, CheckCircle, Clock, AlertCircle, Loader2, Settings, Smartphone } from 'lucide-react'
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
  const [showPermissionGuide, setShowPermissionGuide] = useState(false)
  const hasTriggeredReady = useRef(false)

  useEffect(() => {
    if (!orderId) { setPageState('not_found'); return }

    supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setPageState('not_found'); return }
        const currentOrder = data as Order
        setOrder(currentOrder)
        setPageState(
          currentOrder.status === 'waiting'
            ? 'waiting'
            : currentOrder.status === 'ready'
              ? 'ready'
              : 'collected'
        )
        setPushEnabled(!!currentOrder.push_subscription)
      })
  }, [orderId])

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

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Pedido Pronto!', {
              body: `${updated.customer_name}, seu pedido #${updated.order_number} esta pronto!`,
              icon: '/icon.svg',
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
      setShowPermissionGuide(true)
      toast.error('Notificacoes nao suportadas neste navegador.')
      return
    }

    setPushLoading(true)
    try {
      const sub = await subscribeToPush()
      if (!sub) {
        setShowPermissionGuide(true)
        toast.error('Ative as notificacoes nas configuracoes do celular.')
        return
      }

      const serialized = serializeSubscription(sub)
      const { error } = await supabase
        .from('orders')
        .update({ push_subscription: serialized })
        .eq('id', order.id)

      if (error) throw error
      setPushEnabled(true)
      setShowPermissionGuide(false)
      toast.success('Notificacao ativada! Pode fechar o app.')
    } catch (error) {
      console.error('[Push] Erro ao ativar notificacao:', error)
      setShowPermissionGuide(true)
      toast.error('Erro ao ativar notificacao.')
    } finally {
      setPushLoading(false)
    }
  }

  if (pageState === 'loading') {
    return (
      <Screen>
        <Loader2 size={32} className="text-brand-400 animate-spin" />
        <p className="text-gray-400 text-sm mt-3">Carregando pedido...</p>
      </Screen>
    )
  }

  if (pageState === 'not_found') {
    return (
      <Screen>
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={30} className="text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Pedido nao encontrado</h1>
        <p className="text-gray-400 text-sm mt-2 text-center max-w-xs">
          Este QR Code e invalido ou o pedido foi removido.
        </p>
      </Screen>
    )
  }

  if (pageState === 'ready') {
    return (
      <Screen>
        <div className="w-24 h-24 bg-brand-50 rounded-full flex items-center justify-center mb-6 animate-pop-in">
          <CheckCircle size={48} className="text-brand-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 animate-slide-up">
          Pedido pronto!
        </h1>
        <p className="text-gray-500 mt-2 text-center animate-slide-up">
          <strong>{order?.customer_name}</strong>, seu pedido <strong>#{order?.order_number}</strong> esta pronto para retirada.
        </p>

        <div className="mt-6 w-full max-w-xs bg-brand-50 border border-brand-100 rounded-2xl p-4 animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Bell size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-brand-800 text-sm">Pedido Pronto</p>
              <p className="text-brand-600 text-xs mt-0.5">
                Dirija-se ao balcao para retirar seu pedido
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-300 mt-6">Seu celular vibrou para te avisar</p>
      </Screen>
    )
  }

  if (pageState === 'collected') {
    return (
      <Screen>
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-5">
          <CheckCircle size={36} className="text-gray-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Pedido retirado</h1>
        <p className="text-gray-400 text-sm mt-2">Obrigado pela visita!</p>
      </Screen>
    )
  }

  return (
    <Screen>
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
        Ola, <strong>{order?.customer_name}</strong>!
      </p>
      <p className="text-gray-400 text-sm mt-1 mb-6">Seu pedido esta sendo preparado...</p>

      {!pushEnabled ? (
        <button
          onClick={() => setShowPermissionGuide(true)}
          disabled={pushLoading}
          className="btn-primary w-full max-w-xs py-4 text-base mb-4"
        >
          {pushLoading ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
          {pushLoading ? 'Ativando...' : 'Ativar aviso no celular'}
        </button>
      ) : (
        <div className="w-full max-w-xs bg-brand-50 border border-brand-100 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <Bell size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-800">Aviso ativado</p>
              <p className="text-xs text-brand-600">Pode fechar o app. Vamos te avisar.</p>
            </div>
          </div>
          <button
            onClick={() => setShowPermissionGuide(true)}
            disabled={pushLoading}
            className="mt-3 w-full text-xs font-medium text-brand-700 hover:underline disabled:opacity-60"
          >
            {pushLoading ? 'Reativando...' : 'Reativar aviso neste celular'}
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center max-w-xs leading-relaxed">
        Para receber com a tela fechada, permita notificacoes no celular quando o sistema pedir.
      </p>

      {showPermissionGuide && (
        <PermissionGuide
          loading={pushLoading}
          onClose={() => setShowPermissionGuide(false)}
          onContinue={enablePush}
        />
      )}

      <div className="absolute bottom-6 flex items-center gap-1.5 opacity-40">
        <div className="w-5 h-5 bg-brand-600 rounded flex items-center justify-center">
          <Bell size={10} className="text-white" />
        </div>
        <span className="text-xs text-gray-500 font-medium">Pedido Pronto</span>
      </div>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 relative">
      {children}
    </div>
  )
}

function PermissionGuide({
  loading,
  onClose,
  onContinue,
}: {
  loading: boolean
  onClose: () => void
  onContinue: () => void
}) {
  const guide = getPermissionGuide()

  return (
    <div className="fixed inset-0 z-50 bg-white px-6 py-8 flex flex-col">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
          {guide.kind === 'settings' ? (
            <Settings size={26} className="text-white" />
          ) : (
            <Smartphone size={26} className="text-white" />
          )}
        </div>

        <h2 className="text-2xl font-bold text-gray-900">{guide.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">{guide.description}</p>

        <div className="mt-6 space-y-3">
          {guide.steps.map((step, index) => (
            <div key={step} className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {index + 1}
              </div>
              <p className="text-sm leading-relaxed text-gray-700">{step}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onContinue}
          disabled={loading}
          className="btn-primary mt-6 w-full py-4 text-base"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
          {loading ? 'Ativando...' : guide.primaryAction}
        </button>

        <button
          onClick={onClose}
          disabled={loading}
          className="mt-3 w-full py-3 text-sm font-medium text-gray-500 disabled:opacity-60"
        >
          Voltar
        </button>
      </div>
    </div>
  )
}

function getPermissionGuide(): {
  kind: 'prompt' | 'settings'
  title: string
  description: string
  primaryAction: string
  steps: string[]
} {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean(navigator.standalone))
  const permission = 'Notification' in window ? Notification.permission : 'denied'

  if (isIOS && !isStandalone) {
    return {
      kind: 'settings',
      title: 'Instale na tela inicial para avisos',
      description: 'No iPhone, avisos com a tela fechada funcionam como app instalado na Tela de Inicio.',
      primaryAction: 'Tentar ativar depois de instalar',
      steps: [
        'Abra este QR Code no Safari.',
        'Toque no botao Compartilhar do Safari.',
        'Escolha Adicionar a Tela de Inicio.',
        'Abra o Pedido Pronto pelo icone criado.',
        'Volte neste pedido e toque em Ativar aviso no celular.',
      ],
    }
  }

  if (permission === 'denied') {
    return {
      kind: 'settings',
      title: 'Libere nas configuracoes do celular',
      description: 'A permissao ja foi bloqueada antes. O sistema nao deixa o app pedir de novo ate voce liberar manualmente.',
      primaryAction: 'Ja liberei, ativar aviso',
      steps: isAndroid
        ? [
            'Abra Configuracoes do celular.',
            'Entre em Apps e escolha o navegador usado, como Chrome ou Samsung Internet.',
            'Abra Notificacoes e permita notificacoes.',
            'Em Sites ou Configuracoes do site, libere apppedidopronto.vercel.app.',
            'Volte para esta tela e toque no botao abaixo.',
          ]
        : [
            'Abra Ajustes do celular.',
            'Entre em Notificacoes.',
            'Escolha Pedido Pronto ou o navegador usado.',
            'Ative Permitir Notificacoes.',
            'Volte para esta tela e toque no botao abaixo.',
          ],
    }
  }

  return {
    kind: 'prompt',
    title: 'Permita o aviso do celular',
    description: 'Na proxima etapa o sistema vai mostrar uma permissao. Toque em Permitir para receber o aviso mesmo com esta aba fechada.',
    primaryAction: 'Mostrar permissao do celular',
    steps: [
      'Toque no botao abaixo.',
      'Quando o celular perguntar sobre notificacoes, toque em Permitir.',
      'Depois disso pode fechar esta aba. O aviso chegara quando o pedido ficar pronto.',
    ],
  }
}
