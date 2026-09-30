#!/usr/bin/env bash
# Implantação segura: valida pré-requisitos, constrói as imagens, sobe e
# verifica saúde e rotas. Em falha, informa o procedimento de retorno.
#
# Nunca remove volumes. Nunca reseta banco. Nunca sobrescreve o .env.
# Backup NÃO é feito aqui (nem no MinIO): segue o processo corporativo.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
source "$RAIZ/infrastructure/scripts/comum.sh"

# ---------------------------------------------------------------- validações
carregar_env .env

if [[ -f .env.example ]]; then
  faltantes=()
  while IFS='=' read -r chave _; do
    [[ "$chave" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    grep -q "^${chave}=" .env || faltantes+=("$chave")
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example)
  if (( ${#faltantes[@]} > 0 )); then
    aviso "Estas variáveis existem no modelo e faltam no seu .env:"
    printf '       %s\n' "${faltantes[@]}"
    aviso "Acrescente-as ao .env — sem elas, o código usa o valor padrão."
    echo
  fi
fi

for obrigatoria in POSTGRES_PASSWORD POSTGRES_APP_PASSWORD DATABASE_URL SESSAO_SEGREDO COFRE_CHAVE \
                   MINIO_ROOT_PASSWORD MINIO_SECRET_KEY DADOS_DIR URL_PUBLICA; do
  valor="${!obrigatoria:-}"
  [[ -n "$valor" && "$valor" != TROQUE* ]] || erro "Variável ${obrigatoria} não configurada no .env."
done
[[ "${AMBIENTE:-}" != producao || "${COOKIE_SEGURO:-}" == true ]] || erro "Em produção COOKIE_SEGURO=true é obrigatório."
[[ "${MINIO_ACCESS_KEY:-}" != "${MINIO_ROOT_USER:-}" ]] || erro "MINIO_ACCESS_KEY não pode ser a credencial raiz do MinIO."

if [[ -z "${ENTRA_TENANT_ID:-}" || -z "${ENTRA_CLIENT_ID:-}" || -z "${ENTRA_CLIENT_SECRET:-}" ]]; then
  aviso "ENTRA_* incompleto: o login corporativo ficará indisponível (só a conta de emergência entra)."
fi
SEGREDO_INTRANET="${DIRETORIO_INTEGRATION_SECRET:-}"
if [[ -z "${DIRETORIO_URL:-}" || ${#SEGREDO_INTRANET} -lt 32 ]]; then
  aviso "DIRETORIO_URL/DIRETORIO_INTEGRATION_SECRET vazios: ninguém novo entra pelo Entra (autorização da Intranet desligada). Rode conectar_intranet.sh."
fi

# --------------------------------------------------------- backup corporativo
aviso "Confirme que o backup CORPORATIVO de ${DADOS_DIR} (postgres e minio) está em dia antes de atualizar."
if [[ "${BACKUP_CONFIRMADO:-}" == s ]]; then
  ok "backup corporativo confirmado por quem chamou (instalar.sh / atualizar.sh)"
elif [[ -t 0 ]]; then
  read -r -p "  Backup corporativo confirmado? [s/N] " resposta
  [[ "${resposta,,}" == "s" ]] || erro "Implantação interrompida: confirme o backup e rode de novo."
else
  aviso "Sem terminal interativo — prosseguindo (responsabilidade de quem chamou)."
fi

# --------------------------------------------------------- certificado TLS
CERT="$RAIZ/infrastructure/nginx/certs/emon.crt"
CHAVE="$RAIZ/infrastructure/nginx/certs/emon.key"
if [[ ! -s "$CERT" || ! -s "$CHAVE" ]]; then
  erro "Certificado TLS ausente em infrastructure/nginx/certs/ (emon.crt e emon.key).
  O Entra ID recusa endereço de retorno que não seja https. Gere o par NO SERVIDOR:

      ./infrastructure/scripts/certificado.sh csr            # AC interna assina (normal)
      ./infrastructure/scripts/certificado.sh autoassinado   # só para testar antes disso"
fi
if command -v openssl >/dev/null 2>&1; then
  openssl x509 -checkend 0 -noout -in "$CERT" >/dev/null 2>&1 || erro "O certificado emon.crt está VENCIDO. Renove antes de implantar."
  openssl x509 -checkend 2592000 -noout -in "$CERT" >/dev/null 2>&1 \
    || aviso "O certificado vence em menos de 30 dias ($(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2))."
  ok "certificado TLS presente e válido"
fi

# ---------------------------------------------------------------- compose
docker compose config -q || erro "compose.yaml inválido com o .env atual."
ok "compose válido"

# ---------------------------------------------------------------- build
info "Construindo imagens (na primeira vez inclui compilar o MinIO: alguns minutos)..."
docker compose build --pull
ok "imagens construídas"

# ---------------------------------------------------------------- nginx
# Erro de sintaxe no proxy só apareceria com o contêiner em ciclo de
# reinício. Validar com a própria imagem que vai subir custa segundos.
info "Validando a configuração do nginx..."
if ! docker run --rm --add-host api:127.0.0.1 \
      -v "$RAIZ/infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro" \
      -v "$RAIZ/infrastructure/nginx/incluir:/etc/nginx/incluir:ro" \
      -v "$RAIZ/infrastructure/nginx/certs:/etc/nginx/certs:ro" \
      everblue-monitoramento-web:local nginx -t 2>&1 | tail -3; then
  erro "Configuração do nginx inválida. Corrija antes de prosseguir."
fi
ok "configuração do nginx válida"

# ---------------------------------------------------------------- subida
info "Subindo serviços (migração roda antes da API)..."
docker compose up -d --remove-orphans
ok "serviços iniciados"

# O nginx lê a configuração uma vez; se só o CONTEÚDO mudou, o `up -d` não o
# recria. Recriar (e não recarregar) refaz os binds de diretório.
docker compose up -d --force-recreate nginx >/dev/null
ok "nginx recriado com a configuração atual"

# ---------------------------------------------------------------- saúde
info "Aguardando a aplicação ficar pronta..."
BASE="https://127.0.0.1:${PORTA_HTTPS:-443}"
PRONTO=0
for _ in $(seq 1 60); do
  if curl -kfsS -m 5 "${BASE}/api/health/ready" >/dev/null 2>&1; then PRONTO=1; break; fi
  sleep 3
done
if [[ "$PRONTO" -ne 1 ]]; then
  echo
  docker compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' || true
  erro "A aplicação não respondeu ao health check em 3 minutos.
  Diagnóstico:   docker compose logs --tail=80 migracao api db minio minio-init
  Retorno:       docker compose down          (SEM -v: os dados são preservados)
                 volte à versão anterior do código e execute novamente."
fi
ok "health check respondeu"

info "Conferindo rotas publicadas pelo proxy..."
MORTAS=()
conferir_rota() { # rota código-esperado
  local codigo=000
  for _ in $(seq 1 20); do
    codigo="$(curl -ks -o /dev/null -w '%{http_code}' -m 5 "${BASE}$1" 2>/dev/null || echo 000)"
    [[ "$codigo" == "$2" ]] && break
    sleep 3
  done
  if [[ "$codigo" == "$2" ]]; then ok "$1 → $codigo"; else printf '  \033[1;31mFALHA\033[0m %s devolveu %s (esperado %s)\n' "$1" "$codigo" "$2"; MORTAS+=("$1"); fi
}
conferir_rota /api/health/live 200
conferir_rota /login 200
conferir_rota /api/v1/autenticacao/modo 200
conferir_rota /api/v1/sessao 401
(( ${#MORTAS[@]} == 0 )) || erro "Serviços no ar, mas o proxy não publica: ${MORTAS[*]}.
  Diagnóstico: docker compose logs --tail=40 nginx api"

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
ok "Implantação concluída."
echo "  Acesse: ${URL_PUBLICA}"
echo "  Logs:   docker compose logs -f api"
