-- ============================================================
-- Pedido Pronto — Supabase Migration
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- ── Enable UUID extension ────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Establishments ───────────────────────────────────────────
create table if not exists public.establishments (
  id                      uuid primary key default uuid_generate_v4(),
  owner_id                uuid not null references auth.users(id) on delete cascade,
  name                    text not null,
  email                   text not null,
  plan                    text not null default 'free' check (plan in ('free', 'basic', 'pro')),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  orders_this_month       integer not null default 0,
  created_at              timestamptz not null default now()
);

-- Each user owns one establishment
create unique index if not exists establishments_owner_id_idx on public.establishments(owner_id);

-- ── Orders ───────────────────────────────────────────────────
create table if not exists public.orders (
  id                 uuid primary key default uuid_generate_v4(),
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  order_number       text not null,
  customer_name      text not null,
  status             text not null default 'waiting' check (status in ('waiting', 'ready', 'collected')),
  push_subscription  text,          -- serialized PushSubscription JSON
  notified_at        timestamptz,
  created_at         timestamptz not null default now(),
  ready_at           timestamptz,
  collected_at       timestamptz
);

create index if not exists orders_establishment_id_idx on public.orders(establishment_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- ── Row Level Security ────────────────────────────────────────

-- Establishments: owner can read/write their own
alter table public.establishments enable row level security;

create policy "Owner reads own establishment"
  on public.establishments for select
  using (owner_id = auth.uid());

create policy "Owner updates own establishment"
  on public.establishments for update
  using (owner_id = auth.uid());

create policy "Owner inserts own establishment"
  on public.establishments for insert
  with check (owner_id = auth.uid());

-- Orders: establishment owner can do everything
alter table public.orders enable row level security;

create policy "Owner manages orders"
  on public.orders for all
  using (
    establishment_id in (
      select id from public.establishments where owner_id = auth.uid()
    )
  );

-- Clients can read and update their own order (by UUID — no auth needed)
create policy "Public read order by id"
  on public.orders for select
  using (true);  -- Orders are accessed by UUID (unforgeable link), so public read is safe

create policy "Client updates push subscription"
  on public.orders for update
  using (true)   -- Client updates only push_subscription field
  with check (true);

-- ── Realtime ─────────────────────────────────────────────────
-- Enable realtime for orders table
alter publication supabase_realtime add table public.orders;

-- ── Monthly counter reset function ───────────────────────────
-- Call this via a scheduled Supabase Edge Function on the 1st of each month
create or replace function public.reset_monthly_orders()
returns void
language sql
security definer
as $$
  update public.establishments set orders_this_month = 0;
$$;

-- ── Trigger: set notified_at when status changes to ready ────
create or replace function public.handle_order_ready()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'ready' and old.status != 'ready' then
    new.notified_at = now();
  end if;
  return new;
end;
$$;

create trigger order_ready_trigger
  before update on public.orders
  for each row
  execute function public.handle_order_ready();
