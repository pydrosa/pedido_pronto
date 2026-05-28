import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Order, OrderStatus, CreateOrderInput, PLANS } from '@/types'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'

export function useOrders() {
  const { establishment } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const fetchOrders = useCallback(async () => {
    if (!establishment) return
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('establishment_id', establishment.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) toast.error('Erro ao carregar pedidos')
    else setOrders((data as Order[]) ?? [])
    setLoading(false)
  }, [establishment])

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
          setOrders((prev) => [payload.new as Order, ...prev])
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
    const plan = PLANS.find((p) => p.id === establishment.plan)!
    if (plan.max_orders_per_month !== null && establishment.orders_this_month >= plan.max_orders_per_month) {
      return {
        allowed: false,
        reason: `Limite de ${plan.max_orders_per_month} pedidos/mês do plano ${plan.name} atingido. Faça upgrade para continuar.`,
      }
    }
    return { allowed: true }
  }, [establishment])

  const createOrder = async (input: CreateOrderInput): Promise<Order | null> => {
    if (!establishment) {
      toast.error('Estabelecimento nao encontrado. Saia e entre novamente na conta.')
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
      toast.error(error.message || 'Erro ao criar pedido')
      return null
    }

    return data as Order
  }

  const markReady = async (orderId: string): Promise<boolean> => {
    const { data: updatedOrder, error } = await supabase
      .from('orders')
      .update({ status: 'ready' as OrderStatus, ready_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      toast.error('Erro ao atualizar pedido')
      return false
    }

    // Trigger push notification via Edge Function
    const order = updatedOrder as Order
    if (order?.push_subscription) {
      const { data: pushResult, error: pushError } = await supabase.functions.invoke('send-push', {
        body: {
          orderId,
          subscription: order.push_subscription,
          customerName: order.customer_name,
          orderNumber: order.order_number,
        },
      })

      if (pushError) {
        console.error('[Push] Erro ao enviar notificacao:', pushError)
        toast.error(`Pedido pronto, mas a notificacao push falhou: ${pushError.message}`)
        return true
      }

      if (pushResult && pushResult.ok === false) {
        console.error('[Push] Falha retornada pela funcao:', pushResult)
        toast.error(`Pedido pronto, mas a notificacao push falhou: ${pushResult.error || 'erro desconhecido'}`)
        return true
      }
    } else {
      console.warn('[Push] Pedido sem push_subscription:', orderId)
      toast('Pedido pronto. O cliente nao ativou notificacao push.')
    }

    toast.success('Cliente notificado!')
    return true
  }

  const markCollected = async (orderId: string): Promise<void> => {
    await supabase
      .from('orders')
      .update({ status: 'collected' as OrderStatus, collected_at: new Date().toISOString() })
      .eq('id', orderId)
  }

  const deleteOrder = async (orderId: string): Promise<void> => {
    await supabase.from('orders').delete().eq('id', orderId)
  }

  const activeOrders = orders.filter((o) => o.status === 'waiting')
  const readyOrders = orders.filter((o) => o.status === 'ready')
  const todayOrders = orders.filter((o) => {
    const d = new Date(o.created_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

  return {
    orders,
    activeOrders,
    readyOrders,
    todayOrders,
    loading,
    fetchOrders,
    createOrder,
    markReady,
    markCollected,
    deleteOrder,
    canCreateOrder,
  }
}
