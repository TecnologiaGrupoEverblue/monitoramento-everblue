#!/usr/bin/env bash
# =============================================================================
# Monitoramento Everblue — RETORNO para uma versão anterior
# =============================================================================
# Uso:   bash retornar.sh                  # volta para a versão guardada mais recente
#        bash retornar.sh <pasta-em-releases>
#
# Troca a pasta da aplicação pela versão guardada em releases/ (feita pelo
# atualizar.sh) e implanta de novo. A versão que estava no ar também é guardada.
#
# BANCO E ARQUIVOS NÃO VOLTAM: migrações são só aditivas, e o código anterior
# ignora estruturas que ele não conhece. Se a versão nova tiver gravado dados
# num formato que a anterior não entende, a restauração de dados é pelo
# processo corporativo de backup — nunca por este roteiro.
# =============================================================================
set -Eeuo pipefail

BASE="${BASE_INSTALACAO:-/opt/everblue-monitoramento}"
APP="$BASE/app"
RELEASES="$BASE/releases"

ok()    { printf '  \033[1;32mok\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
erro()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }
pergunta() {
  local r
  if [[ ! -t 0 ]]; then [[ "$2" == s ]]; return; fi
  read -r -p "  $1 [$( [[ "$2" == s ]] && echo S/n || echo s/N )] " r
  r="${r:-$2}"; [[ "${r,,}" == s* ]]
}

ALVO="${1:-$(sudo ls -1dt "$RELEASES"/app-* 2>/dev/null | grep -v -- '-com-falha-' | head -1 || true)}"
[[ -n "$ALVO" ]] || erro "Nenhuma versão guardada em $RELEASES."
[[ "$ALVO" == /* ]] || ALVO="$RELEASES/$ALVO"
sudo test -f "$ALVO/VERSAO" -a -f "$ALVO/.env" || erro "$ALVO não parece uma versão guardada (falta VERSAO ou .env)."

ATUAL="$( [[ -f "$APP/VERSAO" ]] && cut -d' ' -f1 "$APP/VERSAO" || echo desconhecida)"
VOLTA="$(sudo cut -d' ' -f1 "$ALVO/VERSAO")"
echo
echo "  No ar agora:   $ATUAL"
echo "  Voltar para:   $VOLTA  ($ALVO)"
aviso "Banco e MinIO NÃO são revertidos (ver cabeçalho deste roteiro)."
[[ "${BACKUP_CONFIRMADO:-}" == s ]] || pergunta "Confirmar o retorno?" n || exit 0

CARIMBO="$(date +%Y%m%d-%H%M%S)"
if [[ -d "$APP" ]]; then
  sudo mv "$APP" "$RELEASES/app-$ATUAL-com-falha-$CARIMBO"
  ok "versão $ATUAL guardada em $RELEASES/app-$ATUAL-com-falha-$CARIMBO"
fi
sudo mv "$ALVO" "$APP"
sudo chown -R "$(id -u)":"$(id -g)" "$APP"
ok "versão $VOLTA de volta em $APP"

cd "$APP"
BACKUP_CONFIRMADO=s ./infrastructure/scripts/implantar.sh \
  || erro "A versão $VOLTA também não subiu. Diagnóstico: docker compose --env-file .env -f infrastructure/compose.yaml logs --tail=80"
./infrastructure/scripts/verificar.sh || aviso "verificação com falhas — veja a saída acima."
printf '\n\033[1;32mRetorno concluído: no ar a versão %s.\033[0m\n' "$VOLTA"
