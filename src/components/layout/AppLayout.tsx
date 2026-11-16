import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, PlusCircle, ListOrdered,
  BarChart2, Settings, LogOut, Bell, Menu, X,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Painel', short: 'Painel', end: true },
  { to: '/novo-pedido', icon: PlusCircle, label: 'Novo pedido', short: 'Novo' },
  { to: '/pedidos', icon: ListOrdered, label: 'Pedidos', short: 'Pedidos' },
  { to: '/estatisticas', icon: BarChart2, label: 'Estatísticas', short: 'Números' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações', short: 'Ajustes' },
]

const PLAN_LABEL: Record<string, string> = { free: 'Grátis', basic: 'Básico', pro: 'Pro' }

export default function AppLayout() {
  const { establishment, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    toast.success('Até logo!')
    navigate('/login')
  }

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside className={`
      flex flex-col h-full bg-white border-r border-gray-100
      ${mobile ? 'w-full' : 'w-64'}
    `}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-6 py-5 border-b border-gray-100">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
          <Bell size={16} className="text-white" />
        </div>
        <span className="font-semibold text-gray-900">Pedido Pronto</span>
      </div>

      {/* Establishment info */}
      <div className="px-4 py-3 mx-2 mt-3 bg-brand-50 rounded-xl">
        <p className="text-xs text-brand-600 font-medium uppercase tracking-wide">Estabelecimento</p>
        <p className="text-sm font-semibold text-brand-800 mt-0.5 truncate">
          {establishment?.name ?? '—'}
        </p>
        <span className="inline-block mt-1 text-xs font-medium bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full">
          Plano {PLAN_LABEL[establishment?.plan ?? 'free'] ?? 'Grátis'}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Sign out */}
      <div className="p-4 border-t border-gray-100">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-medium
                     text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
          Sair
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="w-64 flex flex-col">
          <Sidebar />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 z-50">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-end p-4 bg-white border-b border-gray-100">
                <button onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" className="p-2 -m-2">
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <Sidebar mobile />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
          <button onClick={() => setSidebarOpen(true)} aria-label="Abrir menu" className="p-2 -m-2">
            <Menu size={22} className="text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-brand-600 rounded flex items-center justify-center">
              <Bell size={12} className="text-white" />
            </div>
            <span className="font-semibold text-sm">Pedido Pronto</span>
          </div>
          <div className="w-6" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">
          <div className="max-w-4xl mx-auto">
            <Outlet />
          </div>
        </main>

        {/* Barra inferior no celular: tudo a um toque do polegar, sem abrir menu. */}
        <nav
          aria-label="Navegação principal"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-100 flex justify-around px-1 pt-1.5"
          style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
        >
          {NAV.map(({ to, icon: Icon, short, end }) => {
            const isNew = to === '/novo-pedido'
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] px-2 py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                    isNew
                      ? 'text-brand-600'
                      : isActive
                        ? 'text-brand-700'
                        : 'text-gray-500'
                  }`
                }
              >
                {isNew ? (
                  <span className="w-10 h-10 -mt-5 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-200">
                    <Icon size={22} />
                  </span>
                ) : (
                  <Icon size={20} />
                )}
                {short}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
