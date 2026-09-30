<#
.SYNOPSIS
  Envia o pacote do Monitoramento Everblue para a VM e, se pedido, inicia a instalação.

.DESCRIPTION
  1. Localiza o pacote mais recente nesta pasta (everblue-monitoramento-X.Y.Z.tar.gz).
  2. Confere o SHA-256 contra o arquivo .sha256 - pacote corrompido não sai daqui.
  3. Garante fim de linha Linux (LF) nos roteiros .sh (o Bloco de Notas pode ter trocado).
  4. Copia pacote + checksum + roteiros para /tmp/everblue-monitoramento na VM (scp).
  5. Com -Instalar, abre o SSH e roda o instalar.sh (ou o atualizar.sh, com -Atualizar).

  Usa o cliente OpenSSH que já vem no Windows 10/11 (scp e ssh).
  Nenhuma senha é gravada: o ssh pede na hora (ou usa sua chave SSH).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\enviar_para_vm.ps1 -Servidor 10.0.0.50 -Usuario waldomiro -Instalar

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\enviar_para_vm.ps1 -Servidor 10.0.0.50 -Usuario waldomiro -Atualizar
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Servidor,
  [string] $Usuario = $env:USERNAME,
  [int]    $Porta = 22,
  [switch] $Instalar,
  [switch] $Atualizar
)

$ErrorActionPreference = 'Stop'
$pasta   = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino = '/tmp/everblue-monitoramento'

function Ok($texto)    { Write-Host "  ok  $texto" -ForegroundColor Green }
function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Falha($texto) { Write-Host "`nERRO: $texto" -ForegroundColor Red; exit 1 }

if ($Instalar -and $Atualizar) { Falha 'Use -Instalar OU -Atualizar, não os dois.' }
foreach ($cmd in 'ssh', 'scp') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Falha "$cmd não encontrado. Ative o 'Cliente OpenSSH' em Configurações > Aplicativos > Recursos opcionais."
  }
}

Passo 'Conferindo o pacote'
$pacote = Get-ChildItem -Path $pasta -Filter 'everblue-monitoramento-*.tar.gz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $pacote) { Falha "Nenhum everblue-monitoramento-*.tar.gz em $pasta." }
$arquivoHash = "$($pacote.FullName).sha256"
if (-not (Test-Path $arquivoHash)) { Falha "Falta $($pacote.Name).sha256 ao lado do pacote." }
$esperado = ((Get-Content $arquivoHash -Raw).Trim() -split '\s+')[0].ToLower()
$real = (Get-FileHash -Algorithm SHA256 -Path $pacote.FullName).Hash.ToLower()
if ($esperado -ne $real) { Falha "Checksum NÃO confere para $($pacote.Name). Baixe/copie o pacote de novo." }
Ok "$($pacote.Name) íntegro ($([math]::Round($pacote.Length / 1KB)) KB)"

Passo 'Normalizando os roteiros para Linux (LF)'
$roteiros = 'instalar.sh', 'atualizar.sh', 'retornar.sh' | ForEach-Object { Join-Path $pasta $_ }
foreach ($r in $roteiros) {
  if (-not (Test-Path $r)) { Falha "Falta $(Split-Path -Leaf $r) nesta pasta." }
  $bytes = [System.IO.File]::ReadAllBytes($r)
  $texto = [System.Text.Encoding]::UTF8.GetString($bytes)
  $lf = $texto -replace "`r`n", "`n" -replace "`r", "`n"
  if ($lf -ne $texto) {
    [System.IO.File]::WriteAllBytes($r, [System.Text.UTF8Encoding]::new($false).GetBytes($lf))
    Ok "$(Split-Path -Leaf $r) convertido para LF"
  } else {
    Ok "$(Split-Path -Leaf $r) já em LF"
  }
}
# O .sha256 também vai para o Linux: garante LF nele.
$conteudoHash = (Get-Content $arquivoHash -Raw) -replace "`r`n", "`n"
[System.IO.File]::WriteAllBytes($arquivoHash, [System.Text.UTF8Encoding]::new($false).GetBytes($conteudoHash))

$alvo = "$Usuario@$Servidor"
Passo "Copiando para ${alvo}:$destino"
& ssh -p $Porta $alvo "mkdir -p $destino && chmod 700 $destino"
if ($LASTEXITCODE -ne 0) { Falha "Não foi possível conectar por SSH em $alvo (porta $Porta)." }
& scp -P $Porta $pacote.FullName $arquivoHash @roteiros "${alvo}:$destino/"
if ($LASTEXITCODE -ne 0) { Falha 'Falha na cópia (scp).' }
& ssh -p $Porta $alvo "cd $destino && chmod +x *.sh && sha256sum -c $($pacote.Name).sha256"
if ($LASTEXITCODE -ne 0) { Falha 'O pacote chegou diferente na VM (checksum). Rode de novo.' }
Ok 'pacote copiado e conferido na VM'

if ($Instalar -or $Atualizar) {
  $roteiro = if ($Instalar) { 'instalar.sh' } else { 'atualizar.sh' }
  Passo "Abrindo a sessão e rodando $roteiro (responda às perguntas na tela)"
  & ssh -t -p $Porta $alvo "cd $destino && bash $roteiro $($pacote.Name)"
  exit $LASTEXITCODE
}

Write-Host "`nPronto. Para instalar, entre na VM e rode:" -ForegroundColor Green
Write-Host "  ssh $alvo"
Write-Host "  cd $destino && bash instalar.sh"
