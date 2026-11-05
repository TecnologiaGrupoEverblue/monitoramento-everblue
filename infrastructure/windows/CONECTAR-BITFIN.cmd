<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Conectar ao Bitfin
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - CONECTAR AO BITFIN (somente leitura)
# =============================================================================
#  Duplo clique. Pede a senha do everblue (SSH e sudo) e depois, NA VM, o
#  servidor, o usuario e a SENHA do SQL Server do Bitfin. A senha e digitada
#  sem aparecer na tela e nao passa por este computador nem por linha de
#  comando. Ao final, testa a leitura da foto SEM gravar nada.
# =============================================================================
$Servidor = '192.168.0.248'
$Usuario  = 'everblue'
Write-Host "`n==> Conectando em $Usuario@$Servidor (senha do SSH e depois do sudo)" -ForegroundColor Cyan
& ssh -t -o StrictHostKeyChecking=accept-new "$Usuario@$Servidor" "cd /opt/everblue-monitoramento/app && sudo -p '[sudo] senha do everblue (a mesma do SSH): ' bash infrastructure/scripts/configurar_bitfin.sh"
exit $LASTEXITCODE
