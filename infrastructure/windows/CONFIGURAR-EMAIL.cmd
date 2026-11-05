<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Configurar e-mail do Mapa
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - CONFIGURAR E-MAIL DO MAPA (Microsoft 365)
# =============================================================================
#  Duplo clique. Pede a senha do everblue (SSH e sudo) e depois, NA VM, a
#  caixa remetente, o tenant, o client ID e o SEGREDO da App Registration de
#  e-mail. O segredo e digitado sem aparecer na tela e nao passa por este
#  computador. Ao final, envia um e-mail de teste; se falhar, nada muda.
# =============================================================================
$Servidor = '192.168.0.248'
$Usuario  = 'everblue'
Write-Host "`n==> Conectando em $Usuario@$Servidor (senha do SSH e depois do sudo)" -ForegroundColor Cyan
& ssh -t -o StrictHostKeyChecking=accept-new "$Usuario@$Servidor" "cd /opt/everblue-monitoramento/app && sudo -p '[sudo] senha do everblue (a mesma do SSH): ' bash infrastructure/scripts/configurar_email.sh"
exit $LASTEXITCODE
