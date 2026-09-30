#!/usr/bin/env bash
# Confere se a VM está pronta para receber o Monitoramento. SÓ LÊ: não instala,
# não altera e não reinicia nada. Rode antes da primeira implantação e mande a
# saída para quem estiver acompanhando a instalação.
#
# Uso:  ./infrastructure/scripts/verificar_requisitos.sh
set -uo pipefail
exec </dev/null

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$RAIZ/infrastructure/scripts/comum.sh"
[[ -f "$RAIZ/.env" ]] && carregar_env "$RAIZ/.env" >/dev/null 2>&1

BASE_DADOS="${BASE_DADOS:-/opt/everblue-monitoramento}"
FALHAS=0
AVISOS=0
passa()  { printf '  \033[1;32mok   \033[0m %s\n' "$*"; }
falha()  { printf '  \033[1;31mFALTA\033[0m %s\n' "$*"; FALHAS=$((FALHAS + 1)); }
atencao(){ printf '  \033[1;33matenção\033[0m %s\n' "$*"; AVISOS=$((AVISOS + 1)); }

echo "== Sistema =="
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] && passa "Ubuntu ${VERSION_ID}" || atencao "SO ${PRETTY_NAME:-desconhecido} (homologado: Ubuntu 24.04)"
fi
CPUS="$(nproc)"
(( CPUS >= 4 )) && passa "${CPUS} vCPU" || atencao "${CPUS} vCPU (recomendado: 4)"
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
(( MEM_MB >= 7500 )) && passa "RAM ${MEM_MB} MB" || falha "RAM ${MEM_MB} MB (mínimo: 8 GB — os limites do compose somam ~5,4 GB)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
(( SWAP_MB >= 2000 )) && passa "swap ${SWAP_MB} MB" || atencao "swap ${SWAP_MB} MB (recomendado: 4 GB)"
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -qx yes; then passa "relógio sincronizado (NTP)"; else atencao "relógio sem NTP confirmado — o login do Entra recusa token com relógio fora"; fi
echo

echo "== Disco de dados =="
if mountpoint -q "$BASE_DADOS" 2>/dev/null; then
  TAM_GB="$(df -BG --output=size "$BASE_DADOS" | tail -1 | tr -dc 0-9)"
  LIVRE_GB="$(df -BG --output=avail "$BASE_DADOS" | tail -1 | tr -dc 0-9)"
  passa "$BASE_DADOS montado ($(findmnt -no SOURCE "$BASE_DADOS"), ${TAM_GB} GB, ${LIVRE_GB} GB livres)"
  (( TAM_GB >= 140 )) || atencao "disco de dados com ${TAM_GB} GB (planejado: 150 GB)"
  grep -q "[[:space:]]$BASE_DADOS[[:space:]]" /etc/fstab && passa "montagem persistente no /etc/fstab" || falha "$BASE_DADOS não está no /etc/fstab — some no próximo reboot"
else
  falha "$BASE_DADOS não é um ponto de montagem (o disco de 150 GB precisa estar montado aqui)"
fi
RAIZ_LIVRE_GB="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
(( RAIZ_LIVRE_GB >= 15 )) && passa "disco do sistema: ${RAIZ_LIVRE_GB} GB livres (imagens Docker ficam aqui)" || atencao "disco do sistema com só ${RAIZ_LIVRE_GB} GB livres"
echo

echo "== Docker =="
if command -v docker >/dev/null; then
  VERSAO_DOCKER="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  [[ -n "$VERSAO_DOCKER" ]] && passa "Docker Engine $VERSAO_DOCKER" || falha "Docker instalado, mas o serviço não responde (sudo systemctl start docker)"
  docker compose version >/dev/null 2>&1 && passa "$(docker compose version | head -1)" || falha "plugin docker compose ausente"
  if docker info >/dev/null 2>&1; then passa "usuário $(id -un) acessa o Docker"; else falha "usuário $(id -un) sem acesso ao Docker (sudo usermod -aG docker $(id -un) e entre de novo)"; fi
  systemctl is-enabled docker >/dev/null 2>&1 && passa "Docker inicia com o sistema" || atencao "Docker não habilitado no boot (sudo systemctl enable docker)"
else
  falha "Docker não instalado — rode ./infrastructure/scripts/instalar_docker.sh"
fi
for bin in openssl curl; do command -v "$bin" >/dev/null && passa "$bin presente" || falha "$bin ausente (sudo apt-get install -y $bin)"; done
echo

echo "== Portas locais =="
for porta in 80 443; do
  if ss -ltnH "( sport = :$porta )" 2>/dev/null | grep -q .; then
    dono="$(ss -ltnpH "( sport = :$porta )" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)"
    [[ "$dono" == docker-proxy ]] && passa "porta $porta já é do Docker (reimplantação)" || falha "porta $porta ocupada por ${dono:-outro processo}"
  else
    passa "porta $porta livre"
  fi
done
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  atencao "ufw ativo — confira se 443/80 estão liberados para a LAN/VPN (a regra de borda é do time de redes)"
fi
echo

echo "== Nome e rede =="
NOME="$(echo "${URL_PUBLICA:-https://monitoramento.grupoeverblue.com.br}" | sed -E 's#^https?://##; s#/.*##; s#:.*##')"
IP_NOME="$(getent hosts "$NOME" | awk '{print $1}' | head -1)"
if [[ -n "$IP_NOME" ]]; then
  if hostname -I | tr ' ' '\n' | grep -qx "$IP_NOME"; then passa "$NOME → $IP_NOME (esta VM)"; else atencao "$NOME → $IP_NOME, que NÃO é um IP desta VM ($(hostname -I | xargs))"; fi
else
  atencao "$NOME ainda não resolve no DNS interno (IPs desta VM: $(hostname -I | xargs))"
fi

# Saídas HTTPS. Qualquer resposta HTTP prova que a rede chega; 000 = bloqueado.
alcanca() { # nome url obrigatorio(sim|nao)
  local codigo
  codigo="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$2" 2>/dev/null || true)"
  if [[ "$codigo" != 000 && -n "$codigo" ]]; then passa "saída para $1"; elif [[ "$3" == sim ]]; then falha "sem saída para $1 ($2)"; else atencao "sem saída para $1 ($2)"; fi
}
alcanca "Docker Hub (build das imagens)" https://registry-1.docker.io/v2/ sim
alcanca "registro npm (build das imagens)" https://registry.npmjs.org/ sim
alcanca "Entra ID (login)" https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration sim
alcanca "Microsoft Graph (nome, cargo, foto)" https://graph.microsoft.com/v1.0/ nao
if [[ -n "${DIRETORIO_URL:-}" ]]; then alcanca "Intranet (autorização)" "$DIRETORIO_URL" sim; else atencao "DIRETORIO_URL ainda não preenchido — a saída para a Intranet não foi testada"; fi
[[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]] && atencao "proxy de saída em uso: ${HTTPS_PROXY:-$https_proxy} (o Docker precisa dele também: /etc/systemd/system/docker.service.d/proxy.conf)"
echo

echo "== Instalação =="
[[ -f "$RAIZ/.env" ]] && passa ".env presente ($(stat -c %a "$RAIZ/.env"))" || atencao ".env ainda não criado — próximo passo: ./infrastructure/scripts/preparar.sh"
[[ -s "$RAIZ/infrastructure/nginx/certs/emon.crt" && -s "$RAIZ/infrastructure/nginx/certs/emon.key" ]] && passa "certificado presente" || atencao "certificado ainda não gerado — ./infrastructure/scripts/certificado.sh csr (ou autoassinado)"
echo

if (( FALHAS == 0 )); then
  printf '\033[1;32mVM pronta para instalar\033[0m (%s ponto(s) de atenção).\n' "$AVISOS"
else
  printf '\033[1;31m%s item(ns) faltando\033[0m e %s ponto(s) de atenção. Resolva os itens FALTA antes do implantar.sh.\n' "$FALHAS" "$AVISOS"
  exit 1
fi
