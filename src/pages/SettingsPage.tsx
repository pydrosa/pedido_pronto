import { useState } from 'react'
import { User, Bell, CreditCard, Shield, ChevronRight, ExternalLink } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { PLANS } from '@/types'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { establishment, refreshEstablishment } = useAuth()
  const [name, setName] = useState(establishment?.name ?? '')
  const [saving, setSaving] = useState(false)

  const plan = PLANS.find((p) => p.id === establishment?.plan) ?? PLANS[0]

  const saveName = async () => {
    if (!establishment || !name.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('establishments')
      .update({ name: name.trim() })
      .eq('id', establishment.id)
    setSaving(false)
    if (error) toast.error('Erro ao salvar')
    else {
      await refreshEstablishment()
      toast.success('Nome atualizado!')
    }
  }

  const openStripePortal = async () => {
    toast('Redirecionando para o portal de assinatura...', { icon: '🔗' })
    // In production: call your Edge Function to create a Stripe portal session
    // const { data } = await supabase.functions.invoke('stripe-portal')
    // window.location.href = data.url
  }

  const sections = [
    {
      title: 'Estabelecimento',
      icon: User,
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome do estabelecimento
            </label>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                onClick={saveName}
                disabled={saving || name === establishment?.name}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail</label>
            <input className="input bg-gray-50 text-gray-400 cursor-not-allowed" value={establishment?.email ?? ''} disabled />
            <p className="text-xs text-gray-400 mt-1">O e-mail não pode ser alterado por aqui.</p>
          </div>
        </div>
      ),
    },
    {
      title: 'Plano e assinatura',
      icon: CreditCard,
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-brand-50 rounded-xl">
            <div>
              <p className="font-semibold text-brand-800">Plano {plan.name}</p>
              <p className="text-sm text-brand-600">
                {plan.price === 0 ? 'Gratuito' : `R$ ${(plan.price / 100).toFixed(2)}/mês`}
              </p>
            </div>
            <span className="badge bg-brand-100 text-brand-700">Ativo</span>
          </div>

          <div className="space-y-2">
            {[
              `${plan.max_orders_per_month ?? 'Ilimitados'} pedidos/mês`,
              `${plan.max_users ?? 'Ilimitados'} usuário(s)`,
              plan.web_push ? 'Web Push ativado' : 'Web Push não incluso',
              plan.history_days ? `Histórico de ${plan.history_days} dias` : 'Histórico completo',
            ].map((feat) => (
              <p key={feat} className="text-sm text-gray-600 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
                {feat}
              </p>
            ))}
          </div>

          {establishment?.plan !== 'pro' && (
            <a href="/planos" className="btn-primary w-full text-sm">
              <ExternalLink size={15} />
              Ver planos e fazer upgrade
            </a>
          )}

          {establishment?.stripe_subscription_id && (
            <button onClick={openStripePortal} className="btn-secondary w-full text-sm">
              <ExternalLink size={15} />
              Gerenciar assinatura no Stripe
            </button>
          )}
        </div>
      ),
    },
    {
      title: 'Notificações',
      icon: Bell,
      content: (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            As notificações push são enviadas diretamente para o celular do cliente quando o pedido
            é marcado como pronto. Nenhuma configuração adicional é necessária.
          </p>
          {!plan.web_push && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-sm text-amber-700 font-medium">Web Push não disponível</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Faça upgrade para o plano Básico ou Pro para ativar notificações com a tela fechada.
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Segurança',
      icon: Shield,
      content: (
        <div className="space-y-3">
          <button
            onClick={async () => {
              const { error } = await supabase.auth.resetPasswordForEmail(establishment?.email ?? '')
              if (!error) toast.success('E-mail de redefinição enviado!')
              else toast.error('Erro ao enviar e-mail')
            }}
            className="btn-secondary w-full text-sm"
          >
            Alterar senha por e-mail
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-gray-400 text-sm mt-0.5">Gerencie seu estabelecimento</p>
      </div>

      {sections.map(({ title, icon: Icon, content }) => (
        <div key={title} className="card p-5">
          <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-gray-100">
            <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center">
              <Icon size={16} className="text-gray-500" />
            </div>
            <h2 className="font-semibold text-gray-800">{title}</h2>
          </div>
          {content}
        </div>
      ))}
    </div>
  )
}
