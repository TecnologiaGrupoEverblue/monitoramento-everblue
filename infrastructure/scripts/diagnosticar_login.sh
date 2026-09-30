#!/usr/bin/env bash
# Diagnóstico do login corporativo — SÓ LÊ, não altera nada.
# Mostra versão, ligação com a Intranet (sem expor a chave), o teste da
# chamada assinada e o MOTIVO REAL das últimas recusas de login (auditoria).
# Uso: sudo bash infrastructure/scripts/diagnosticar_login.sh
set -uo pipefail
APP="${APP:-/opt/everblue-monitoramento/app}"
cd "$APP" || { echo "ERRO: $APP não encontrado"; exit 1; }
# shellcheck source=/dev/null
source infrastructure/scripts/comum.sh
carregar_env .env
SEG="${DIRETORIO_INTEGRATION_SECRET:-}"
echo
echo "== Versão instalada: $(cat VERSAO)"
echo "== Ligação com a Intranet"
echo "   DIRETORIO_URL       = ${DIRETORIO_URL:-(vazio)}"
echo "   DIRETORIO_CLIENT_ID = ${DIRETORIO_CLIENT_ID:-(vazio → usa ENTRA_CLIENT_ID ${ENTRA_CLIENT_ID:-vazio})}"
echo "   chave HMAC          = $([ ${#SEG} -ge 32 ] && echo "presente (${#SEG} caracteres)" || echo AUSENTE)"
echo "   Graph para perfil   = ${ENTRA_GRAPH_PERFIL:-true}   · foto: ${FOTO_FONTE:-graph}"
echo
echo "== Teste da chamada assinada (identidade de teste)"
docker compose exec -T api node dist/cli.js testar-intranet 2>&1 | sed 's/^/   /'
echo
echo "== Últimas tentativas de login pelo Entra (motivo real, da auditoria)"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c \
  "SELECT to_char(em AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI:SS') AS quando, resultado, left(coalesce(motivo,''),300) AS motivo
     FROM auditoria WHERE acao = 'login.entra' ORDER BY em DESC LIMIT 6" 2>&1 | sed 's/^/   /'
echo
echo "== Últimos erros da API"
docker compose logs --since 2h api 2>&1 | grep -i -E '"level":(40|50)|erro|error' | tail -8 | cut -c1-400 | sed 's/^/   /'
