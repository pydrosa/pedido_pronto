# 🔔 Pedido Pronto

Plataforma SaaS de notificação de pedidos em tempo real. O cliente escaneia um QR Code e recebe uma notificação push (com vibração) quando o pedido fica pronto — sem instalar nenhum app.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Roteamento | React Router v6 |
| Backend / DB | Supabase (PostgreSQL + Auth + Realtime) |
| Web Push | Web Push API + VAPID + Service Worker |
| QR Code | qrcode.js (client-side) |
| Pagamentos | Stripe Billing |
| Deploy | Vercel |
| Edge Functions | Supabase Functions (Deno) |

---

## Estrutura do projeto

```
pedido-pronto/
├── public/
│   ├── sw.js                     # Service Worker (Web Push)
│   └── manifest.json             # PWA manifest
├── src/
│   ├── components/
│   │   ├── establishment/
│   │   │   └── OrderCard.tsx     # Card de pedido reutilizável
│   │   └── layout/
│   │       └── AppLayout.tsx     # Layout com sidebar
│   ├── hooks/
│   │   ├── useAuth.tsx           # Contexto de autenticação
│   │   └── useOrders.ts          # Pedidos + realtime subscription
│   ├── lib/
│   │   ├── supabase.ts           # Cliente Supabase
│   │   ├── push.ts               # Web Push utilities
│   │   └── qrcode.ts             # Geração de QR Code
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── NewOrderPage.tsx      # Cria pedido + gera QR
│   │   ├── OrdersPage.tsx        # Lista com filtros
│   │   ├── StatsPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── ClientOrderPage.tsx   # Tela do cliente (via QR)
│   │   └── PricingPage.tsx
│   ├── types/index.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
└── supabase/
    ├── migrations/
    │   └── 001_initial.sql       # Schema completo do banco
    └── functions/
        ├── send-push/            # Envia Web Push ao cliente
        ├── stripe-webhook/       # Processa eventos do Stripe
        └── stripe-portal/        # Cria sessão do portal Stripe
```

---

## Setup — passo a passo

### 1. Clonar e instalar dependências

```bash
git clone <repo>
cd pedido-pronto
npm install
```

### 2. Criar projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto
2. Vá em **SQL Editor** e execute o conteúdo de `supabase/migrations/001_initial.sql`
3. Em **Settings → API**, copie a `Project URL` e a `anon public key`

### 3. Gerar chaves VAPID (Web Push)

```bash
npx web-push generate-vapid-keys
```

Guarde a chave **pública** (vai para o `.env`) e a **privada** (vai para os secrets do Supabase).

### 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env`:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxxxxxxxxxxxxxx
VITE_VAPID_PUBLIC_KEY=BNxxxxxxxxxxxxxxxxxxxxxxxx
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxx
VITE_APP_URL=http://localhost:3000
```

### 5. Configurar Stripe

1. Crie uma conta em [stripe.com](https://stripe.com)
2. Crie os produtos e preços:
   - **Básico**: R$ 49,00/mês → copie o `price_id`
   - **Pro**: R$ 129,00/mês → copie o `price_id`
3. Adicione ao `.env`:
   ```env
   VITE_STRIPE_PRICE_BASIC=price_xxxxxxxxxx
   VITE_STRIPE_PRICE_PRO=price_xxxxxxxxxx
   ```

### 6. Deploy das Edge Functions

```bash
# Instale o Supabase CLI
npm install -g supabase

# Login
supabase login

# Link ao projeto
supabase link --project-ref SEU_PROJECT_REF

# Configure os secrets
supabase secrets set VAPID_SUBJECT=mailto:seu@email.com
supabase secrets set VAPID_PUBLIC_KEY=sua_chave_publica
supabase secrets set VAPID_PRIVATE_KEY=sua_chave_privada
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
supabase secrets set STRIPE_PRICE_BASIC=price_xxxxx
supabase secrets set STRIPE_PRICE_PRO=price_xxxxx
supabase secrets set APP_URL=https://pedidopronto.app

# Deploy das funções
supabase functions deploy send-push
supabase functions deploy stripe-webhook
supabase functions deploy stripe-portal
```

### 7. Configurar webhook no Stripe

No Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- URL: `https://SEU_PROJETO.supabase.co/functions/v1/stripe-webhook`
- Eventos:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

### 8. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000`

---

## Deploy na Vercel

```bash
# Instale a Vercel CLI
npm install -g vercel

# Deploy
vercel

# Configure as variáveis de ambiente no dashboard da Vercel
# (as mesmas do .env, sem o prefixo VITE_... para as privadas)
```

---

## Fluxo da notificação

```
1. Estabelecimento cria pedido → UUID gerado no Supabase
2. QR Code aponta para: https://pedidopronto.app/pedido/{uuid}
3. Cliente abre a página → vê tela de espera
4. Cliente toca "Ativar notificação" → push subscription salva no banco
5. Estabelecimento toca "Pronto" → status updated no Supabase
6. Supabase Realtime dispara update para a página aberta do cliente
7. Edge Function send-push envia Web Push notification
8. Cliente recebe: vibração + notificação no sistema
```

---

## Planos SaaS

| Plano | Preço | Pedidos/mês | Web Push |
|---|---|---|---|
| Grátis | R$ 0 | 20 | ❌ |
| Básico | R$ 49 | Ilimitado | ✅ |
| Pro | R$ 129 | Ilimitado | ✅ + Métricas |

---

## Licença

MIT
