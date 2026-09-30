#!/usr/bin/env bash
# Instala Docker Engine + plugin Compose pelo repositório OFICIAL da Docker
# (Ubuntu 24.04). Use só se a VM ainda não tiver Docker — o
# verificar_requisitos.sh diz se é o caso. Idempotente: rodar de novo apenas
# confere e mantém.
#
# Também:
#   - rotação de logs no daemon (10 MB × 3), para o disco do sistema não encher;
#   - Docker habilitado no boot;
#   - usuário atual no grupo docker (vale a partir do próximo login).
#
# Proxy corporativo: se a VM sai para a internet por proxy, exporte HTTPS_PROXY
# antes de rodar; o script repassa o proxy ao serviço do Docker.
#
# Uso:  sudo -E ./infrastructure/scripts/instalar_docker.sh
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Execute com sudo: sudo -E $0"; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu ]] || { echo "Este roteiro é para Ubuntu (encontrado: $PRETTY_NAME)."; exit 1; }
USUARIO="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "Docker já instalado: $(docker --version) / $(docker compose version | head -1)"
else
  echo "==> Instalando Docker Engine pelo repositório oficial..."
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Rotação de logs padrão do daemon (o compose também define por serviço).
if [[ ! -f /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  echo "==> /etc/docker/daemon.json criado (rotação de logs, live-restore)"
  REINICIAR=1
else
  echo "==> /etc/docker/daemon.json já existe — mantido"
fi

# Proxy para o daemon (pull de imagens) quando a VM depende dele.
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
if [[ -n "$PROXY" ]]; then
  mkdir -p /etc/systemd/system/docker.service.d
  cat > /etc/systemd/system/docker.service.d/proxy.conf <<CONF
[Service]
Environment="HTTPS_PROXY=$PROXY"
Environment="HTTP_PROXY=${HTTP_PROXY:-${http_proxy:-$PROXY}}"
Environment="NO_PROXY=${NO_PROXY:-localhost,127.0.0.1}"
CONF
  echo "==> proxy do Docker configurado: $PROXY"
  REINICIAR=1
fi

systemctl daemon-reload
systemctl enable --now docker >/dev/null
[[ "${REINICIAR:-0}" == 1 ]] && systemctl restart docker

if [[ "$USUARIO" != root ]] && ! id -nG "$USUARIO" | grep -qw docker; then
  usermod -aG docker "$USUARIO"
  echo "==> $USUARIO adicionado ao grupo docker — SAIA e entre de novo na sessão SSH."
fi

docker run --rm hello-world >/dev/null 2>&1 && echo "==> Docker funcionando (hello-world ok)." \
  || echo "!! Docker instalado, mas não conseguiu baixar a imagem de teste: confira a saída para registry-1.docker.io (ou o proxy)."
echo "Pronto: $(docker --version) / $(docker compose version | head -1)"
