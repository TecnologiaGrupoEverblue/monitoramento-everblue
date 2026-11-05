#!/usr/bin/env bash
# Configura a conexão do Monitoramento com o Bitfin (SQL Server, SOMENTE
# LEITURA) no .env, recria a API e testa a leitura da foto sem gravar nada.
# A senha é digitada AQUI, na VM, sem eco: não passa por chat, e-mail ou Git.
# Uso: sudo bash infrastructure/scripts/configurar_bitfin.sh
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
pergunta() { # CHAVE "rótulo" padrão
  local k="$1" rot="$2" pad="$3" cur v; cur="$(atual "$k")"; cur="${cur:-$pad}"
  printf '  %s [%s]: ' "$rot" "$cur"; IFS= read -r v || true; v="$(printf '%s' "$v" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  printf -v "NOVO_$k" '%s' "${v:-$cur}"
}

echo
echo "=== Bitfin (SQL Server) — somente leitura ==="
pergunta BITFIN_SERVIDOR "Servidor" "192.168.0.180"
pergunta BITFIN_PORTA    "Porta   " "1433"
pergunta BITFIN_BANCO    "Banco   " "UNLTD_EVERBLUE"
pergunta BITFIN_USUARIO  "Usuário " "Everblue"
SENHA_ATUAL="$(atual BITFIN_SENHA)"
printf '  Senha do usuário %s %s: ' "$NOVO_BITFIN_USUARIO" "$([ -n "$SENHA_ATUAL" ] && echo '(Enter mantém a atual)' || echo '')"
IFS= read -rs SENHA || true; echo
SENHA="${SENHA:-$SENHA_ATUAL}"
[ -n "$SENHA" ] || erro "senha vazia; nada foi alterado."
[[ "$NOVO_BITFIN_PORTA" =~ ^[0-9]+$ ]] || erro "porta inválida."

info "Conferindo a rede até o Bitfin"
if timeout 5 bash -c "</dev/tcp/$NOVO_BITFIN_SERVIDOR/$NOVO_BITFIN_PORTA" 2>/dev/null; then ok "porta $NOVO_BITFIN_PORTA aberta em $NOVO_BITFIN_SERVIDOR"
else erro "sem acesso a $NOVO_BITFIN_SERVIDOR:$NOVO_BITFIN_PORTA a partir desta VM (firewall/rota). Nada foi alterado."; fi

COPIA="$(guardar_copia_env)"
gravar BITFIN_SERVIDOR "$NOVO_BITFIN_SERVIDOR"
gravar BITFIN_PORTA "$NOVO_BITFIN_PORTA"
gravar BITFIN_BANCO "$NOVO_BITFIN_BANCO"
gravar BITFIN_USUARIO "$NOVO_BITFIN_USUARIO"
# `$` seria interpretado pelo Docker Compose: no .env ele vira `$$`.
S="${SENHA//\$\$/\$}"
gravar BITFIN_SENHA "${S//\$/\$\$}"
[ -n "$(atual BITFIN_CONFIAR_CERTIFICADO)" ] || gravar BITFIN_CONFIAR_CERTIFICADO true
chmod 600 .env
unset SENHA S SENHA_ATUAL
ok ".env atualizado (cópia anterior: $COPIA)"

info "Recriando a API com a nova configuração"
docker compose up -d --no-deps --force-recreate api >/dev/null || erro "falha ao recriar a API. Retorno: cp $COPIA .env && docker compose up -d --no-deps --force-recreate api"
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)" = healthy ] && break; sleep 2
done
ok "API no ar"

info "Testando a leitura da foto (nada é gravado)"
if docker compose exec -T api node dist/cli.js testar-bitfin; then
  ok "Bitfin conectado. Tire a primeira foto em Monitoramento → Foto do Bitfin."
else
  aviso "a leitura falhou: confira usuário/senha e a permissão db_datareader. O .env anterior está em $COPIA."
  exit 1
fi
