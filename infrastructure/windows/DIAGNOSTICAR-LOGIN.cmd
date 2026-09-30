<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Diagnostico do login
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - DIAGNOSTICO DO LOGIN (so le, nao altera nada)
# =============================================================================
#  Duplo clique. Pede a senha do everblue do Monitoramento (SSH e sudo) e
#  mostra o MOTIVO REAL das ultimas recusas de login, o teste da chamada
#  assinada a Intranet e os ultimos erros da API. Nenhuma chave e exibida.
# =============================================================================
$Servidor = '192.168.0.248'
$Usuario  = 'everblue'

$s = @'
set -uo pipefail
APP="${APP:-/opt/everblue-monitoramento/app}"
cd "$APP" || { echo "ERRO: $APP não encontrado"; exit 1; }
# shellcheck source=/dev/null
source infrastructure/scripts/comum.sh
carregar_env .env
SEG="${DIRETORIO_INTEGRATION_SECRET:-}"
echo
echo "== Versão instalada: $(cat VERSAO)"
echo "== Ligação com a Intranet"
echo "   DIRETORIO_URL       = ${DIRETORIO_URL:-(vazio)}"
echo "   DIRETORIO_CLIENT_ID = ${DIRETORIO_CLIENT_ID:-(vazio → usa ENTRA_CLIENT_ID ${ENTRA_CLIENT_ID:-vazio})}"
echo "   chave HMAC          = $([ ${#SEG} -ge 32 ] && echo "presente (${#SEG} caracteres)" || echo AUSENTE)"
echo "   Graph para perfil   = ${ENTRA_GRAPH_PERFIL:-true}   · foto: ${FOTO_FONTE:-graph}"
echo
echo "== Teste da chamada assinada (identidade de teste)"
docker compose exec -T api node dist/cli.js testar-intranet 2>&1 | sed 's/^/   /'
echo
echo "== Últimas tentativas de login pelo Entra (motivo real, da auditoria)"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c \
  "SELECT to_char(em AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI:SS') AS quando, resultado, left(coalesce(motivo,''),300) AS motivo
     FROM auditoria WHERE acao = 'login.entra' ORDER BY em DESC LIMIT 6" 2>&1 | sed 's/^/   /'
echo
echo "== Últimos erros da API"
docker compose logs --since 2h api 2>&1 | grep -i -E '"level":(40|50)|erro|error' | tail -8 | cut -c1-400 | sed 's/^/   /'
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($s -replace "`r`n", "`n")))
Write-Host "`n==> Conectando em $Usuario@$Servidor (senha do SSH e depois do sudo)" -ForegroundColor Cyan
& ssh -t -o StrictHostKeyChecking=accept-new "$Usuario@$Servidor" "echo $b | base64 -d > /tmp/emon_diag.sh && sudo -p '[sudo] senha do everblue (a mesma do SSH): ' bash /tmp/emon_diag.sh; r=`$?; rm -f /tmp/emon_diag.sh; exit `$r"
Write-Host "`n  Tire um print desta tela (ou copie o texto) e envie." -ForegroundColor Green
exit $LASTEXITCODE
