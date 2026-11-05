<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - LIMPEZA TOTAL dos dados
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - LIMPEZA TOTAL DOS DADOS (irreversivel)
# =============================================================================
#  Duplo clique. Pede a senha do everblue (SSH e sudo), mostra NA VM tudo o
#  que sera apagado e so apaga depois de digitar a frase  APAGAR TUDO .
#  Mantem apenas usuarios e perfis. Os dados passam a vir so do Bitfin.
# =============================================================================
$Servidor = '192.168.0.248'
$Usuario  = 'everblue'
Write-Host "`n==> Conectando em $Usuario@$Servidor (senha do SSH e depois do sudo)" -ForegroundColor Cyan
& ssh -t -o StrictHostKeyChecking=accept-new "$Usuario@$Servidor" "cd /opt/everblue-monitoramento/app && sudo -p '[sudo] senha do everblue (a mesma do SSH): ' bash infrastructure/scripts/zerar_dados.sh"
exit $LASTEXITCODE
