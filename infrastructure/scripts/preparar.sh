#!/usr/bin/env bash
# Prepara o servidor: cria o .env com segredos fortes gerados AQUI e os
# diretórios de dados. Idempotente — nunca sobrescreve um .env existente.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
source "$RAIZ/infrastructure/scripts/comum.sh"

# Com .env existente, o diretório de dados é o DELE — nunca outro padrão.
if [[ -f .env ]]; then carregar_env .env; fi
DADOS_DIR="${DADOS_DIR:-/opt/everblue-monitoramento/dados}"

command -v docker >/dev/null || erro "Docker não encontrado."
docker compose version >/dev/null 2>&1 || erro "Plugin docker compose não encontrado."
[[ -f .env.example ]] || erro "Arquivo .env.example não encontrado em $RAIZ."

segredo() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"${1:-40}"; }

if [[ -f .env ]]; then
  info ".env já existe — preservado. Nada foi alterado."
else
  command -v openssl >/dev/null || erro "openssl é necessário para gerar os segredos."
  info "Gerando segredos..."

  SENHA_PG_ADMIN="$(segredo 32)"
  SENHA_PG_APP="$(segredo 32)"
  SESSAO="$(openssl rand -hex 32)"
  COFRE="$(openssl rand -hex 32)"
  MINIO_ROOT="$(segredo 40)"
  MINIO_APP="$(segredo 40)"

  sed \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${SENHA_PG_ADMIN}|" \
    -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=${SENHA_PG_APP}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://emon_app:${SENHA_PG_APP}@db:5432/monitoramento|" \
    -e "s|^SESSAO_SEGREDO=.*|SESSAO_SEGREDO=${SESSAO}|" \
    -e "s|^COFRE_CHAVE=.*|COFRE_CHAVE=${COFRE}|" \
    -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=${MINIO_ROOT}|" \
    -e "s|^MINIO_SECRET_KEY=.*|MINIO_SECRET_KEY=${MINIO_APP}|" \
    -e "s|^DADOS_DIR=.*|DADOS_DIR=${DADOS_DIR}|" \
    .env.example > .env
  chmod 600 .env
  ok ".env criado com segredos únicos (permissão 600)."
fi

info "Criando diretórios de dados em ${DADOS_DIR}..."
sudo mkdir -p "${DADOS_DIR}"/{postgres,minio}
sudo chmod 750 "${DADOS_DIR}"
ok "diretórios prontos"

echo
echo "Próximos passos:"
echo "  1. Login corporativo: CONFIGURAR-LOGIN-ENTRA (ENTRA_*, grupos) e depois"
echo "     conectar_intranet.sh (chave HMAC da Intranet). Sem eles vale a conta de emergência."
echo "  2. Gere o certificado:  ./infrastructure/scripts/certificado.sh csr"
echo "  3. Suba:                ./infrastructure/scripts/implantar.sh"
echo "  4. Conta de emergência: ./infrastructure/scripts/conta_emergencia.sh"
