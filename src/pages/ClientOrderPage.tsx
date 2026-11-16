import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bell, BellRing, Check, CheckCircle, AlertCircle, Loader2, Settings, Smartphone, Volume2, WifiOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { OrderStatus, PublicOrder } from '@/types'
import { subscribeToPush, isPushSupported, vibrate, toSubscriptionPayload } from '@/lib/push'
import { unlockAudio, playReadyChime, keepScreenAwake, releaseScreen } from '@/lib/alert'
import toast from 'react-hot-toast'

type PageState = 'loading' | OrderStatus | 'not_found' | 'error'
type GuideKind = 'ios-install' | 'denied'

// Rede de segurança: o aviso em tempo real chega por broadcast, mas conexões
// móveis caem e abas em segundo plano são suspensas. O polling garante que a
// tela nunca fique presa em "em preparo".
const POLL_MS = 8_000

function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  )
}

export default function ClientOrderPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [activating, setActivating] = useState(false)
  const [guide, setGuide] = useState<GuideKind | null>(null)
  const lastStatus = useRef<OrderStatus | null>(null)
  const soundEnabledRef = useRef(false)

  const announceReady = useCallback(() => {
    vibrate([300, 100, 300, 100, 500])
    playReadyChime()
    document.title = '🔔 Pedido pronto!'
  }, [])

  const applyOrder = useCallback((next: PublicOrder) => {
    const previous = lastStatus.current
    lastStatus.current = next.status
    setOrder(next)
    setPageState(next.status)
    if (next.push_enabled ?? Boolean(next.push_subscription)) setPushEnabled(true)

    // Só anuncia na transição vista por esta página (não ao recarregar um
    // pedido que já estava pronto).
    if (next.status === 'ready' && previous === 'waiting') announceReady()
    if (next.status === 'collected') releaseScreen()
  }, [announceReady])

  const refresh = useCallback(async () => {
    if (!orderId) return
    const { data, error } = await supabase.rpc('get_order_public', { p_order_id: orderId })

    if (error) {
      // Erro com código = resposta do banco (UUID inválido, pedido inexistente
      // no banco antigo). Sem código = falha de rede: mantém o que já está na
      // tela e tenta de novo no próximo ciclo.
      if (error.code) setPageState('not_found')
      else setPageState((current) => (current === 'loading' ? 'error' : current))
      return
    }
    if (!data) {
      setPageState('not_found')
      return
    }
    applyOrder(data as PublicOrder)
  }, [orderId, applyOrder])

  // Carga inicial + polling + volta do segundo plano.
  useEffect(() => {
    if (!orderId) {
      setPageState('not_found')
      return
    }

    void refresh()

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (lastStatus.current === 'collected') return
      void refresh()
    }, POLL_MS)

    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      void refresh()
      // O navegador solta o wake lock quando a aba vai para segundo plano.
      if (soundEnabledRef.current && lastStatus.current === 'waiting') void keepScreenAwake()
    }

    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      releaseScreen()
    }
  }, [orderId, refresh])

  // Tempo real: canal público cujo nome é o próprio UUID do pedido. O banco
  // publica nele a cada mudança de status (gatilho order_status_broadcast).
  useEffect(() => {
    if (!orderId) return

    const channel = supabase
      .channel(`order:${orderId}`)
      .on('broadcast', { event: 'status' }, () => { void refresh() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [orderId, refresh])

  // Título da aba acompanha o pedido (ajuda quem deixa a aba aberta).
  useEffect(() => {
    if (!order) return
    if (order.status === 'waiting') document.title = `#${order.order_number} em preparo · Pedido Pronto`
    else if (order.status === 'ready') document.title = '🔔 Pedido pronto!'
    else document.title = 'Pedido Pronto'
    return () => { document.title = 'Pedido Pronto' }
  }, [order])

  // Um toque: libera o som, mantém a tela acesa e — onde o navegador permite —
  // pede a permissão de notificação para avisar mesmo com a tela bloqueada.
  const activateAlert = async () => {
    if (!order || activating) return

    // Precisa acontecer dentro do gesto do usuário.
    const audioOk = unlockAudio()
    void keepScreenAwake()
    soundEnabledRef.current = true
    setSoundEnabled(true)

    const pushPossible = isPushSupported()
    if (!pushPossible) {
      // Safari no iPhone (fora da Tela de Início) e navegadores sem push.
      toast.success(audioOk ? 'Aviso sonoro ativado. Mantenha esta página aberta.' : 'Mantenha esta página aberta para ver o aviso.')
      return
    }

    if (Notification.permission === 'denied') {
      setGuide('denied')
      return
    }

    setActivating(true)
    // O pedido de permissão pode ficar aberto indefinidamente (o cliente
    // ignora o aviso do sistema). A tela não fica presa em "Ativando...":
    // depois de alguns segundos volta ao aviso sonoro, e uma resposta tardia
    // ainda é aproveitada.
    const unblock = window.setTimeout(() => setActivating(false), 12_000)
    try {
      const sub = await subscribeToPush()
      if (!sub) {
        // Usuário negou ou fechou o pedido de permissão: fica com o aviso sonoro.
        toast('Sem notificação do sistema — vamos avisar com som nesta página.', { icon: '🔊' })
        return
      }

      const { error } = await supabase.rpc('update_order_push_subscription', {
        p_order_id: order.id,
        p_subscription: toSubscriptionPayload(sub),
      })
      if (error) throw error

      setPushEnabled(true)
      setGuide(null)
      toast.success('Aviso ativado! Pode guardar o celular.')
    } catch (error) {
      console.error('[Push] Erro ao ativar notificação:', error)
      toast('Não deu para ativar a notificação do sistema. Mantenha esta página aberta: avisamos com som.', { icon: '🔊' })
    } finally {
      window.clearTimeout(unblock)
      setActivating(false)
    }
  }

  if (pageState === 'loading') {
    return (
      <Screen>
        <Loader2 size={32} className="text-brand-400 animate-spin" />
        <p className="text-gray-500 text-sm mt-3">Carregando pedido...</p>
      </Screen>
    )
  }

  if (pageState === 'error') {
    return (
      <Screen>
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-4">
          <WifiOff size={28} className="text-amber-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Sem conexão</h1>
        <p className="text-gray-500 text-sm mt-2 text-center max-w-xs">
          Não conseguimos carregar o pedido. Confira sua internet e tente de novo.
        </p>
        <button onClick={() => { setPageState('loading'); void refresh() }} className="btn-primary mt-6 px-6 py-3">
          Tentar novamente
        </button>
      </Screen>
    )
  }

  if (pageState === 'not_found' || !order) {
    return (
      <Screen>
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={30} className="text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Pedido não encontrado</h1>
        <p className="text-gray-500 text-sm mt-2 text-center max-w-xs">
          Este QR Code é inválido ou o pedido foi removido. Fale com o atendente.
        </p>
      </Screen>
    )
  }

  const showName = order.customer_name && order.customer_name !== 'Cliente'

  if (pageState === 'ready') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-brand-600 px-6 text-white text-center" role="alert">
        <div className="w-24 h-24 bg-white/15 rounded-full flex items-center justify-center mb-6 animate-pop-in">
          <BellRing size={46} className="text-white" />
        </div>
        <p className="text-brand-100 text-sm font-medium uppercase tracking-widest animate-slide-up">
          {order.establishment_name || 'Seu pedido'}
        </p>
        <h1 className="text-4xl font-bold mt-2 animate-slide-up">Está pronto!</h1>
        <p className="text-7xl font-bold mt-6 tabular-nums animate-pop-in">#{order.order_number}</p>
        {showName && <p className="text-xl mt-2 text-brand-50">{order.customer_name}</p>}
        <p className="mt-8 text-lg font-medium bg-white/15 rounded-2xl px-6 py-4">
          Retire no balcão e mostre esta tela
        </p>
      </div>
    )
  }

  if (pageState === 'collected') {
    return (
      <Screen>
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-5">
          <CheckCircle size={36} className="text-gray-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Pedido retirado</h1>
        <p className="text-gray-500 text-sm mt-2">
          {order.establishment_name ? `${order.establishment_name} agradece a visita!` : 'Obrigado pela visita!'}
        </p>
      </Screen>
    )
  }

  // ── Em preparo ─────────────────────────────────────────────────────────────
  const ahead = typeof order.orders_ahead === 'number' ? order.orders_ahead : null
  const iosInSafari = isIOS() && !isStandalone()

  return (
    <Screen>
      {order.establishment_name && (
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">
          {order.establishment_name}
        </p>
      )}

      <p className="text-sm text-gray-500">Seu pedido</p>
      <h1 className="text-7xl font-bold text-gray-900 tabular-nums leading-none mt-1">
        #{order.order_number}
      </h1>
      {showName && <p className="text-gray-600 mt-3">Olá, <strong>{order.customer_name}</strong>!</p>}

      <Steps />

      {ahead !== null && (
        <p className="text-sm text-gray-500 mb-5" aria-live="polite">
          {ahead === 0
            ? 'Nenhum pedido na sua frente.'
            : ahead === 1
              ? '1 pedido antes do seu.'
              : `${ahead} pedidos antes do seu.`}
        </p>
      )}

      {pushEnabled ? (
        <StatusCard
          icon={<Bell size={16} className="text-white" />}
          title="Aviso ativado"
          text="Pode guardar o celular. Ele vai tocar quando o pedido ficar pronto."
        />
      ) : soundEnabled ? (
        <>
          <StatusCard
            icon={<Volume2 size={16} className="text-white" />}
            title="Aviso sonoro ativado"
            text="Mantenha esta página aberta e o som do celular ligado."
          />
          {iosInSafari && (
            <button
              onClick={() => setGuide('ios-install')}
              className="mt-3 text-sm font-medium text-brand-700 underline underline-offset-2"
            >
              Quero receber com a tela bloqueada
            </button>
          )}
          {!iosInSafari && isPushSupported() && (
            <button
              onClick={activateAlert}
              disabled={activating}
              className="mt-3 text-sm font-medium text-brand-700 underline underline-offset-2 disabled:opacity-60"
            >
              {activating ? 'Ativando...' : 'Ativar também a notificação do celular'}
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={activateAlert}
            disabled={activating}
            className="btn-primary w-full max-w-xs py-4 text-lg"
          >
            {activating ? <Loader2 size={20} className="animate-spin" /> : <Bell size={20} />}
            {activating ? 'Ativando...' : 'Me avise quando ficar pronto'}
          </button>
          <p className="text-xs text-gray-500 text-center max-w-xs leading-relaxed mt-3">
            {iosInSafari
              ? 'Um toque: avisamos com som nesta página. Não precisa instalar nada.'
              : 'Toque no botão e depois em “Permitir”. Aí pode guardar o celular.'}
          </p>
        </>
      )}

      {guide && (
        <PermissionGuide
          kind={guide}
          loading={activating}
          onClose={() => setGuide(null)}
          onRetry={activateAlert}
        />
      )}

      <div className="absolute bottom-6 flex items-center gap-1.5 opacity-50">
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 py-10 relative text-center">
      {children}
    </div>
  )
}

function Steps() {
  return (
    <ol className="flex items-center gap-2 my-7 text-xs font-medium" aria-label="Andamento do pedido">
      <li className="flex items-center gap-1.5 text-brand-700">
        <span className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center">
          <Check size={12} className="text-white" />
        </span>
        Recebido
      </li>
      <li aria-hidden className="w-6 h-px bg-brand-200" />
      <li className="flex items-center gap-1.5 text-amber-700" aria-current="step">
        <span className="relative flex w-5 h-5 items-center justify-center">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-60 animate-ping" />
          <span className="relative w-3 h-3 rounded-full bg-amber-500" />
        </span>
        Em preparo
      </li>
      <li aria-hidden className="w-6 h-px bg-gray-200" />
      <li className="flex items-center gap-1.5 text-gray-400">
        <span className="w-5 h-5 rounded-full border-2 border-gray-200" />
        Pronto
      </li>
    </ol>
  )
}

function StatusCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="w-full max-w-xs bg-brand-50 border border-brand-100 rounded-2xl p-4 text-left" role="status">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-brand-800">{title}</p>
          <p className="text-xs text-brand-700 mt-0.5 leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  )
}

function PermissionGuide({
  kind,
  loading,
  onClose,
  onRetry,
}: {
  kind: GuideKind
  loading: boolean
  onClose: () => void
  onRetry: () => void
}) {
  const guide = getGuide(kind)

  return (
    <div className="fixed inset-0 z-50 bg-white px-6 py-8 flex flex-col text-left overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
          {kind === 'denied' ? (
            <Settings size={26} className="text-white" />
          ) : (
            <Smartphone size={26} className="text-white" />
          )}
        </div>

        <h2 id="guide-title" className="text-2xl font-bold text-gray-900">{guide.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{guide.description}</p>

        <ol className="mt-6 space-y-3">
          {guide.steps.map((step, index) => (
            <li key={step} className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-gray-700">{step}</p>
            </li>
          ))}
        </ol>

        {kind === 'denied' && (
          <button onClick={onRetry} disabled={loading} className="btn-primary mt-6 w-full py-4 text-base">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
            {loading ? 'Ativando...' : 'Já liberei, ativar aviso'}
          </button>
        )}

        <button
          onClick={onClose}
          disabled={loading}
          className={kind === 'denied' ? 'mt-3 w-full py-3 text-sm font-medium text-gray-600 disabled:opacity-60' : 'btn-primary mt-6 w-full py-4 text-base'}
        >
          {kind === 'denied' ? 'Continuar só com o aviso sonoro' : 'Entendi'}
        </button>
      </div>
    </div>
  )
}

function getGuide(kind: GuideKind): { title: string; description: string; steps: string[] } {
  if (kind === 'ios-install') {
    return {
      title: 'Aviso com a tela bloqueada no iPhone',
      description:
        'O iPhone só entrega notificações de sites instalados na Tela de Início. É opcional: com esta página aberta, o aviso sonoro já funciona.',
      steps: [
        'No Safari, toque no botão Compartilhar (o quadrado com a seta).',
        'Escolha “Adicionar à Tela de Início” e confirme.',
        'Abra o ícone “Pedido Pronto” criado — ele abre direto neste pedido.',
        'Toque em “Me avise quando ficar pronto” e depois em “Permitir”.',
      ],
    }
  }

  const host = window.location.host
  const android = /Android/i.test(navigator.userAgent)

  return {
    title: 'As notificações estão bloqueadas',
    description:
      'A permissão foi negada antes, e o celular não deixa perguntar de novo. Você pode liberar manualmente ou seguir só com o aviso sonoro nesta página.',
    steps: android
      ? [
          'Toque no cadeado (ou no ícone ao lado do endereço) no topo do navegador.',
          `Em Permissões, libere Notificações para ${host}.`,
          'Volte para esta tela e toque no botão abaixo.',
        ]
      : [
          'Abra os Ajustes do aparelho e entre em Notificações.',
          'Escolha “Pedido Pronto” (ou o navegador que você está usando).',
          'Ative “Permitir Notificações”.',
          'Volte para esta tela e toque no botão abaixo.',
        ],
  }
}
