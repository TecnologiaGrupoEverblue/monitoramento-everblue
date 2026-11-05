#!/usr/bin/env bash
# Retenção das fotos do Bitfin (ADR-021) — SOMENTE CONSULTA, nada é alterado.
# Mostra quantas fotos são permanentes (posição do comitê ou Mapa enviado),
# quantas são de teste e quando cada uma expira, e os últimos expurgos.
# Uso: cd /opt/everblue-monitoramento/app && sudo bash infrastructure/scripts/retencao_fotos.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
cd "$RAIZ_PROJETO" || exit 1
carregar_env .env
DIAS="${RETENCAO_FOTO_TESTE_DIAS:-90}"
BD() { docker compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 "$@"; }

echo
echo "=== Retenção das fotos do Bitfin (teste: ${DIAS} dias) ==="
BD -c "SELECT CASE WHEN foto_permanente(id) THEN 'permanente' ELSE 'teste' END AS tipo,
              count(*) AS fotos,
              to_char(min(iniciado_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS mais_antiga,
              to_char(max(iniciado_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS mais_recente
         FROM foto_execucao GROUP BY 1 ORDER BY 1"
echo "Próximas fotos de teste a expirar:"
BD -c "SELECT to_char(iniciado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS tirada_em,
              status, posicao_semanal,
              to_char((iniciado_em + make_interval(days => ${DIAS})) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS expira_em
         FROM foto_execucao WHERE NOT foto_permanente(id) ORDER BY iniciado_em LIMIT 10"
echo "Últimos expurgos:"
BD -c "SELECT to_char(em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS em, resultado,
              detalhes->>'fotos' AS fotos, detalhes->>'arquivos' AS arquivos, detalhes->>'falhas' AS falhas
         FROM auditoria WHERE acao = 'foto.expurgo' ORDER BY em DESC LIMIT 10"
ok "Consulta concluída (nada foi alterado)."
