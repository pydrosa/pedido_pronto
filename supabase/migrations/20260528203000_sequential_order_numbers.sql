alter table public.establishments
  add column if not exists next_order_number integer not null default 1;

with numbered_orders as (
  select
    id,
    row_number() over (
      partition by establishment_id
      order by created_at asc, id asc
    ) as sequence_number
  from public.orders
)
update public.orders as orders
   set order_number = lpad(numbered_orders.sequence_number::text, 3, '0')
  from numbered_orders
 where orders.id = numbered_orders.id;

with next_numbers as (
  select
    establishment_id,
    count(*)::integer + 1 as next_order_number
  from public.orders
  group by establishment_id
)
update public.establishments as establishments
   set next_order_number = greatest(next_numbers.next_order_number, 1)
  from next_numbers
 where establishments.id = next_numbers.establishment_id;

create unique index if not exists orders_establishment_order_number_idx
  on public.orders(establishment_id, order_number);

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
