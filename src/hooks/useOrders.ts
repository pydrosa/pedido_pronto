import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Order, OrderStatus, CreateOrderInput } from '@/types'
import { useAuth } from './useAuth'
import { isToday } from '@/lib/date'
import { canCreateOrder as checkCanCreateOrder } from '@/lib/plan'
import toast from 'react-hot-toast'

const PAGE_SIZE = 50

export function useOrders() {
  const { establishment, refreshEstablishment } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (!establishment) return
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('establishment_id', establishment.id)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1)

    if (error) toast.error('Erro ao carregar pedidos')
    else {
      const page = (data as Order[]) ?? []
      setOrders(page)
      setHasMore(page.length === PAGE_SIZE)
    }
    setLoading(false)
  }, [establishment])

  const loadMore = useCallback(async () => {
    if (!establishment || loadingMore || !hasMore) return
    setLoadingMore(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('establishment_id', establishment.id)
      .order('created_at', { ascending: false })
      .range(orders.length, orders.length + PAGE_SIZE - 1)

    if (error) {
      toast.error('Erro ao carregar mais pedidos')
    } else {
      const page = (data as Order[]) ?? []
      setOrders((prev) => [...prev, ...page])
      setHasMore(page.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }, [establishment, orders.length, hasMore, loadingMore])

  // Subscribe to realtime changes
  useEffect(() => {
    if (!establishment) return
    fetchOrders()

    const channel = supabase
      .channel(`orders:${establishment.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `establishment_id=eq.${establishment.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const created = payload.new as Order
          setOrders((prev) => (prev.some((o) => o.id === created.id) ? prev : [created, ...prev]))
        } else if (payload.eventType === 'UPDATE') {
          setOrders((prev) =>
            prev.map((o) => (o.id === (payload.new as Order).id ? (payload.new as Order) : o))
          )
        } else if (payload.eventType === 'DELETE') {
          setOrders((prev) => prev.filter((o) => o.id !== (payload.old as Order).id))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [establishment, fetchOrders])

  const canCreateOrder = useCallback((): { allowed: boolean; reason?: string } => {
    if (!establishment) return { allowed: false, reason: 'Estabelecimento não encontrado' }
    return checkCanCreateOrder(establishment)
  }, [establishment])

  const createOrder = async (input: CreateOrderInput): Promise<Order | null> => {
    if (!establishment) {
      toast.error('Estabelecimento não encontrado. Saia e entre novamente na conta.')
      return null
    }

    const check = canCreateOrder()
    if (!check.allowed) {
      toast.error(check.reason!)
      return null
    }

    const { data, error } = await supabase
      .rpc('create_order_for_current_establishment', {
        p_customer_name: input.customer_name.trim(),
      })

    if (error) {
      console.error('[Orders] Erro ao criar pedido:', error)
      // A única mensagem de banco que faz sentido para o operador é a do limite.
      toast.error(
        /limite/i.test(error.message)
          ? 'Limite de pedidos do plano atingido neste mês. Faça upgrade para continuar.'
          : 'Não foi possível criar o pedido. Tente de novo.'
      )
      return null
    }

    // Atualiza o contador "pedidos este mês" do plano.
    void refreshEstablishment()
    return data as Order
  }

  // Envia (ou reenvia) o push do pedido. Não mostra toast — quem chama decide.
  const sendPush = async (orderId: string): Promise<{ ok: boolean; error?: string }> => {
    const { data: pushResult, error: pushError } = await supabase.functions.invoke('send-push', {
      body: { orderId },
    })

    if (pushError) {
      console.error('[Push] Erro ao enviar notificação:', pushError)
      return { ok: false, error: pushError.message }
    }
    if (pushResult && pushResult.ok === false) {
      console.error('[Push] Falha retornada pela função:', pushResult)
      return { ok: false, error: pushResult.error || 'erro desconhecido' }
    }
    return { ok: true }
  }

  const markReady = async (orderId: string): Promise<boolean> => {
    const { data: updatedOrder, error } = await supabase
      .from('orders')
      .update({ status: 'ready' as OrderStatus, ready_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      toast.error('Não foi possível marcar como pronto. Tente de novo.')
      return false
    }

    // A tela do cliente (se estiver aberta) já foi avisada pelo banco em tempo
    // real. O push cobre quem guardou o celular. Um único toast diz o que
    // de fato aconteceu.
    const order = updatedOrder as Order
    if (!order?.push_subscription) {
      toast(`Pedido #${order.order_number} pronto. O cliente não ativou o aviso — chame pelo número.`, {
        icon: '📣',
        duration: 5000,
      })
      return true
    }

    const push = await sendPush(orderId)
    if (push.ok) toast.success(`Pedido #${order.order_number} pronto — cliente avisado!`)
    else {
      toast.error(`Pedido #${order.order_number} pronto, mas o aviso falhou. Chame pelo número.`, {
        duration: 6000,
      })
    }
    return true
  }

  // "Chamar de novo": reenvia o push de um pedido que já está pronto.
  const notifyAgain = async (orderId: string): Promise<boolean> => {
    const order = orders.find((o) => o.id === orderId)
    if (!order?.push_subscription) {
      toast('Este cliente não ativou o aviso no celular. Chame pelo número.', { icon: '📣' })
      return false
    }
    const push = await sendPush(orderId)
    if (push.ok) toast.success(`Cliente do pedido #${order.order_number} avisado de novo.`)
    else toast.error('O aviso falhou. Chame pelo número.')
    return push.ok
  }

  const markCollected = async (orderId: string): Promise<void> => {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'collected' as OrderStatus, collected_at: new Date().toISOString() })
      .eq('id', orderId)
    if (error) toast.error('Não foi possível marcar como retirado. Tente de novo.')
  }

  const deleteOrder = async (orderId: string): Promise<void> => {
    const { error } = await supabase.from('orders').delete().eq('id', orderId)
    if (error) toast.error('Não foi possível remover o pedido.')
  }

  // Fila de preparo: o pedido mais antigo primeiro (é o próximo a sair).
  const byOldest = (a: Order, b: Order) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()

  const activeOrders = orders.filter((o) => o.status === 'waiting').sort(byOldest)
  const readyOrders = orders.filter((o) => o.status === 'ready').sort(byOldest)
  const todayOrders = orders.filter((o) => isToday(o.created_at))

  return {
    orders,
    activeOrders,
    readyOrders,
    todayOrders,
    loading,
    loadingMore,
    hasMore,
    fetchOrders,
    loadMore,
    createOrder,
    markReady,
    notifyAgain,
    markCollected,
    deleteOrder,
    canCreateOrder,
  }
}
