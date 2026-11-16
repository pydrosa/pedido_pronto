# =============================================================================
#  Pedido Pronto - deploy das correcoes de 16/11/2026
#
#  Ordem (a mesma do relatorio, secao 1):
#    1. Confere ferramentas e build local (tsc + vite + testes)
#    2. Commit e push para o GitHub
#    3. Confere o historico de migrations no Supabase de producao
#    4. Publica o front-end na Vercel (producao)
#    5. Publica a funcao send-push
#    6. Aplica a migration 20261116000000_security_fixes (supabase db push)
#
#  Como rodar: de dois cliques em deploy-correcoes.cmd
#  (ou: powershell -ExecutionPolicy Bypass -File .\deploy-correcoes.ps1)
#
#  O script para no primeiro erro e pede confirmacao antes de cada etapa que
#  muda algo fora do seu computador.
# =============================================================================

param(
  [string]$SiteUrl = "https://apppedidopronto.vercel.app"
)

# "Continue": no Windows PowerShell 5.1, "Stop" transforma qualquer texto que
# git/npm escrevem no stderr em erro fatal. Cada comando e checado pelo codigo
# de saida em Rodar().
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot

function Titulo($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  OK  $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  !!  $t" -ForegroundColor Yellow }
function Falha($t)  { Write-Host ""; Write-Host "  PAROU: $t" -ForegroundColor Red; Write-Host ""; Read-Host "Enter para fechar"; exit 1 }

function Rodar([string]$cmd) {
  Write-Host "  > $cmd" -ForegroundColor DarkGray
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Falha "o comando terminou com erro (codigo $LASTEXITCODE): $cmd" }
}

function Confirmar([string]$pergunta) {
  $r = Read-Host "$pergunta [s/N]"
  if ($r -notmatch '^(s|sim|y|yes)$') { Falha "cancelado por voce. Nada a partir desta etapa foi feito." }
}

function Existe([string]$exe) { return [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

# -----------------------------------------------------------------------------
Titulo "1/6  Ferramentas e build local"

if (-not (Existe "git"))  { Falha "git nao encontrado. Instale em https://git-scm.com" }
if (-not (Existe "node")) { Falha "Node.js nao encontrado. Instale em https://nodejs.org" }
Ok "git e node encontrados"

$SUPA = if (Existe "supabase") { "supabase" } else { "npx --yes supabase" }
$VERCEL = if (Existe "vercel") { "vercel" } else { "npx --yes vercel" }
Ok "Supabase CLI: $SUPA"
Ok "Vercel CLI:   $VERCEL"

if (-not (Test-Path "node_modules")) { Rodar "npm ci" }
Rodar "npm run build"
Ok "build de producao gerado (tsc + vite)"
Rodar "npm test"
Ok "testes passaram"

# -----------------------------------------------------------------------------
Titulo "2/6  Commit e push para o GitHub"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Ok "branch atual: $branch"

Rodar "git fetch origin"
$atras = [int]((cmd /c "git rev-list --count HEAD..origin/$branch 2>nul") | Select-Object -First 1)
if ($atras -gt 0) {
  Falha "o GitHub tem $atras commit(s) que nao estao neste computador. Rode 'git pull' e resolva antes de continuar."
}

git add -A
if ($LASTEXITCODE -ne 0) { Falha "git add falhou" }

# Trava de seguranca: nenhum segredo pode ir para o repositorio.
$staged = git diff --cached --name-only
$segredos = $staged | Where-Object {
  ($_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.env\.example$') -or
  ($_ -match 'secrets') -or ($_ -match '\.(pem|key)$') -or ($_ -match '(^|/)\.vercel/') -or ($_ -match '(^|/)supabase/\.temp/')
}
if ($segredos) {
  git reset -q
  Falha ("arquivo(s) sensivel(is) seriam enviados ao GitHub: " + ($segredos -join ", ") + ". Nada foi commitado.")
}

if (-not $staged) {
  Aviso "nada novo para commitar (talvez ja tenha sido feito)."
} else {
  Write-Host ""
  Write-Host "  Arquivos que vao no commit:" -ForegroundColor White
  $staged | ForEach-Object { Write-Host "    $_" }
  Write-Host ""
  Confirmar "Fazer o commit e enviar para o GitHub ($branch)?"

  $msgFile = Join-Path $env:TEMP "pedido-pronto-commit.txt"
  @"
Seguranca, tela do cliente e painel (revisao de 16/11/2026)

Seguranca (migration 20261116000000_security_fixes):
- dono nao altera mais plano/contadores; cadastro cria estabelecimento por gatilho
- fim da leitura publica de orders; tela do cliente via RPC e canal por pedido
- get_order_public devolve so os campos da tela
- update_order_push_subscription valida formato, servico de push e status
- pedido so e criado pela RPC (limite do plano); reset mensal sem execucao publica
- send-push: lista de servicos permitidos, sem vazar detalhes, limpa inscricao expirada

Tela do cliente: um toque para ativar, aviso sonoro e tela acesa, consulta
periodica, estados de erro, manifesto proprio para instalar no iPhone.

Painel: botao Pronto com estilo, fila completa do mais antigo, barra inferior
no celular, chamar de novo, cancelar, nome do cliente opcional.

Inclui tambem stripe-checkout, migrations de 12/08 e testes que estavam fora do Git.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0176NMdeuospQZi93qSANmed
"@ | Set-Content -Path $msgFile -Encoding ASCII

  Rodar "git commit -F `"$msgFile`""
  Remove-Item $msgFile -ErrorAction SilentlyContinue
  Rodar "git push origin $branch"
  Ok "codigo enviado ao GitHub"
}

# -----------------------------------------------------------------------------
Titulo "3/6  Historico de migrations no Supabase (producao)"

cmd /c "$SUPA projects list >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
  Aviso "voce nao esta logado no Supabase CLI. Vai abrir o navegador para login."
  Rodar "$SUPA login"
}

Write-Host "  > $SUPA migration list" -ForegroundColor DarkGray
$lista = cmd /c "$SUPA migration list 2>&1"
if ($LASTEXITCODE -ne 0) { $lista | Write-Host; Falha "nao consegui ler as migrations. Rode '$SUPA link --project-ref SEU_REF' e tente de novo." }
$lista | Write-Host

$locais = Get-ChildItem "supabase\migrations\*.sql" | ForEach-Object { ($_.Name -split '_')[0] }
$faltando = @()
foreach ($v in $locais) {
  if ($v -eq "20261116000000") { continue }
  $linha = $lista | Where-Object { $_ -match $v } | Select-Object -First 1
  # Cada linha da tabela mostra a versao duas vezes quando ela existe no local E no remoto.
  if (-not $linha -or ([regex]::Matches($linha, $v)).Count -lt 2) { $faltando += $v }
}

if ($faltando.Count -gt 0) {
  Write-Host ""
  Aviso ("estas migrations existem aqui mas NAO constam como aplicadas em producao: " + ($faltando -join ", "))
  Write-Host @"

  Duas situacoes possiveis - e preciso saber qual e a sua antes de continuar:

   a) Voce rodou esses SQLs a mao no SQL Editor do Supabase (como o README
      antigo ensinava). Elas JA estao no banco, so nao foram registradas.
      Registre cada uma assim (uma por linha) e rode este script de novo:
        $SUPA migration repair --status applied <versao>

   b) Elas nunca foram aplicadas. Entao a protecao de 12/08 nao esta em
      producao. Rode este script de novo e responda 's' abaixo: o
      'db push' aplica todas em ordem.

  Em duvida? No SQL Editor do Supabase rode:
      select proname from pg_proc where proname = 'update_order_push_subscription';
  Se voltar uma linha, a 20260812000000 ja esta no banco (caso a).
"@
  Confirmar "Tem certeza de que e o caso (b) e quer que o db push aplique todas elas?"
} else {
  Ok "todas as migrations anteriores constam como aplicadas em producao"
}

# -----------------------------------------------------------------------------
Titulo "4/6  Front-end na Vercel (producao)"

Write-Host "  O front novo funciona com o banco antigo e com o novo; por isso vai primeiro."
Confirmar "Publicar o front-end em producao agora?"
Rodar "$VERCEL --prod"

try {
  $resp = Invoke-WebRequest -Uri "$SiteUrl/pedido/teste" -UseBasicParsing -TimeoutSec 30
  if ($resp.Content -match "manifest-pedido.json") { Ok "versao nova no ar em $SiteUrl" }
  else { Aviso "o site respondeu, mas ainda parece a versao antiga (cache?). Confira $SiteUrl antes de seguir." ; Confirmar "Continuar mesmo assim?" }
} catch {
  Aviso "nao consegui abrir $SiteUrl para conferir ($($_.Exception.Message))."
  Confirmar "O site esta no ar com a versao nova? Continuar?"
}

# -----------------------------------------------------------------------------
Titulo "5/6  Funcao send-push"

Confirmar "Publicar a funcao send-push?"
Rodar "$SUPA functions deploy send-push"
Ok "send-push publicada"

# -----------------------------------------------------------------------------
Titulo "6/6  Migration de seguranca no banco de producao"

Write-Host "  O 'db push' mostra a lista do que vai aplicar e pede confirmacao (Y/n)."
Write-Host "  Confira se aparece 20261116000000_security_fixes.sql."
Rodar "$SUPA db push"
Ok "migration aplicada"

# -----------------------------------------------------------------------------
Titulo "Pronto"
Write-Host @"

  Agora teste com celulares de verdade (5 minutos):
   1. Entre no painel e crie um pedido.
   2. Escaneie o QR com um Android e toque em "Me avise quando ficar pronto".
   3. Bloqueie a tela do Android. No painel, toque em "Pronto".
      -> deve chegar a notificacao e a tela do pedido deve ficar verde.
   4. Repita com um iPhone, deixando a pagina aberta: deve tocar o som.
   5. Toque em "Retirado" e confira que a tela do cliente mostra "Pedido retirado".

  Se algo falhar no passo 3, olhe os logs em:
  Supabase > Edge Functions > send-push > Logs

"@ -ForegroundColor White
Read-Host "Enter para fechar"
