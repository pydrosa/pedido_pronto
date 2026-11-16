// Testes de ataque e de fluxo das migrations, rodando num Postgres embutido
// (PGlite) com um esqueleto mínimo do ambiente Supabase (papéis anon /
// authenticated / service_role, auth.uid(), auth.users, realtime.send).
//
// Como rodar (não entra no bundle nem nas dependências do app):
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/rls-attack-tests.mjs supabase/migrations             # banco SEM a correção
//   node supabase/tests/rls-attack-tests.mjs supabase/migrations --with-fix  # banco COM a 20261116000000
//
// "PASS" nos itens A1..A12 significa que o ataque foi bloqueado.
// A migration de pg_cron é pulada (a extensão não existe no PGlite).
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const withFix = process.argv.includes('--with-fix')

const db = new PGlite({ extensions: { uuid_ossp } })

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
create schema realtime;
create table realtime.sent (payload jsonb, event text, topic text, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ insert into realtime.sent values (payload, event, topic, private) $$;
`

await db.exec(SUPABASE_STUB)

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  if (f.includes('schedule_monthly_reset')) continue // pg_cron não existe no PGlite
  if (f.startsWith('20261116') && !withFix) continue
  await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
  console.log('applied', f)
}

// Executa SQL como um papel do Supabase (anon/authenticated/service_role).
async function as(role, uid, sql, params = []) {
  await db.exec('begin')
  try {
    await db.exec(`set local role ${role}`)
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    const res = await db.query(sql, params)
    await db.exec('commit')
    return { ok: true, rows: res.rows, n: res.affectedRows }
  } catch (e) {
    await db.exec('rollback')
    return { ok: false, error: e.message }
  }
}
const admin = (sql, params = []) => db.query(sql, params)

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const C = '00000000-0000-0000-0000-00000000000c'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const brief = (r) => (r.ok ? `ok (${r.rows?.length ?? 0} linhas, ${r.n ?? 0} afetadas)` : `erro: ${r.error}`)

// ── Cadastro (como o app faz) ─────────────────────────────────────────────
for (const [uid, name] of [[A, 'Lanchonete A'], [B, 'Burger B']]) {
  await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    uid, `${name[name.length - 1].toLowerCase()}@x.com`, JSON.stringify({ establishment_name: name }),
  ])
  const existing = await as('authenticated', uid, `select id from public.establishments where owner_id = $1`, [uid])
  if (!existing.rows?.length) {
    // fallback do front-end novo: só owner_id, name, email
    const ins = await as('authenticated', uid,
      `insert into public.establishments (owner_id, name, email) values ($1, $2, $3) returning id`,
      [uid, name, 'x@x.com'])
    if (!ins.ok) throw new Error('signup insert falhou: ' + ins.error)
  }
}
const estA = (await admin(`select * from public.establishments where owner_id = $1`, [A])).rows[0]
const estB = (await admin(`select * from public.establishments where owner_id = $1`, [B])).rows[0]
check('cadastro cria estabelecimento no plano free', estA?.plan === 'free' && estB?.plan === 'free' && estA.name === 'Lanchonete A')

// ── Fluxo normal ─────────────────────────────────────────────────────────
const o1 = await as('authenticated', A, `select * from public.create_order_for_current_establishment($1)`, ['Maria'])
const o2 = await as('authenticated', A, `select * from public.create_order_for_current_establishment($1)`, [''])
const oB = await as('authenticated', B, `select * from public.create_order_for_current_establishment($1)`, ['Carlos'])
check('RPC cria pedidos sequenciais', o1.ok && o2.ok && o1.rows[0].order_number === '001' && o2.rows[0].order_number === '002', brief(o1))
const idA1 = o1.rows[0].id, idA2 = o2.rows[0].id, idB = oB.rows[0].id
if (withFix) check('nome vazio vira "Cliente"', o2.rows[0].customer_name === 'Cliente')

const GOOD_SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys: { p256dh: 'BPk'.padEnd(87, 'x'), auth: 'authsecret1234567890ab' } }
const EVIL_SUB = { endpoint: 'https://attacker.example/collect', keys: { p256dh: 'x', auth: 'y' } }

const sub1 = await as('anon', null, `select public.update_order_push_subscription($1, $2::jsonb)`, [idA1, JSON.stringify(GOOD_SUB)])
check('cliente (anon) ativa push com endpoint legítimo', sub1.ok, brief(sub1))

const pub = await as('anon', null, withFix ? `select public.get_order_public($1) as o` : `select to_jsonb(t) as o from public.get_order_public($1) t`, [idA2])
const pubRow = pub.ok ? pub.rows[0].o : null
check('cliente (anon) lê o próprio pedido pela RPC', pub.ok && pubRow && pubRow.status === 'waiting', brief(pub))
if (withFix) {
  check('RPC pública traz nome do estabelecimento e fila', pubRow.establishment_name === 'Lanchonete A' && Number(pubRow.orders_ahead) === 1, JSON.stringify(pubRow))
}

// ── Ataques ──────────────────────────────────────────────────────────────
console.log('\n--- ataques (PASS = bloqueado) ---')

const e1 = await as('authenticated', A, `update public.establishments set plan = 'pro', orders_this_month = 0 where owner_id = $1`, [A])
const planA = (await admin(`select plan from public.establishments where owner_id = $1`, [A])).rows[0].plan
check('A1 dono NÃO consegue se dar o plano Pro', planA === 'free', brief(e1))
await admin(`update public.establishments set plan = 'free' where owner_id = $1`, [A])

await admin(`insert into auth.users (id, email) values ($1, 'c@x.com') on conflict do nothing`, [C])
await admin(`delete from public.establishments where owner_id = $1`, [C])
const e2 = await as('authenticated', C, `insert into public.establishments (owner_id, name, email, plan) values ($1, 'C', 'c@x.com', 'pro')`, [C])
const planC = (await admin(`select plan from public.establishments where owner_id = $1`, [C])).rows[0]?.plan
check('A2 cadastro NÃO consegue nascer no plano Pro', planC !== 'pro', brief(e2))

const e3 = await as('anon', null, `select id, customer_name, order_number, status from public.orders`)
check('A3 anon NÃO lista pedidos de todos os estabelecimentos', !e3.ok || e3.rows.length === 0, brief(e3))

const e4 = await as('anon', null, `select public.update_order_push_subscription($1, $2::jsonb)`, [idB, JSON.stringify(EVIL_SUB)])
const subB = (await admin(`select push_subscription from public.orders where id = $1`, [idB])).rows[0].push_subscription
check('A4 anon NÃO grava endpoint de push arbitrário (SSRF/sequestro)', subB === null, brief(e4))

const e5 = await as('anon', null, withFix ? `select public.get_order_public($1) as o` : `select to_jsonb(t) as o from public.get_order_public($1) t`, [idA1])
const leak = e5.ok ? JSON.stringify(e5.rows[0].o) : ''
check('A5 RPC pública NÃO vaza push_subscription nem establishment_id', e5.ok && !leak.includes('fcm.googleapis') && !leak.includes('establishment_id'), leak.slice(0, 90))

await admin(`update public.establishments set orders_this_month = 7 where owner_id = $1`, [B])
const e6 = await as('anon', null, `select public.reset_monthly_orders()`)
const cntB = (await admin(`select orders_this_month from public.establishments where owner_id = $1`, [B])).rows[0].orders_this_month
check('A6 anon NÃO zera o contador mensal de todos', cntB === 7, brief(e6))

const e7 = await as('authenticated', A, `insert into public.orders (establishment_id, order_number, customer_name) values ($1, 'X99', 'furo')`, [estA.id])
check('A7 dono NÃO insere pedido direto (fura limite do plano)', !e7.ok, brief(e7))

const e8 = await as('authenticated', A, `update public.orders set status = 'ready' where id = $1`, [idB])
const stB = (await admin(`select status from public.orders where id = $1`, [idB])).rows[0].status
check('A8 dono A NÃO altera pedido do estabelecimento B', stB === 'waiting', brief(e8))

const e9 = await as('authenticated', B, `select id from public.orders where establishment_id = $1`, [estA.id])
check('A9 dono B NÃO lê pedidos do estabelecimento A', e9.ok && e9.rows.length === 0, brief(e9))

const e10 = await as('authenticated', A, `update public.orders set customer_name = 'hack', push_subscription = $2::jsonb where id = $1`, [idA2, JSON.stringify(EVIL_SUB)])
const rowA2 = (await admin(`select customer_name, push_subscription from public.orders where id = $1`, [idA2])).rows[0]
check('A10 dono NÃO grava push_subscription arbitrária via UPDATE', rowA2.push_subscription === null, brief(e10))

const e11 = await as('anon', null, `select * from public.create_order_for_current_establishment('x')`)
check('A11 anon NÃO cria pedido', !e11.ok, brief(e11))

const e12 = await as('anon', null, `select id, plan, email from public.establishments`)
check('A12 anon NÃO lê estabelecimentos', !e12.ok || e12.rows.length === 0, brief(e12))

// ── Fluxo do painel continua funcionando ─────────────────────────────────
console.log('\n--- fluxo do painel ---')
const r1 = await as('authenticated', A, `update public.orders set status = 'ready', ready_at = now() where id = $1 returning *`, [idA1])
check('dono marca pedido como pronto (UPDATE ... RETURNING)', r1.ok && r1.rows[0]?.status === 'ready' && r1.rows[0].notified_at !== null && r1.rows[0].push_subscription !== null, brief(r1))

if (withFix) {
  const sent = (await admin(`select * from realtime.sent where topic = $1`, ['order:' + idA1])).rows
  check('mudança de status dispara broadcast no canal do pedido', sent.length === 1 && sent[0].payload.status === 'ready' && sent[0].private === false, JSON.stringify(sent[0] ?? null))

  const late = await as('anon', null, `select public.update_order_push_subscription($1, $2::jsonb)`, [idA1, JSON.stringify(GOOD_SUB)])
  check('push não pode ser trocado depois que o pedido ficou pronto', !late.ok, brief(late))
}

const r2 = await as('authenticated', A, `update public.orders set status = 'collected', collected_at = now() where id = $1 returning *`, [idA1])
check('dono marca pedido como retirado', r2.ok && r2.rows[0]?.status === 'collected', brief(r2))
if (withFix) check('retirado limpa o endereço de push do cliente', r2.rows[0].push_subscription === null)

const r3 = await as('authenticated', A, `update public.establishments set name = 'Lanchonete A2' where owner_id = $1 returning name`, [A])
check('dono renomeia o estabelecimento', r3.ok && r3.rows[0]?.name === 'Lanchonete A2', brief(r3))

const r4 = await as('authenticated', A, `delete from public.orders where id = $1`, [idA1])
check('dono remove pedido', r4.ok && r4.n === 1, brief(r4))

const r5 = await as('service_role', null, `update public.establishments set plan = 'basic', stripe_customer_id = 'cus_1' where id = $1 returning plan`, [estA.id])
check('webhook (service role) altera o plano', r5.ok && r5.rows[0]?.plan === 'basic', brief(r5))
await admin(`update public.establishments set plan = 'free', orders_this_month = 0 where id = $1`, [estA.id])

// limite do plano grátis
let created = 0, lastErr = ''
for (let i = 0; i < 25; i++) {
  const r = await as('authenticated', A, `select * from public.create_order_for_current_establishment($1)`, ['c' + i])
  if (r.ok) created++; else lastErr = r.error
}
check('limite de 20 pedidos/mês do plano grátis vale no banco', created === 20, `${created} criados; ${lastErr}`)

if (withFix) {
  // gatilho de cadastro
  const D = '00000000-0000-0000-0000-00000000000d'
  await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'dona@padaria.com', '{"establishment_name":"Padaria D"}')`, [D])
  const estD = (await admin(`select name, plan, email from public.establishments where owner_id = $1`, [D])).rows[0]
  check('gatilho cria o estabelecimento no cadastro', estD?.name === 'Padaria D' && estD.plan === 'free', JSON.stringify(estD ?? null))

  const nf = await as('anon', null, `select public.get_order_public($1) as o`, ['11111111-1111-1111-1111-111111111111'])
  check('pedido inexistente devolve null (tela "não encontrado")', nf.ok && nf.rows[0].o === null, brief(nf))

  const cron = await admin(`select public.reset_monthly_orders()`)
  const z = (await admin(`select max(orders_this_month) m from public.establishments`)).rows[0].m
  check('reset mensal continua funcionando para o agendador', z === 0)
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passaram${failed.length ? ' — FALHAS: ' + failed.map((f) => f.name).join(' | ') : ''}`)
