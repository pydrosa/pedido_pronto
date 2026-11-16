import { useState } from 'react'
import { Check, X, Bell, Loader2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { PLANS, Plan } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const FEATURES = [
  { key: 'orders', label: 'Pedidos/mês' },
  { key: 'users', label: 'Usuários' },
  { key: 'push', label: 'Web Push (tela fechada)' },
  { key: 'history', label: 'Histórico' },
  { key: 'metrics', label: 'Métricas avançadas' },
  { key: 'support', label: 'Suporte' },
]

const PLAN_FEATURES: Record<string, Record<string, string | boolean>> = {
  free:  { orders: '20/mês', users: '1',          push: false,  history: '7 dias',      metrics: false, support: 'E-mail' },
  basic: { orders: 'Ilimitado', users: 'Até 3',   push: true,   history: '30 dias',     metrics: false, support: 'E-mail' },
  pro:   { orders: 'Ilimitado', users: 'Ilimitado', push: true, history: 'Completo',    metrics: true,  support: 'Prioritário' },
}

export default function PricingPage() {
  const { establishment } = useAuth()
  const navigate = useNavigate()
  const [checkoutLoading, setCheckoutLoading] = useState<Plan | null>(null)

  const handleSubscribe = async (planId: Plan) => {
    if (!establishment) {
      navigate('/cadastro')
      return
    }

    setCheckoutLoading(planId)
    const { data, error } = await supabase.functions.invoke('stripe-checkout', {
      body: { plan: planId },
    })
    setCheckoutLoading(null)

    if (error || !data?.url) {
      toast.error('Erro ao iniciar assinatura. Tente novamente.')
      return
    }

    window.location.href = data.url
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center">
              <Bell size={24} className="text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Planos simples e transparentes</h1>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            Comece grátis. Faça upgrade quando precisar. Cancele quando quiser.
          </p>
        </div>

        {/* Plans grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {PLANS.map((plan) => {
            const isCurrent = establishment?.plan === plan.id
            const isPopular = plan.id === 'basic'

            return (
              <div
                key={plan.id}
                className={`card p-6 flex flex-col relative ${
                  isPopular ? 'border-2 border-brand-400 shadow-lg shadow-brand-100' : ''
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-brand-600 text-white text-xs font-semibold px-4 py-1 rounded-full">
                      Mais popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h2 className="text-lg font-bold text-gray-900">{plan.name}</h2>
                  <div className="mt-2">
                    <span className="text-4xl font-bold text-gray-900">
                      {plan.price === 0 ? 'Grátis' : `R$ ${(plan.price / 100).toFixed(0)}`}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-gray-400 text-sm ml-1">/mês</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-3 mb-6">
                  {FEATURES.map(({ key, label }) => {
                    const val = PLAN_FEATURES[plan.id][key]
                    return (
                      <div key={key} className="flex items-center gap-3">
                        {typeof val === 'boolean' ? (
                          val
                            ? <Check size={16} className="text-brand-600 flex-shrink-0" />
                            : <X size={16} className="text-gray-300 flex-shrink-0" />
                        ) : (
                          <Check size={16} className="text-brand-600 flex-shrink-0" />
                        )}
                        <span className={`text-sm ${typeof val === 'boolean' && !val ? 'text-gray-300' : 'text-gray-600'}`}>
                          {typeof val === 'boolean' ? label : `${label}: ${val}`}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {isCurrent ? (
                  <div className="btn-secondary w-full cursor-default justify-center text-sm">
                    Plano atual
                  </div>
                ) : (
                  plan.price === 0 ? (
                    <Link
                      to="/cadastro"
                      className="w-full py-3 rounded-xl text-sm font-medium text-center transition-colors bg-gray-900 hover:bg-gray-700 text-white"
                    >
                      Começar grátis
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(plan.id)}
                      disabled={checkoutLoading !== null}
                      className={`w-full py-3 rounded-xl text-sm font-medium text-center transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${
                        isPopular
                          ? 'bg-brand-600 hover:bg-brand-800 text-white'
                          : 'bg-gray-900 hover:bg-gray-700 text-white'
                      }`}
                    >
                      {checkoutLoading === plan.id && <Loader2 size={15} className="animate-spin" />}
                      {checkoutLoading === plan.id ? 'Redirecionando...' : `Assinar ${plan.name}`}
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>

        {/* FAQ */}
        <div className="card p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-5">Perguntas frequentes</h2>
          <div className="space-y-5">
            {[
              { q: 'O cliente precisa instalar algum app?', a: 'Não. O cliente apenas escaneia o QR Code com a câmera do celular. Uma página abre automaticamente no navegador.' },
              { q: 'Como funciona o Web Push?', a: 'O cliente ativa a notificação com um toque na tela de espera. Assim, pode fechar o navegador e ainda receber a notificação quando o pedido ficar pronto.' },
              { q: 'Posso cancelar a qualquer momento?', a: 'Sim. Não há fidelidade. Você pode cancelar a assinatura pelo painel de configurações a qualquer momento.' },
              { q: 'Quais formas de pagamento são aceitas?', a: 'Cartão de crédito, Pix e boleto bancário, processados com segurança pelo Stripe.' },
            ].map(({ q, a }) => (
              <div key={q} className="pb-5 border-b border-gray-100 last:border-0 last:pb-0">
                <p className="font-medium text-gray-800 mb-1.5">{q}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center mt-8">
          {establishment ? (
            <Link to="/" className="text-brand-600 font-medium hover:underline text-sm">
              ← Voltar ao painel
            </Link>
          ) : (
            <Link to="/login" className="text-brand-600 font-medium hover:underline text-sm">
              ← Entrar na conta
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
