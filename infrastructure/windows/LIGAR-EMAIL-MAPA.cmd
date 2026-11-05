<# : bloco em lote (cmd) - chama o PowerShell com o restante deste mesmo arquivo
@echo off
setlocal
title Monitoramento Everblue - Ligar e-mail do Mapa
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:EMON_ARQUIVO='%~f0'; Invoke-Expression ([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# =============================================================================
#  MONITORAMENTO EVERBLUE - LIGAR O E-MAIL DO MAPA (tudo automatico)
# =============================================================================
#  Duplo clique. Responde sozinho ao CONFIGURAR-EMAIL:
#    - caixa remetente: a de $Remetente abaixo (se vazio, pergunta uma vez);
#    - nome exibido, tenant e client ID: os do login (app "Monitoramento
#      Everblue", que ja tem Mail.Send concedido);
#    - segredo: o mesmo do login, que ja esta no servidor (nada e digitado);
#    - e-mail de teste: $Para abaixo.
#  So pede a senha do everblue (SSH e depois sudo). Se o teste falhar, o envio
#  volta a ficar como estava e aparece o motivo.
# =============================================================================
$Servidor  = '192.168.0.248'
$Usuario   = 'everblue'
$Remetente = ''                                        # ex.: monitoramento@grupoeverblue.com.br
$Para      = 'waldomiro.silva@grupoeverblue.com.br'    # quem recebe o e-mail de teste

$Formato = '^[^\s@''"`$\\]+@[^\s@''"`$\\]+\.[^\s@''"`$\\]+$'
while ($Remetente -notmatch $Formato) {
  $Remetente = (Read-Host "Caixa remetente do Mapa (e-mail que aparece como remetente)").Trim()
}
if ($Para -notmatch $Formato) { Write-Host "E-mail de teste invalido: $Para" -ForegroundColor Red; exit 1 }

Write-Host "`n==> Remetente: $Remetente  |  teste para: $Para" -ForegroundColor Cyan
Write-Host "==> Conectando em $Usuario@$Servidor (senha do SSH e depois do sudo)" -ForegroundColor Cyan
# Respostas, na ordem: remetente, nome (Enter), tenant (Enter), client (Enter),
# segredo (Enter = o do login), e-mail de teste.
$Remoto = "cd /opt/everblue-monitoramento/app && printf '%s\n' '$Remetente' '' '' '' '' '$Para' | sudo -p '[sudo] senha do everblue (a mesma do SSH): ' bash infrastructure/scripts/configurar_email.sh"
& ssh -t -o StrictHostKeyChecking=accept-new "$Usuario@$Servidor" $Remoto
exit $LASTEXITCODE
