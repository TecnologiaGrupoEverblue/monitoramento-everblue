#!/usr/bin/env bash
# LIMPEZA TOTAL do Monitoramento (ADR-018): apaga TUDO o que foi carregado até
# hoje — clientes, posições semanais, alertas, classificações, eventos,
# importações, fotos do Bitfin, comitês, atas, checklists, planos de ação,
# saídas de risco, jurídico, IASR, restritivos, Mapa de Garantias, auditoria
# e TODOS os arquivos do MinIO. Mantém só USUÁRIOS e perfis. Regras de alerta
# e de classificação e agendadores voltam ao padrão.
#
# IRREVERSÍVEL pelo sistema. Primeiro mostra o que será apagado (simulação);
# só apaga depois de digitar a frase exata. A API fica parada durante a
# limpeza (nenhuma foto roda no meio) e volta ao final.
# Uso: sudo bash infrastructure/scripts/zerar_dados.sh
# -e/pipefail: um comando que falha interrompe o roteiro (nada pela metade).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
cd "$RAIZ_PROJETO" || exit 1
[ -f .env ] || erro ".env não encontrado em $RAIZ_PROJETO"

cli() { docker compose run --rm --no-deps -T -e "ZERAR_CONFIRMACAO=${ZERAR_CONFIRMACAO:-}" -e "ZERAR_EXECUTADO_POR=${ZERAR_EXECUTADO_POR:-}" migracao node dist/cli.js "$@"; }
subir_api() {
  docker compose up -d --no-deps api >/dev/null || return 1
  for _ in $(seq 1 45); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)" = healthy ] && return 0; sleep 2
  done
  return 1
}

echo
echo "=== LIMPEZA TOTAL DO MONITORAMENTO ==="
info "Conferindo o que será apagado (simulação — nada é alterado)"
cli zerar-dados || erro "a simulação falhou (veja acima). Nada foi apagado."

echo
aviso "Tudo o que está listado acima será APAGADO DE FORMA DEFINITIVA, inclusive"
aviso "os arquivos do MinIO e a trilha de auditoria. Ficam só os usuários e perfis."
aviso "O sistema não tem como desfazer. Se precisar guardar algo, PARE agora."
printf '\n  Para continuar, digite exatamente  APAGAR TUDO  : '
IFS= read -r FRASE || true; FRASE="$(printf '%s' "$FRASE" | tr -d '\r')"
[ "$FRASE" = "APAGAR TUDO" ] || erro "frase diferente; nada foi apagado."

export ZERAR_CONFIRMACAO="$FRASE"
export ZERAR_EXECUTADO_POR="${SUDO_USER:-$(id -un)}@$(hostname)"

# Manifesto ANTES de apagar: contagens por tabela e cada objeto do MinIO
# (chaves geradas pelo sistema, sem dado pessoal). Sem manifesto, não apaga.
EVIDENCIAS="$(dirname "$RAIZ_PROJETO")/evidencias"
mkdir -p "$EVIDENCIAS"
MANIFESTO="$EVIDENCIAS/zerar-dados-$(date +%Y%m%d%H%M%S).manifesto"
info "Gravando o manifesto do que será apagado"
( umask 077; cli zerar-dados --manifesto > "$MANIFESTO" ) || erro "não foi possível gravar o manifesto ($MANIFESTO). Nada foi apagado."
[ -s "$MANIFESTO" ] || erro "manifesto vazio ($MANIFESTO). Nada foi apagado."
ok "manifesto: $MANIFESTO ($(wc -l < "$MANIFESTO") linhas)"

info "Parando a API (nenhuma foto ou envio roda durante a limpeza)"
docker compose stop api >/dev/null || erro "não foi possível parar a API. Nada foi apagado."
ok "API parada"

info "Apagando"
if cli zerar-dados --confirmar; then
  ok "limpeza concluída"
  RESULTADO=0
else
  aviso "a limpeza falhou (motivo acima). Se o erro foi no banco, NADA foi apagado; se foi no MinIO, o banco já está limpo e basta rodar de novo."
  RESULTADO=1
fi

info "Subindo a API"
if subir_api; then ok "API no ar"; else aviso "a API não ficou saudável: confira com  docker compose ps  e  docker compose logs --tail 50 api"; RESULTADO=1; fi

if [ "$RESULTADO" = 0 ]; then
  echo
  ok "Próximo passo: Monitoramento → Foto do Bitfin (a primeira foto SEM gravar a posição, para conferir)."
  ok "Reconfigure o agendador da foto e os clientes/cópias do Mapa de Garantias (voltaram ao padrão)."
fi
exit "$RESULTADO"
