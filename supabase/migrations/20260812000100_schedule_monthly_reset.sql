-- ============================================================
-- Agenda o reset mensal de orders_this_month.
--
-- A function public.reset_monthly_orders() já existia desde a migration
-- inicial, mas nada a chamava — o contador nunca zerava e o limite do
-- plano gratuito ficava bloqueado permanentemente após o primeiro mês.
-- ============================================================

create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'reset-monthly-orders') then
    perform cron.schedule(
      'reset-monthly-orders',
      '0 0 1 * *', -- 00:00 no dia 1 de cada mês (UTC)
      $cron$select public.reset_monthly_orders();$cron$
    );
  end if;
end;
$$;
