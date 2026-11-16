-- ============================================================
-- Pedido Pronto — Correções de segurança (revisão de 16/11/2026)
--
-- O que esta migration fecha:
--  1. Qualquer dono de conta conseguia se dar o plano Pro de graça
--     (UPDATE direto em establishments.plan / orders_this_month).
--  2. Qualquer pessoa com a anon key (pública) listava TODOS os pedidos
--     de TODOS os estabelecimentos (nome do cliente, número, status).
--  3. get_order_public devolvia a linha inteira, inclusive
--     push_subscription e establishment_id.
--  4. update_order_push_subscription aceitava qualquer JSON, para
--     qualquer pedido, em qualquer status (sequestro de aviso + SSRF
--     via função send-push).
--  5. reset_monthly_orders() era executável por qualquer chamador.
--  6. O dono podia inserir pedidos direto na tabela, furando o limite
--     do plano que só existia dentro da RPC.
--
-- ORDEM DE DEPLOY: publique o front-end novo ANTES de aplicar esta
-- migration. O front novo funciona com o banco antigo e com o novo; o
-- front antigo perde o tempo real da tela do cliente depois dela.
--
-- A migration é idempotente (pode ser reexecutada).
-- ============================================================


-- ── 1. establishments: só o nome é editável pelo dono ─────────────
-- plan, orders_this_month, next_order_number e os campos do Stripe
-- passam a ser alteráveis apenas pelo service role (webhook do Stripe)
-- e pelas funções security definer.
revoke all on public.establishments from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.establishments from authenticated;

grant select on public.establishments to authenticated;
grant insert (owner_id, name, email) on public.establishments to authenticated;
grant update (name) on public.establishments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'establishments_name_len'
  ) then
    alter table public.establishments
      add constraint establishments_name_len
      check (char_length(name) between 1 and 80) not valid;
  end if;
end;
$$;

-- Cria o estabelecimento no servidor quando o usuário se cadastra, em
-- vez de depender de um INSERT feito pelo navegador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'establishment_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Meu estabelecimento'
    ),
    80
  );

  begin
    insert into public.establishments (owner_id, name, email)
    values (new.id, v_name, coalesce(new.email, ''))
    on conflict (owner_id) do nothing;
  exception when others then
    -- Nunca bloqueia o cadastro: o front-end ainda tenta criar o
    -- estabelecimento como fallback no primeiro login.
    raise warning '[handle_new_user] %', sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ── 2. orders: fim da leitura pública e do INSERT direto ───────────
drop policy if exists "Public read order by id" on public.orders;
revoke all on public.orders from anon;

drop policy if exists "Owner manages orders" on public.orders;
drop policy if exists "Owner reads orders" on public.orders;
drop policy if exists "Owner updates orders" on public.orders;
drop policy if exists "Owner deletes orders" on public.orders;

create policy "Owner reads orders"
  on public.orders for select
  to authenticated
  using (
    establishment_id in (
      select id from public.establishments where owner_id = auth.uid()
    )
  );

create policy "Owner updates orders"
  on public.orders for update
  to authenticated
  using (
    establishment_id in (
      select id from public.establishments where owner_id = auth.uid()
    )
  )
  with check (
    establishment_id in (
      select id from public.establishments where owner_id = auth.uid()
    )
  );

create policy "Owner deletes orders"
  on public.orders for delete
  to authenticated
  using (
    establishment_id in (
      select id from public.establishments where owner_id = auth.uid()
    )
  );

-- Criação de pedido só pela RPC (que valida o limite do plano); o dono
-- só altera o status e os carimbos de tempo.
revoke insert, update, truncate, references, trigger
  on public.orders from authenticated;
grant select, delete on public.orders to authenticated;
grant update (status, ready_at, collected_at) on public.orders to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_customer_name_len'
  ) then
    alter table public.orders
      add constraint orders_customer_name_len
      check (char_length(customer_name) <= 80) not valid;
  end if;
end;
$$;

create index if not exists orders_establishment_status_created_idx
  on public.orders (establishment_id, status, created_at);


-- ── 3. Gatilho de status: carimbos no servidor + higiene de dados ──
create or replace function public.handle_order_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    new.ready_at := now();        -- relógio do servidor, não do tablet
    new.notified_at := now();
  end if;

  if new.status = 'collected' and old.status is distinct from 'collected' then
    new.collected_at := now();
    -- Pedido encerrado: o endereço de push do celular do cliente não
    -- tem mais finalidade (minimização de dados — LGPD).
    new.push_subscription := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_order_ready() from public, anon, authenticated;

-- Aviso em tempo real para a tela do cliente sem expor a tabela:
-- "Broadcast from Database" em um canal público cujo nome é o UUID do
-- pedido (só quem tem o link conhece o canal). Se o recurso não existir
-- no projeto, o erro é engolido e a tela do cliente cai no polling.
create or replace function public.broadcast_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    begin
      perform realtime.send(
        jsonb_build_object('status', new.status),
        'status',
        'order:' || new.id::text,
        false
      );
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;

revoke execute on function public.broadcast_order_status() from public, anon, authenticated;

drop trigger if exists order_status_broadcast on public.orders;
create trigger order_status_broadcast
  after update of status on public.orders
  for each row
  execute function public.broadcast_order_status();


-- ── 4. RPC pública de leitura: só o necessário para a tela do cliente
-- O tipo de retorno muda (linha inteira -> jsonb), por isso o drop.
drop function if exists public.get_order_public(uuid);

create function public.get_order_public(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',                 o.id,
    'order_number',       o.order_number,
    'customer_name',      o.customer_name,
    'status',             o.status,
    'created_at',         o.created_at,
    'ready_at',           o.ready_at,
    'collected_at',       o.collected_at,
    'push_enabled',       o.push_subscription is not null,
    'establishment_name', e.name,
    'orders_ahead',       case when o.status = 'waiting' then (
                            select count(*)
                              from public.orders o2
                             where o2.establishment_id = o.establishment_id
                               and o2.status = 'waiting'
                               and o2.created_at < o.created_at
                          ) end
  )
    from public.orders o
    join public.establishments e on e.id = o.establishment_id
   where o.id = p_order_id;
$$;

revoke execute on function public.get_order_public(uuid) from public;
grant execute on function public.get_order_public(uuid) to anon, authenticated;


-- ── 5. RPC pública de push: valida formato, destino e status ───────
create or replace function public.update_order_push_subscription(
  p_order_id uuid,
  p_subscription jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text;
  v_host     text;
  v_p256dh   text;
  v_auth     text;
begin
  if p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'Assinatura de push invalida';
  end if;

  v_endpoint := p_subscription ->> 'endpoint';
  v_p256dh   := p_subscription -> 'keys' ->> 'p256dh';
  v_auth     := p_subscription -> 'keys' ->> 'auth';

  if v_endpoint is null or length(v_endpoint) > 1024
     or v_endpoint !~ '^https://[a-zA-Z0-9.-]+/'
     or coalesce(v_p256dh, '') = '' or length(v_p256dh) > 256
     or coalesce(v_auth, '') = ''   or length(v_auth) > 128 then
    raise exception 'Assinatura de push invalida';
  end if;

  -- Só serviços de push conhecidos. Sem isso, a função send-push
  -- poderia ser usada para fazer requisições a qualquer URL.
  -- Mantenha em sincronia com ALLOWED_PUSH_HOSTS em
  -- supabase/functions/send-push/index.ts.
  v_host := lower(substring(v_endpoint from '^https://([a-zA-Z0-9.-]+)/'));

  if not (
       v_host = 'fcm.googleapis.com'                -- Chrome, Edge, Samsung, Opera, Brave
    or v_host like '%.push.services.mozilla.com'    -- Firefox
    or v_host like '%.push.apple.com'               -- Safari (iOS e macOS)
    or v_host like '%.notify.windows.com'           -- Edge / Windows
  ) then
    raise exception 'Servico de push nao suportado';
  end if;

  -- Grava só os campos conhecidos (descarta qualquer extra) e apenas
  -- enquanto o pedido ainda está em preparo.
  update public.orders
     set push_subscription = jsonb_build_object(
           'endpoint', v_endpoint,
           'keys', jsonb_build_object('p256dh', v_p256dh, 'auth', v_auth)
         )
   where id = p_order_id
     and status = 'waiting';

  if not found then
    raise exception 'Pedido nao encontrado ou ja finalizado';
  end if;
end;
$$;

revoke execute on function public.update_order_push_subscription(uuid, jsonb) from public;
grant execute on function public.update_order_push_subscription(uuid, jsonb) to anon, authenticated;


-- ── 6. Criação de pedido: nome opcional e com tamanho limitado ─────
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
  v_name text;
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

  v_name := left(coalesce(nullif(trim(p_customer_name), ''), 'Cliente'), 60);
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
    v_name,
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

revoke execute on function public.create_order_for_current_establishment(text) from public, anon;
grant execute on function public.create_order_for_current_establishment(text) to authenticated;


-- ── 7. reset mensal: só o agendador (pg_cron) executa ──────────────
create or replace function public.reset_monthly_orders()
returns void
language sql
security definer
set search_path = public
as $$
  update public.establishments
     set orders_this_month = 0
   where orders_this_month <> 0;
$$;

revoke execute on function public.reset_monthly_orders() from public, anon, authenticated;
