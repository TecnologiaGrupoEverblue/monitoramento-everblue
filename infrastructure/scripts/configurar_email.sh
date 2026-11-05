#!/usr/bin/env bash
# Configura o envio de e-mail do Mapa de Garantias pelo Microsoft 365 (Graph):
# App Registration com permissão de APLICAÇÃO Mail.Send (consentimento de
# administrador) e a caixa remetente escolhida.
# O segredo é digitado AQUI, na VM, sem eco: não passa por chat, e-mail ou Git.
# Se o teste falhar, o envio volta a ficar como estava (os dados digitados
# ficam guardados: rode de novo e tecle Enter para testar outra vez).
# Uso: sudo bash infrastructure/scripts/configurar_email.sh
# -e/pipefail: um comando que falha interrompe o roteiro (nada pela metade).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comum.sh"
cd "$RAIZ_PROJETO" || exit 1
[ -f .env ] || erro ".env não encontrado em $RAIZ_PROJETO"

guardar_copia_env() {  # cópia do .env: 600 e só as 3 mais recentes
  local copia=".env.bak-$(date +%Y%m%d%H%M%S)"
  cp -p .env "$copia" && chmod 600 "$copia"
  chmod 600 .env.bak-* 2>/dev/null || true
  { ls -1t .env.bak-* 2>/dev/null || true; } | tail -n +4 | xargs -r rm -f --
  printf '%s' "$copia"
}
atual() { { grep -E "^$1=" .env || true; } | head -1 | cut -d= -f2- ; }
gravar() { # CHAVE VALOR (o valor vai pelo ambiente: nada é interpretado)
  VAL="$2" awk -v k="$1" 'BEGIN{v=ENVIRON["VAL"]} $0 ~ "^"k"=" {print k"="v; f=1; next} {print} END{if(!f) print k"="v}' .env > .env.novo && cat .env.novo > .env && rm -f .env.novo
}
limpo() { printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
pergunta() { # CHAVE "rótulo" padrão
  local k="$1" rot="$2" pad="$3" cur v; cur="$(atual "$k")"; cur="${cur:-$pad}"
  printf '  %s [%s]: ' "$rot" "$cur"; IFS= read -r v || true; v="$(limpo "$v")"
  printf -v "NOVO_$k" '%s' "${v:-$cur}"
}
GUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
EMAIL='^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'

recriar_api() {
  docker compose up -d --no-deps --force-recreate api >/dev/null || return 1
  for _ in $(seq 1 45); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)" = healthy ] && return 0; sleep 2
  done
  return 1
}

echo
echo "=== E-mail do Mapa de Garantias — Microsoft 365 (Graph) ==="
echo "  Os dados vêm da App Registration de e-mail (Entra ID → Registros de aplicativo)."
pergunta EMAIL_REMETENTE       "Caixa remetente            " ""
pergunta EMAIL_REMETENTE_NOME  "Nome exibido               " "Monitoramento Everblue"
pergunta GRAPH_MAIL_TENANT_ID  "Directory (tenant) ID      " "$(atual ENTRA_TENANT_ID)"
pergunta GRAPH_MAIL_CLIENT_ID  "Application (client) ID    " "$(atual ENTRA_CLIENT_ID)"
# Mail.Send no PRÓPRIO app do login (Monitoramento Everblue): o segredo já está
# em ENTRA_CLIENT_SECRET; Enter usa as credenciais do login (GRAPH_MAIL_* vazios).
MESMO_APP_DO_LOGIN=n
if [ "$(printf '%s' "$NOVO_GRAPH_MAIL_CLIENT_ID" | tr 'A-Z' 'a-z')" = "$(atual ENTRA_CLIENT_ID | tr 'A-Z' 'a-z')" ] \
   && [ "$(printf '%s' "$NOVO_GRAPH_MAIL_TENANT_ID" | tr 'A-Z' 'a-z')" = "$(atual ENTRA_TENANT_ID | tr 'A-Z' 'a-z')" ] \
   && [ -n "$(atual ENTRA_CLIENT_SECRET)" ]; then MESMO_APP_DO_LOGIN=s; fi
SEGREDO_ATUAL="$(atual GRAPH_MAIL_CLIENT_SECRET)"
if [ "$MESMO_APP_DO_LOGIN" = s ]; then
  printf '  Valor do segredo do cliente (Enter usa o segredo do login, já configurado): '
else
  printf '  Valor do segredo do cliente %s: ' "$([ -n "$SEGREDO_ATUAL" ] && echo '(Enter mantém o atual)' || echo '(não aparece na tela)')"
fi
IFS= read -rs SEGREDO || true; echo
SEGREDO="$(limpo "${SEGREDO:-}")"
USAR_LOGIN=n
if [ -z "$SEGREDO" ] && [ "$MESMO_APP_DO_LOGIN" = s ]; then USAR_LOGIN=s; SEGREDO="(login)"; fi
SEGREDO="${SEGREDO:-$SEGREDO_ATUAL}"
ADMIN="$(atual ADMIN_EMAIL)"
printf '  Enviar o e-mail de teste para [%s]: ' "${ADMIN:-?}"; IFS= read -r PARA || true; PARA="$(limpo "$PARA")"; PARA="${PARA:-$ADMIN}"

NOVO_EMAIL_REMETENTE="$(printf '%s' "$NOVO_EMAIL_REMETENTE" | tr 'A-Z' 'a-z')"
[[ "$NOVO_EMAIL_REMETENTE" =~ $EMAIL ]] || erro "caixa remetente inválida; nada foi alterado."
[[ "$PARA" =~ $EMAIL ]]                 || erro "e-mail de teste inválido; nada foi alterado."
[[ "$NOVO_GRAPH_MAIL_TENANT_ID" =~ $GUID ]] || erro "tenant ID precisa ser um GUID; nada foi alterado."
[[ "$NOVO_GRAPH_MAIL_CLIENT_ID" =~ $GUID ]] || erro "client ID precisa ser um GUID (é o Application ID, não o ID do segredo); nada foi alterado."
[[ "$SEGREDO" =~ $GUID ]] && erro "isto parece o ID do segredo (GUID). Use a coluna 'Valor' do segredo; nada foi alterado."
[ -n "$SEGREDO" ] || erro "segredo vazio; nada foi alterado."

info "Conferindo a saída para o Microsoft 365"
docker compose exec -T api node dist/cli.js testar-rede-email || erro "a API não alcança o Microsoft 365 (firewall/proxy). Nada foi alterado."

TRANSPORTE_ANTERIOR="$(atual EMAIL_TRANSPORTE)"; TRANSPORTE_ANTERIOR="${TRANSPORTE_ANTERIOR:-desligado}"
COPIA="$(guardar_copia_env)"
gravar EMAIL_TRANSPORTE graph
gravar EMAIL_REMETENTE "$NOVO_EMAIL_REMETENTE"
gravar EMAIL_REMETENTE_NOME "$NOVO_EMAIL_REMETENTE_NOME"
if [ "$USAR_LOGIN" = s ]; then
  gravar GRAPH_MAIL_TENANT_ID ""; gravar GRAPH_MAIL_CLIENT_ID ""; gravar GRAPH_MAIL_CLIENT_SECRET ""
  ok "usando as credenciais do login (app $NOVO_GRAPH_MAIL_CLIENT_ID)"
else
  gravar GRAPH_MAIL_TENANT_ID "$NOVO_GRAPH_MAIL_TENANT_ID"
  gravar GRAPH_MAIL_CLIENT_ID "$NOVO_GRAPH_MAIL_CLIENT_ID"
  # `$` seria interpretado pelo Docker Compose: no .env ele vira `$$`.
  S="${SEGREDO//\$\$/\$}"
  gravar GRAPH_MAIL_CLIENT_SECRET "${S//\$/\$\$}"
fi
chmod 600 .env
unset SEGREDO S SEGREDO_ATUAL
ok ".env atualizado (cópia anterior: $COPIA)"

info "Recriando a API com a nova configuração"
if ! recriar_api; then
  aviso "a API não subiu com a nova configuração. Voltando o .env anterior."
  { docker compose logs --tail 15 api 2>/dev/null || true; } | { grep -iE 'erro|error|EMAIL|GRAPH' || true; } | tail -5
  cp -p "$COPIA" .env && recriar_api && ok "API de volta como estava." || aviso "confira: docker compose ps"
  exit 1
fi
ok "API no ar"

info "Enviando o e-mail de teste para $PARA"
if docker compose exec -T api node dist/cli.js testar-email "$PARA"; then
  ok "Envio funcionando. Confira a caixa de $PARA (e o lixo eletrônico)."
  ok "O Mapa de Garantias passa a ser enviado no horário configurado na tela."
else
  aviso "o envio falhou (a mensagem acima diz o motivo). O envio volta a '$TRANSPORTE_ANTERIOR'."
  aviso "Os dados digitados ficaram guardados: depois do ajuste no Entra/Exchange, rode de novo e tecle Enter."
  gravar EMAIL_TRANSPORTE "$TRANSPORTE_ANTERIOR"; chmod 600 .env
  recriar_api >/dev/null || aviso "confira: docker compose ps"
  exit 1
fi
