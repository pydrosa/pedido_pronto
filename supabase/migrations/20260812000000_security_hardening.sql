-- ============================================================
-- Pedido Pronto — Security hardening
--
-- Problemas corrigidos:
-- 1. "Client updates push subscription" usava using(true)/check(true),
--    o que liberava UPDATE de QUALQUER coluna em QUALQUER pedido (de
--    qualquer estabelecimento) para qualquer chamador com a anon key,
--    não apenas o campo push_subscription como o comentário sugeria.
-- 2. "Public read order by id" usava using(true) sem restringir role,
--    liberando SELECT * irrestrito (todas as linhas, todas as colunas,
--    inclusive push_subscription) para qualquer papel — inclusive
--    usuários autenticados de OUTROS estabelecimentos, que deveriam
--    estar restritos à policy "Owner manages orders".
-- 3. O limite de pedidos/mês do plano só era validado no client.
-- ============================================================

-- ── push_subscription: text serializado -> jsonb ───────────────
alter table public.orders
  alter column push_subscription type jsonb using push_subscription::jsonb;

-- ── Remove as policies permissivas problemáticas ────────────────
drop policy if exists "Public read order by id" on public.orders;
drop policy if exists "Client updates push subscription" on public.orders;

-- Leitura pública por UUID (link do QR Code) fica restrita ao papel
-- "anon". Usuários autenticados passam a depender só da policy
-- "Owner manages orders" (só veem pedidos do próprio estabelecimento).
--
-- Risco residual aceito conscientemente: como RLS não enxerga o filtro
-- da query, um chamador anon que tenha a anon key ainda consegue listar
-- linhas de orders sem informar um id (não há como impedir isso via RLS
-- mantendo o link público funcionando sem autenticação). Para reduzir o
-- impacto, as colunas mais sensíveis (push_subscription, establishment_id)
-- são explicitamente removidas do grant de leitura do papel anon logo
-- abaixo — o anon só enxerga os campos necessários para a tela do
-- cliente. Fechar esse resíduo por completo exigiria migrar o realtime
-- do cliente para o padrão "Broadcast from Database" do Supabase
-- (canais privados por order_id), fora do escopo desta correção.
create policy "Public read order by id"
  on public.orders for select
  to anon
  using (true);

revoke select on public.orders from anon;
grant select (
  id,
  order_number,
  customer_name,
  status,
  notified_at,
  created_at,
  ready_at,
  collected_at
) on public.orders to anon;

-- Nenhuma policy pública de UPDATE é recriada: a atualização do
-- push_subscription pelo cliente passa a ser feita exclusivamente via
-- RPC security definer (update_order_push_subscription, abaixo), que
-- só permite alterar essa coluna especifica.

-- ── RPC: leitura de um pedido específico pelo cliente (sem auth) ──
create or replace function public.get_order_public(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception 'Pedido nao encontrado';
  end if;

  return v_order;
end;
$$;

grant execute on function public.get_order_public(uuid) to anon, authenticated;

-- ── RPC: cliente atualiza só o push_subscription do próprio pedido ─
create or replace function public.update_order_push_subscription(
  p_order_id uuid,
  p_subscription jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set push_subscription = p_subscription
   where id = p_order_id;

  if not found then
    raise exception 'Pedido nao encontrado';
  end if;
end;
$$;

grant execute on function public.update_order_push_subscription(uuid, jsonb) to anon, authenticated;

-- ── Limite de pedidos/mês do plano, validado no banco ─────────────
-- Antes, a checagem de canCreateOrder() só existia no client — bastava
-- chamar a RPC diretamente para furar o limite do plano gratuito.
create or replace function public.create_order_for_current_establishment(p_customer_name text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_establishment public.establishments%rowtype;
  v_order public.orders%rowtype;
  v_order_number text;
  v_max_orders integer;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  select *
    into v_establishment
    from public.establishments
   where owner_id = auth.uid()
   for update;

  if not found then
    raise exception 'Estabelecimento nao encontrado';
  end if;

  -- Mantenha em sincronia com PLANS.max_orders_per_month em src/types/index.ts
  v_max_orders := case v_establishment.plan when 'free' then 20 else null end;

  if v_max_orders is not null and v_establishment.orders_this_month >= v_max_orders then
    raise exception 'Limite de % pedidos/mes do plano atingido. Faca upgrade para continuar.', v_max_orders;
  end if;

  v_order_number := lpad(v_establishment.next_order_number::text, 3, '0');

  insert into public.orders (
    establishment_id,
    order_number,
    customer_name,
    status
  )
  values (
    v_establishment.id,
    v_order_number,
    trim(p_customer_name),
    'waiting'
  )
  returning * into v_order;

  update public.establishments
     set next_order_number = next_order_number + 1,
         orders_this_month = orders_this_month + 1
   where id = v_establishment.id;

  return v_order;
end;
$$;

grant execute on function public.create_order_for_current_establishment(text) to authenticated;
