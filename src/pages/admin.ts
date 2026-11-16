// Tudo o que só o estabelecimento usa, agrupado num único chunk.
//
// O cliente que escaneia o QR Code no 4G baixa apenas a tela do pedido; o
// painel inteiro (login, pedidos, estatísticas, planos, QR, date-fns) vem
// neste arquivo, carregado de uma vez na primeira tela do lojista. Um chunk
// só — e não um por página — para que um painel aberto durante um deploy não
// tente buscar um arquivo que deixou de existir.
export { default as LoginPage } from './LoginPage'
export { default as SignupPage } from './SignupPage'
export { default as DashboardPage } from './DashboardPage'
export { default as NewOrderPage } from './NewOrderPage'
export { default as OrdersPage } from './OrdersPage'
export { default as StatsPage } from './StatsPage'
export { default as SettingsPage } from './SettingsPage'
export { default as PricingPage } from './PricingPage'
export { default as AppLayout } from '@/components/layout/AppLayout'
