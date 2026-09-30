<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Enviar para o Git
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - ENVIAR ALTERACOES PARA O GIT (arquivo unico)
# =============================================================================
#  Duplo clique. Envia a pasta everblue-monitoramento para
#    https://github.com/TecnologiaGrupoEverblue/monitoramento-everblue.git  (main)
#  no mesmo padrao da ia-everblue e da intranet-everblue.
#
#  1. prepara o repositorio local na primeira vez (git init, remoto, usuario);
#  2. traz o que ja existe no GitHub, sem apagar nada de la;
#  3. BLOQUEIA o envio se houver segredo ou arquivo proibido (.env, chave,
#     certificado privado, dump, pacote, node_modules...);
#  4. mostra o que mudou, pede a mensagem e a confirmacao;
#  5. faz o commit, marca a versao (tag vX.Y.Z) e envia.
#
#  O login do GitHub e o do Git Credential Manager (janela do navegador), o
#  mesmo usado nos outros repositorios. Nenhuma senha passa por este arquivo.
# =============================================================================

$Remoto  = if ($env:EMON_GIT_URL) { $env:EMON_GIT_URL } else { 'https://github.com/TecnologiaGrupoEverblue/monitoramento-everblue.git' }
$Branch  = 'main'
$NomeAutor  = 'Waldomiro Silva'
$EmailAutor = 'waldomiro.silva@grupoeverblue.com.br'

$ErrorActionPreference = 'Stop'
function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  ok  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  !   $t" -ForegroundColor Yellow }
function Falha($t) { Write-Host "`nERRO: $t" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------------ pasta do projeto
$aqui = Split-Path -Parent $env:EMON_ARQUIVO
$candidatas = @(
  $env:EMON_REPO,
  (Join-Path $aqui '..\..'),                       # dentro do projeto: infrastructure\windows
  (Join-Path $aqui 'everblue-monitoramento'),      # na pasta Monitoramento
  (Join-Path $aqui '..\everblue-monitoramento')    # na pasta pacote
) | Where-Object { $_ }
$Repo = $null
foreach ($c in $candidatas) {
  if ((Test-Path (Join-Path $c 'VERSAO')) -and (Test-Path (Join-Path $c 'apps')) -and (Test-Path (Join-Path $c 'infrastructure'))) {
    $Repo = (Resolve-Path $c).Path; break
  }
}
if (-not $Repo) { Falha 'Nao encontrei a pasta everblue-monitoramento (com VERSAO, apps e infrastructure).' }
$Versao = ((Get-Content (Join-Path $Repo 'VERSAO') -Raw).Trim() -split '\s+')[0]

Write-Host ''
Write-Host '  Monitoramento Everblue - enviar para o Git' -ForegroundColor White
Write-Host "  Pasta:   $Repo" -ForegroundColor Gray
Write-Host "  Destino: $Remoto ($Branch)" -ForegroundColor Gray
Write-Host "  Versao:  $Versao" -ForegroundColor Gray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falha 'Git nao encontrado. Instale o Git for Windows (https://git-scm.com) e rode de novo.' }

# Toda chamada ao git passa por aqui: pasta fixa e sem "dubious ownership".
$seguro = ($Repo -replace '\\', '/')
# O git escreve avisos no stderr; no Windows PowerShell 5.1 isso, com Stop,
# vira excecao. Aqui o stderr e so texto e quem decide e o codigo de saida.
function G {
  $antes = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $saida = & git -c "safe.directory=$seguro" -c core.quotepath=off -C $Repo @args 2>&1 | ForEach-Object { "$_" } }
  finally { $ErrorActionPreference = $antes }
  $global:CodigoGit = $LASTEXITCODE
  return $saida
}
function GOk { $s = G @args; if ($global:CodigoGit -ne 0) { Falha ("git $($args -join ' '):`n" + ($s | Out-String)) }; return $s }

# ------------------------------------------------------------------ 1. repositorio local
Passo '1/5 Repositorio local'
if (-not (Test-Path (Join-Path $Repo '.git'))) {
  GOk init -q | Out-Null
  GOk symbolic-ref HEAD "refs/heads/$Branch" | Out-Null
  Ok 'repositorio criado nesta pasta'
}
$remotoAtual = (G remote get-url origin | Out-String).Trim()
if ($global:CodigoGit -ne 0 -or -not $remotoAtual) {
  GOk remote add origin $Remoto | Out-Null
  Ok "remoto origin = $Remoto"
} elseif ($remotoAtual -ne $Remoto) {
  Falha "Esta pasta aponta para outro remoto ($remotoAtual). Confira antes de enviar."
} else { Ok "remoto origin = $Remoto" }
if (-not ((G config user.email | Out-String).Trim())) { GOk config user.email $EmailAutor | Out-Null }
if (-not ((G config user.name  | Out-String).Trim())) { GOk config user.name  $NomeAutor  | Out-Null }
GOk config core.autocrlf false | Out-Null   # quem decide o fim de linha e o .gitattributes
Ok ("autor: " + (G config user.name | Out-String).Trim() + " <" + (G config user.email | Out-String).Trim() + ">")

# ------------------------------------------------------------------ 2. o que ja esta no GitHub
Passo '2/5 Conferindo o GitHub (pode abrir a janela de login)'
$f = G fetch -q origin
if ($global:CodigoGit -ne 0) {
  $txt = ($f | Out-String)
  if ($txt -match 'not found|could not read|Repository not found') {
    Falha "O repositorio $Remoto nao existe ou seu usuario nao tem acesso. Crie-o em github.com/TecnologiaGrupoEverblue (vazio) ou peca acesso, e rode de novo."
  }
  Falha "Nao consegui falar com o GitHub:`n$txt"
}
G rev-parse -q --verify "refs/remotes/origin/$Branch" | Out-Null
$remotoTemMain = ($global:CodigoGit -eq 0)
G rev-parse -q --verify HEAD | Out-Null
$localTemHistorico = ($global:CodigoGit -eq 0)
$primeiraVez = $false
if (-not $localTemHistorico -and $remotoTemMain) {
  # Liga esta pasta ao historico do GitHub SEM tocar nos arquivos daqui.
  GOk reset -q --mixed "origin/$Branch" | Out-Null
  $primeiraVez = $true
  Ok "historico do GitHub trazido (origin/$Branch); os arquivos desta pasta foram mantidos"
} elseif (-not $remotoTemMain) {
  Ok 'GitHub vazio: este sera o primeiro envio'
} else {
  $atras = (G rev-list --count "HEAD..origin/$Branch" | Out-String).Trim()
  if ($atras -and [int]$atras -gt 0) { Aviso "o GitHub tem $atras commit(s) que esta pasta nao tem; eles serao integrados antes do envio" }
  else { Ok 'pasta em dia com o GitHub' }
}

# ------------------------------------------------------------------ 3. travas de seguranca
Passo '3/5 Separando as alteracoes e conferindo seguranca'
if ($primeiraVez) { GOk add --ignore-removal . | Out-Null } else { GOk add -A | Out-Null }
$arquivos = @(G diff --cached --name-only --diff-filter=ACMR | Where-Object { $_ })
$proibido = '(^|/)(node_modules|dist|coverage|releases|secrets|backups|dados)(/|$)|(^|/)\.env(\..+)?$|\.(key|pfx|p12|dump|log|tsbuildinfo|tar|gz|tgz|zip|7z|rar)$|(^|/)infrastructure/nginx/certs/(?!LEIA-ME\.txt$|\.gitignore$)'
$ruins = @($arquivos | Where-Object { ($_ -match $proibido -and $_ -notmatch '(^|/)\.env\.example$') -or ($_ -match '\.pem$' -and $_ -notmatch '^infrastructure/confianca/[^/]+\.pem$') })
# Conteudo: chave privada, token do GitHub ou segredo preenchido em arquivo de configuracao.
$padrao = '-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|^(ENTRA_CLIENT_SECRET|DIRETORIO_INTEGRATION_SECRET|ACCESS_API_MASTER_SECRET|POSTGRES_PASSWORD|POSTGRES_APP_PASSWORD|SESSAO_SEGREDO|COFRE_CHAVE|MINIO_ROOT_PASSWORD|MINIO_SECRET_KEY)=.'
$vazamentos = @()
if ($arquivos.Count -gt 0) {
  # Modelo com valor de exemplo (TROQUE..., <...>) nao e segredo.
  $vazamentos = @(G grep --cached -I -n -E -e $padrao -- . | Where-Object {
    $_ -match '^[^:]+:\d+:' -and $_ -notmatch ':\d+:[A-Z_]+=(TROQUE|<|\$\{|\s*$|\s*#)'
  })
}
if ($ruins.Count -gt 0 -or $vazamentos.Count -gt 0) {
  G reset -q | Out-Null
  if ($ruins.Count -gt 0)      { Write-Host "`n  Arquivos que NAO podem ir para o Git:" -ForegroundColor Red; $ruins | ForEach-Object { Write-Host "    $_" -ForegroundColor Red } }
  if ($vazamentos.Count -gt 0) { Write-Host "`n  Possivel segredo encontrado (arquivo:linha):" -ForegroundColor Red; $vazamentos | ForEach-Object { Write-Host ("    " + ($_ -replace '(=)(.{4}).*', '$1$2...')) -ForegroundColor Red } }
  Falha 'Envio BLOQUEADO. Nada foi enviado. Remova ou coloque no .gitignore os itens acima e rode de novo.'
}
Ok 'nenhum segredo nem arquivo proibido'

$mudancas = @(G diff --cached --name-status | Where-Object { $_ })
if ($mudancas.Count -eq 0) {
  Ok 'nenhuma alteracao nova nos arquivos'
} else {
  Write-Host "`n  $($mudancas.Count) arquivo(s) alterado(s):" -ForegroundColor White
  $mudancas | Select-Object -First 40 | ForEach-Object {
    $l = $_ -replace "^A\t", '  novo      ' -replace "^M\t", '  alterado  ' -replace "^D\t", '  removido  ' -replace "^R\d*\t", '  renomeado '
    Write-Host "  $l"
  }
  if ($mudancas.Count -gt 40) { Write-Host "    ... e mais $($mudancas.Count - 40)" }
}

# ------------------------------------------------------------------ 4. commit
Passo '4/5 Registro (commit)'
if ($mudancas.Count -gt 0) {
  $padraoMsg = if (-not $localTemHistorico -and -not $remotoTemMain) { "Monitoramento Everblue $Versao - versao inicial no repositorio" } else { "Monitoramento Everblue $Versao" }
  if ($env:EMON_GIT_MENSAGEM) { $msg = $env:EMON_GIT_MENSAGEM } else {
    $msg = Read-Host "  Descreva a alteracao (Enter = `"$padraoMsg`")"
  }
  if (-not $msg.Trim()) { $msg = $padraoMsg }
  if (-not $env:EMON_GIT_MENSAGEM) {
    $r = Read-Host "  Enviar $($mudancas.Count) arquivo(s) para $Branch? [S/n]"
    if ($r -and $r.Trim().ToLower() -notin @('s', 'sim', 'y')) { G reset -q | Out-Null; Falha 'Cancelado. Nada foi enviado.' }
  }
  GOk commit -q -m $msg | Out-Null
  Ok ("commit " + (G rev-parse --short HEAD | Out-String).Trim() + " - $msg")
} else {
  Ok 'nada novo para registrar'
}

# ------------------------------------------------------------------ 5. envio
Passo "5/5 Enviando para $Branch"
if ($remotoTemMain -and -not $primeiraVez) {
  $atras = (G rev-list --count "HEAD..origin/$Branch" | Out-String).Trim()
  if ($atras -and [int]$atras -gt 0) {
    $p = G pull -q --rebase origin $Branch
    if ($global:CodigoGit -ne 0) {
      G rebase --abort | Out-Null
      Falha "O GitHub tem alteracoes que conflitam com as desta pasta. Nada foi enviado; seu commit continua aqui.`n$($p | Out-String)"
    }
    Ok 'alteracoes do GitHub integradas'
  }
}
$frente = if ($remotoTemMain) { (G rev-list --count "origin/$Branch..HEAD" | Out-String).Trim() } else { (G rev-list --count HEAD | Out-String).Trim() }
if ($frente -and [int]$frente -gt 0) {
  $e = G push -u origin "HEAD:refs/heads/$Branch"
  if ($global:CodigoGit -ne 0) {
    $txt = ($e | Out-String)
    if ($txt -match 'protected|GH006') { Falha "A branch $Branch e protegida no GitHub: envie por uma branch e abra um Pull Request.`n$txt" }
    Falha "O envio falhou. Seu commit continua nesta pasta; rode de novo.`n$txt"
  }
  G branch -q --set-upstream-to "origin/$Branch" 2>$null | Out-Null
  Ok "$frente commit(s) enviado(s)"
} else {
  Ok 'o GitHub ja tem tudo'
}

# Marca da versao, como nos pacotes (vX.Y.Z). Nunca move uma tag existente.
$tag = "v$Versao"
G rev-parse -q --verify "refs/tags/$tag" | Out-Null
if ($global:CodigoGit -ne 0) {
  GOk tag -a $tag -m "Monitoramento Everblue $Versao" | Out-Null
  Ok "versao marcada: $tag"
}
$t = G push -q origin "refs/tags/$tag"
if ($global:CodigoGit -eq 0) { Ok "tag $tag no GitHub" } else { Aviso "a tag $tag ja existe no GitHub apontando para outro commit; mantida como estava" }

$web = $Remoto -replace '\.git$', ''
Write-Host "`n  Concluido: $web/tree/$Branch" -ForegroundColor Green
exit 0
