#!/usr/bin/env bash
# Verificação pós-implantação. Só lê estado — não produz efeito.
set -Eeuo pipefail
# `docker compose exec -T` encaminha a entrada padrão; sob `ssh ... bash -s`
# o primeiro exec consumiria o restante do roteiro.
exec </dev/null

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
source "$RAIZ/infrastructure/scripts/comum.sh"
carregar_env .env

BASE="https://127.0.0.1:${PORTA_HTTPS:-443}"
FALHAS=0
checar() {
  local descricao="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  \033[1;32mok  \033[0m%s\n' "$descricao"
  else printf '  \033[1;31mFALHA\033[0m %s\n' "$descricao"; FALHAS=$((FALHAS + 1)); fi
}
codigo() { curl -ks -o /dev/null -w '%{http_code}' -m 8 "$@"; }
BD() { docker compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 "$@"; }

echo "== Contêineres =="
docker compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo

echo "== Saúde e rotas =="
checar "liveness da API"                    curl -kfsS "${BASE}/api/health/live"
checar "readiness (banco e MinIO)"          curl -kfsS "${BASE}/api/health/ready"
checar "interface responde (/login)"        bash -c "[ \"\$(curl -ks -o /dev/null -w '%{http_code}' '${BASE}/login')\" = 200 ]"
checar "Central de Arquivos exige sessão"    bash -c "[ \"\$(curl -ks -o /dev/null -w '%{http_code}' '${BASE}/api/v1/arquivos')\" = 401 ]"
checar "rota protegida exige sessão (401)"  bash -c "[ \"\$(curl -ks -o /dev/null -w '%{http_code}' '${BASE}/api/v1/clientes')\" = 401 ]"
checar "porta 80 leva ao HTTPS (301)"       bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:${PORTA_HTTP:-80}/login')\" = 301 ]"
checar "CSP presente"                       bash -c "curl -ksI '${BASE}/login' | grep -qi '^content-security-policy'"
checar "HSTS presente"                      bash -c "curl -ksI '${BASE}/login' | grep -qi '^strict-transport-security'"
checar "POST de outra origem é recusado"    bash -c "[ \"\$(curl -ks -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://externo.exemplo' '${BASE}/api/v1/sessao/sair')\" = 403 ]"
echo

echo "== Banco =="
checar "conexão"                             BD -tAc 'SELECT 1'
checar "migrações aplicadas"                 bash -c "[ \"\$(docker compose exec -T db psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -tAc \"SELECT count(*) FROM migracao_aplicada WHERE nome IN ('0001_estrutura_inicial.sql','0002_ciclo_vida_arquivos.sql')\" | tr -d '[:space:]\r')\" = 2 ]"
checar "versões e trilha de arquivo imutáveis" bash -c "[ \"\$(docker compose exec -T db psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -tAc \"SELECT count(*) FROM pg_trigger WHERE tgname IN ('arquivo_versao_append_only','arquivo_evento_append_only')\" | tr -d '[:space:]\r')\" = 2 ]"
checar "aplicação NÃO é superusuária"        bash -c "[ \"\$(docker compose exec -T db psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -tAc \"SELECT rolsuper FROM pg_roles WHERE rolname='${POSTGRES_APP_USER}'\" | tr -d '[:space:]\r')\" = f ]"
checar "auditoria é imutável"                bash -c "[ \"\$(docker compose exec -T db psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -tAc \"SELECT count(*) FROM pg_trigger WHERE tgname IN ('auditoria_append_only')\" | tr -d '[:space:]\r')\" = 1 ]"
BD -c "SELECT 'usuarios' AS tabela, count(*) FROM usuario
       UNION ALL SELECT 'clientes', count(*) FROM cliente
       UNION ALL SELECT 'snapshots', count(*) FROM snapshot_semanal
       UNION ALL SELECT 'importacoes', count(*) FROM importacao
       UNION ALL SELECT 'arquivos (em uso)', count(*) FROM arquivo WHERE situacao IN ('ATIVO','ARQUIVADO')
       UNION ALL SELECT 'versões de arquivo', count(*) FROM arquivo_versao
       UNION ALL SELECT 'GB em arquivos (em uso)', round(coalesce(sum(tamanho_bytes),0)/1073741824.0, 2) FROM arquivo WHERE situacao IN ('ATIVO','ARQUIVADO')
       UNION ALL SELECT 'auditoria', count(*) FROM auditoria;" || true
echo

echo "== MinIO =="
checar "MinIO saudável" docker compose exec -T minio wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live
checar "minio-init concluiu sem erro" bash -c "[ \"\$(docker inspect -f '{{.State.ExitCode}}' emon-minio-init)\" = 0 ]"
echo

echo "== Disco de dados =="
df -h "${DADOS_DIR}" 2>/dev/null | tail -1 || echo "  (indisponível)"
echo

echo "== Uso de memória =="
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' $(docker compose ps -q 2>/dev/null) 2>/dev/null || echo "  (indisponível)"
echo

echo "== Certificado =="
openssl x509 -enddate -noout -in infrastructure/nginx/certs/emon.crt 2>/dev/null || echo "  (ausente)"
echo

echo "== Erros recentes da API (30 min) =="
docker compose logs --since 30m api 2>/dev/null | grep -E '"level":(50|60)' | tail -10 || echo "  nenhum"
echo

if [[ "$FALHAS" -eq 0 ]]; then printf '\033[1;32mVerificação concluída sem falhas.\033[0m\n'
else printf '\033[1;31mVerificação concluída com %s falha(s).\033[0m\n' "$FALHAS"; exit 1; fi
