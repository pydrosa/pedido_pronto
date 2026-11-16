import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

// A tela do cliente entra no bundle inicial: é a que precisa abrir rápido.
import ClientOrderPage from '@/pages/ClientOrderPage'

// O painel do estabelecimento é carregado sob demanda (ver src/pages/admin.ts).
const admin = () => import('@/pages/admin')
const LoginPage = lazy(() => admin().then((m) => ({ default: m.LoginPage })))
const SignupPage = lazy(() => admin().then((m) => ({ default: m.SignupPage })))
const DashboardPage = lazy(() => admin().then((m) => ({ default: m.DashboardPage })))
const NewOrderPage = lazy(() => admin().then((m) => ({ default: m.NewOrderPage })))
const OrdersPage = lazy(() => admin().then((m) => ({ default: m.OrdersPage })))
const StatsPage = lazy(() => admin().then((m) => ({ default: m.StatsPage })))
const SettingsPage = lazy(() => admin().then((m) => ({ default: m.SettingsPage })))
const PricingPage = lazy(() => admin().then((m) => ({ default: m.PricingPage })))
const AppLayout = lazy(() => admin().then((m) => ({ default: m.AppLayout })))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
        <span className="text-sm text-gray-400">Carregando...</span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/cadastro" element={<SignupPage />} />
      <Route path="/pedido/:orderId" element={<ClientOrderPage />} />
      <Route path="/planos" element={<PricingPage />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="novo-pedido" element={<NewOrderPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="estatisticas" element={<StatsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
