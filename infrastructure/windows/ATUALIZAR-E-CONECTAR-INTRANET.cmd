<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Atualizar e conectar a Intranet
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - ATUALIZAR E CONECTAR A INTRANET (arquivo unico)
# =============================================================================
#  Duplo clique. Faz, nesta ordem:
#    1. liga o Monitoramento a Intranet do MESMO jeito que a IA Everblue:
#       chamada interna assinada (HMAC) com chave exclusiva do Monitoramento,
#       derivada NA Intranet - o segredo mestre nao sai de la e nada na
#       Intranet e alterado;
#    2. atualiza o Monitoramento para a versao do pacote (a atual fica
#       guardada para retorno);
#    3. testa a chamada assinada.
#
#  Senhas pedidas:
#    - everblue@192.168.0.248 (VM do Monitoramento): no SSH e no sudo;
#    - everblue@192.168.0.250 (VM da INTRANET): uma vez, para derivar a chave.
#  Tambem pergunta se o backup corporativo esta em dia (confirme com "s").
#
#  Precisa estar na mesma pasta que:
#    everblue-monitoramento-X.Y.Z.tar.gz  e  everblue-monitoramento-X.Y.Z.tar.gz.sha256
#
#  Pode rodar de novo: o que ja foi feito e reaproveitado.
# =============================================================================

$Servidor = '192.168.0.248'
$Usuario  = 'everblue'
$Destino  = '/tmp/everblue-monitoramento'

$ErrorActionPreference = 'Stop'
function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  ok  $t" -ForegroundColor Green }
function Falha($t) { Write-Host "`nERRO: $t" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  Monitoramento Everblue - atualizar e conectar a Intranet' -ForegroundColor White
Write-Host "  Servidor: $Usuario@$Servidor" -ForegroundColor Gray

foreach ($cmd in 'ssh', 'scp') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Falha "$cmd nao encontrado. Ative 'Cliente OpenSSH' em Configuracoes > Aplicativos > Recursos opcionais."
  }
}

# ------------------------------------------------------------------ pacote
Passo 'Conferindo o pacote'
$pasta  = Split-Path -Parent $env:EMON_ARQUIVO
$pacote = Get-ChildItem -Path $pasta -Filter 'everblue-monitoramento-*.tar.gz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $pacote) { Falha "Nenhum everblue-monitoramento-*.tar.gz em $pasta." }
$arqHash = "$($pacote.FullName).sha256"
if (-not (Test-Path $arqHash)) { Falha "Falta $($pacote.Name).sha256 ao lado do pacote." }
$hash = ((Get-Content $arqHash -Raw).Trim() -split '\s+')[0].ToLower()
if ((Get-FileHash -Algorithm SHA256 -Path $pacote.FullName).Hash.ToLower() -ne $hash) {
  Falha "O pacote $($pacote.Name) esta corrompido (checksum nao confere). Copie de novo."
}
Ok "$($pacote.Name) integro ($([math]::Round($pacote.Length / 1KB)) KB)"

# ------------------------------------------------------------------ roteiro que roda na VM
# Vai em base64 no proprio comando SSH: sem aspas para escapar e sem depender
# do shell do usuario. Recebe o pacote pelo tunel desta mesma conexao (uma
# senha so), confere o checksum e chama o instalar.sh que vem DENTRO do pacote.
$portaLocal  = Get-Random -Minimum 20000 -Maximum 40000   # escuta nesta maquina
$portaRemota = Get-Random -Minimum 40001 -Maximum 60000   # abre na VM, dentro do tunel
function RoteiroRemoto([int]$portaTunel) {
@"
set -eu
D='$Destino'; NOME='$($pacote.Name)'; HASH='$hash'; PORTA='$portaTunel'
mkdir -p "`$D"; chmod 700 "`$D"; cd "`$D"
# Plano B (scp): o pacote chegou em /tmp; traz para a pasta de trabalho.
[ -f "/tmp/`$NOME" ] && [ "`$PORTA" = 0 ] && mv -f "/tmp/`$NOME" "`$D/`$NOME"
if [ "`$PORTA" != 0 ]; then
  echo '==> Recebendo o pacote pela conexao SSH...'
  echo "`$HASH  `$NOME.parcial" > conferencia.sha256
  n=0
  until bash -c "exec 3<>/dev/tcp/127.0.0.1/`$PORTA && cat <&3 > '`$NOME.parcial'" 2>/dev/null \
        && [ -s "`$NOME.parcial" ] && sha256sum -c --status conferencia.sha256; do
    n=`$((n+1)); [ `$n -ge 30 ] && { echo 'ERRO: nao foi possivel receber o pacote pela conexao.'; exit 1; }; sleep 1
  done
  mv "`$NOME.parcial" "`$NOME"; rm -f conferencia.sha256
fi
echo "`$HASH  `$NOME" > "`$NOME.sha256"
sha256sum -c "`$NOME.sha256" || { echo 'ERRO: pacote chegou corrompido. Rode de novo.'; exit 1; }
tar -xzOf "`$NOME" --wildcards '*/infrastructure/servidor/instalar.sh' > instalar.sh
tar -xzOf "`$NOME" --wildcards '*/infrastructure/servidor/atualizar.sh' > atualizar.sh
tar -xzOf "`$NOME" --wildcards '*/infrastructure/servidor/retornar.sh' > retornar.sh
tar -xzOf "`$NOME" --wildcards '*/infrastructure/scripts/conectar_intranet.sh' > conectar_intranet.sh
tar -xzOf "`$NOME" --wildcards '*/infrastructure/confianca/intranet-raiz-v2.pem' > intranet-raiz-v2.pem
chmod +x instalar.sh atualizar.sh retornar.sh conectar_intranet.sh
echo
echo '==> Roda como administrador: o sudo vai pedir a MESMA senha do SSH.'
exec sudo -p '[sudo] senha do everblue do MONITORAMENTO (a mesma do SSH): ' bash -c "set -e
bash '`$D/conectar_intranet.sh' --sem-implantar
bash '`$D/atualizar.sh' '`$D/`$NOME'
bash /opt/everblue-monitoramento/app/infrastructure/scripts/conectar_intranet.sh --testar"
"@
}
function EmBase64($texto) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($texto -replace "`r`n", "`n"))) }

# ------------------------------------------------------------------ envio pelo tunel
Passo "Conectando em $Usuario@$Servidor (digite a senha quando pedir)"
$transmissor = Start-Job -ArgumentList $portaLocal, $pacote.FullName -ScriptBlock {
  param($p, $arquivo)
  # So escuta no loopback desta maquina: o unico caminho ate aqui e o tunel da
  # propria sessao SSH. Atende quantas tentativas o lado da VM precisar.
  $escuta = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)
  $escuta.Start()
  while ($true) {
    $cliente = $escuta.AcceptTcpClient()
    try {
      $fluxo = $cliente.GetStream()
      $origem = [IO.File]::OpenRead($arquivo)
      $origem.CopyTo($fluxo); $origem.Close(); $fluxo.Flush()
      $cliente.Client.Shutdown([Net.Sockets.SocketShutdown]::Send)
      Start-Sleep -Milliseconds 300
    } catch { } finally { $cliente.Close() }
  }
}
Start-Sleep -Seconds 1

$b64 = EmBase64 (RoteiroRemoto $portaRemota)
& ssh -t -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 `
      -R "${portaRemota}:127.0.0.1:${portaLocal}" "$Usuario@$Servidor" "echo $b64 | base64 -d > /tmp/emon_instalar_$portaRemota.sh && bash /tmp/emon_instalar_$portaRemota.sh; r=`$?; rm -f /tmp/emon_instalar_$portaRemota.sh; exit `$r"
$codigo = $LASTEXITCODE
Stop-Job $transmissor -ErrorAction SilentlyContinue; Remove-Job $transmissor -Force -ErrorAction SilentlyContinue

# 255 = a propria conexao/tunel falhou (ex.: servidor sem encaminhamento de porta).
# Plano B: copia com scp (pede a senha mais uma vez) e roda o mesmo roteiro.
if ($codigo -eq 255) {
  Write-Host "`n  O tunel SSH nao esta disponivel nesta VM; enviando por scp (a senha sera pedida mais duas vezes)." -ForegroundColor Yellow
  & scp -o StrictHostKeyChecking=accept-new $pacote.FullName "${Usuario}@${Servidor}:/tmp/"
  if ($LASTEXITCODE -ne 0) { Falha "Nao foi possivel copiar para $Usuario@$Servidor. Confira IP, usuario e senha." }
  $b64 = EmBase64 (RoteiroRemoto 0)
  & ssh -t "$Usuario@$Servidor" "echo $b64 | base64 -d > /tmp/emon_instalar.sh && bash /tmp/emon_instalar.sh; r=`$?; rm -f /tmp/emon_instalar.sh; exit `$r"
  $codigo = $LASTEXITCODE
}

if ($codigo -eq 0) {
  Write-Host "`n  Concluido: Monitoramento atualizado e conectado a Intranet." -ForegroundColor Green
  Write-Host "  Falta, na Intranet > Configuracoes > Controle de Acessos: Monitoramento cadastrado/ativo e as pessoas liberadas." -ForegroundColor Green
} else {
  Write-Host "`n  Terminou com erro (codigo $codigo). Veja as mensagens acima; corrigido o problema, de duplo clique de novo." -ForegroundColor Yellow
}
exit $codigo
