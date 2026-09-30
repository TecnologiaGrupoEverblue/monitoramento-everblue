#!/usr/bin/env bash
# =============================================================================
# Liga a autorização do Monitoramento à Intranet — o MESMO modelo da IA Everblue
# =============================================================================
# O login pelo Entra prova QUEM é a pessoa. SE ela pode usar o Monitoramento é
# a Intranet que responde, em GET /api/access/v1/me, por chamada assinada
# (HMAC-SHA256) com uma chave EXCLUSIVA desta aplicação:
#
#   chave = base64url(HMAC-SHA256(ACCESS_API_MASTER_SECRET, "everblue-directory:v1:<client id>"))
#
# Este roteiro, rodado NA VM DO MONITORAMENTO (sudo):
#   1. lê o Application (client) ID do Monitoramento no .env;
#   2. confere se a VM alcança a Intranet (DNS, rede, TLS);
#   3. entra por SSH na VM da Intranet COM O SEU USUÁRIO (pede a senha dela),
#      deriva a chave lá mesmo e traz SÓ a chave derivada. O segredo mestre
#      não sai da Intranet, e nada na Intranet é alterado;
#   4. grava DIRETORIO_URL, DIRETORIO_CLIENT_ID e DIRETORIO_INTEGRATION_SECRET
#      no .env (cópia anterior preservada);
#   5. reimplanta e testa a chamada assinada (espera 403 SYSTEM_ACCESS_DENIED
#      para uma identidade de teste — prova de que a ASSINATURA foi aceita).
#
# Uso:  sudo bash infrastructure/scripts/conectar_intranet.sh [--sem-implantar | --testar]
#   --sem-implantar  só grava o .env (usado antes de uma atualização de versão)
#   --testar         só testa a chamada assinada com o que já está no .env
#
# Variáveis opcionais: INTRANET_SSH (everblue@192.168.0.250),
#   INTRANET_ENV (/home/everblue/current/infrastructure/.env.docker),
#   INTRANET_URL (https://intranet.grupoeverblue.com.br)
# =============================================================================
set -Eeuo pipefail

APP="${APP:-/opt/everblue-monitoramento/app}"
INTRANET_SSH="${INTRANET_SSH:-everblue@192.168.0.250}"
INTRANET_ENV="${INTRANET_ENV:-/home/everblue/current/infrastructure/.env.docker}"
INTRANET_URL="${INTRANET_URL:-https://intranet.grupoeverblue.com.br}"
INTRANET_URL="${INTRANET_URL%/}"
MODO="${1:-completo}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Raiz PÚBLICA da AC interna da Intranet (PKI Everblue v2). Conferida pela
# impressão digital antes de ser usada: arquivo trocado não vira confiança.
RAIZ_SHA256="A6:3C:3A:FB:DF:BE:1C:DB:E9:CF:C7:FF:32:0A:8D:36:94:9B:35:68:D9:08:70:43:10:B4:5D:56:91:E7:63:50"
RAIZ=""
for c in "$AQUI/intranet-raiz-v2.pem" "$AQUI/../confianca/intranet-raiz-v2.pem" "$APP/infrastructure/confianca/intranet-raiz-v2.pem"; do
  [[ -f "$c" ]] && { RAIZ="$c"; break; }
done

info()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mok\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
erro()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP" 2>/dev/null || erro "$APP não encontrado."
[[ -f .env ]] || erro ".env não encontrado em $APP."
atual() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'; }
gravar() { # CHAVE VALOR — o valor vai pelo ambiente, nunca pela linha de comando
  VAL="$2" awk -v k="$1" 'BEGIN{v=ENVIRON["VAL"]} index($0, k"=")==1 {if(!f) print k"="v; f=1; next} {print} END{if(!f) print k"="v}' .env > .env.novo \
    && cat .env.novo > .env && rm -f .env.novo
}
testar() {
  info "Testando a chamada assinada ao /me da Intranet"
  # shellcheck source=/dev/null
  source "$APP/infrastructure/scripts/comum.sh"
  docker compose exec -T api node dist/cli.js testar-intranet \
    || erro "A Intranet não aceitou a chamada do Monitoramento. Veja a mensagem acima."
}

if [[ "$MODO" == --testar ]]; then testar; exit 0; fi

# ------------------------------------------------------------------ 1
info "1/5 Identidade do Monitoramento"
CLIENT_ID="$(atual ENTRA_CLIENT_ID | tr '[:upper:]' '[:lower:]')"
[[ "$CLIENT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || erro "ENTRA_CLIENT_ID vazio ou inválido no .env. Rode antes o CONFIGURAR-LOGIN-ENTRA."
ok "Application (client) ID: $CLIENT_ID"

# ------------------------------------------------------------------ 2
info "2/5 A VM alcança a Intranet?"
HOST="${INTRANET_URL#https://}"; HOST="${HOST%%/*}"
getent hosts "$HOST" >/dev/null || erro "Esta VM não resolve $HOST. Peça à infraestrutura o DNS interno (o mesmo que a VM da IA usa) e rode de novo. Nada foi alterado."
[[ -n "$RAIZ" ]] || erro "Raiz da AC da Intranet (intranet-raiz-v2.pem) não encontrada no pacote. Nada foi alterado."
DIGITAL="$(openssl x509 -in "$RAIZ" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"
[[ "$DIGITAL" == "$RAIZ_SHA256" ]] || erro "A raiz $RAIZ não confere com a impressão digital esperada da PKI Everblue v2. Nada foi alterado."
ok "raiz da AC da Intranet conferida (Everblue Intranet Root CA v2)"
# TLS verificado de verdade: só com a raiz da companhia, nunca com -k.
CODIGO="$(curl -s -o /dev/null -m 15 --cacert "$RAIZ" -w '%{http_code}' "$INTRANET_URL/api/access/v1/me" || true)"
case "$CODIGO" in
  401|403|503) ok "$INTRANET_URL responde com certificado válido (HTTP $CODIGO sem assinatura, como esperado)";;
  000)
    if curl -sk -o /dev/null -m 15 "$INTRANET_URL/api/access/v1/me"; then
      EMISSOR="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
      erro "A Intranet apresentou um certificado que NÃO é da raiz Everblue v2 (emissor: ${EMISSOR:-desconhecido}). Nada foi alterado."
    fi
    erro "Esta VM não abre conexão com $INTRANET_URL (rede/firewall). Nada foi alterado.";;
  *) erro "A Intranet respondeu HTTP $CODIGO em /api/access/v1/me — confira INTRANET_URL. Nada foi alterado.";;
esac

# ------------------------------------------------------------------ 3
info "3/5 Chave exclusiva do Monitoramento (derivada NA Intranet)"
echo "  Conectando em $INTRANET_SSH — digite a senha da VM da INTRANET quando pedir."
REMOTO=$(cat <<EOS
set -eu
f='$INTRANET_ENV'
[ -r "\$f" ] || { echo 'erro=arquivo'; exit 0; }
m=\$(grep -m1 '^ACCESS_API_MASTER_SECRET=' "\$f" | cut -d= -f2- | tr -d '\r' || true)
[ \${#m} -ge 32 ] || { echo 'erro=mestre'; exit 0; }
printf 'derivada=%s\n' "\$(printf '%s' 'everblue-directory:v1:$CLIENT_ID' | openssl dgst -sha256 -hmac "\$m" -binary | base64 | tr '+/' '-_' | tr -d '=\n')"
printf 'relogio=%s\n' "\$(date +%s)"
EOS
)
B64="$(printf '%s' "$REMOTO" | base64 -w0)"
USUARIO_SSH="${SUDO_USER:-$(id -un)}"
SAIDA="$(sudo -u "$USUARIO_SSH" ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$INTRANET_SSH" "echo $B64 | base64 -d | bash" | tr -d '\r')" \
  || erro "Não foi possível entrar em $INTRANET_SSH (senha, usuário ou rede). Nada foi alterado."
case "$(grep -m1 '^erro=' <<<"$SAIDA" | cut -d= -f2)" in
  arquivo) erro "Não consegui ler $INTRANET_ENV na Intranet com o usuário ${INTRANET_SSH%@*}. Nada foi alterado.";;
  mestre)  erro "A Intranet ainda não tem ACCESS_API_MASTER_SECRET. Conclua antes a correção coordenada v20 da Intranet (Concluir-Configuracao.ps1). Nada foi alterado.";;
esac
DERIVADA="$(grep -m1 "^derivada=" <<<"$SAIDA" | cut -d= -f2- || true)"
RELOGIO="$(grep -m1 "^relogio=" <<<"$SAIDA" | cut -d= -f2- || true)"
unset SAIDA
[[ "$DERIVADA" =~ ^[A-Za-z0-9_-]{43}$ ]] || erro "A Intranet não devolveu uma chave derivada válida. Nada foi alterado."
ok "chave recebida (43 caracteres; não é exibida)"
if [[ "$RELOGIO" =~ ^[0-9]+$ ]]; then
  DIF=$(( $(date +%s) - RELOGIO )); DIF=${DIF#-}
  if (( DIF > 30 )); then aviso "relógios diferem em ${DIF}s (a Intranet recusa acima de 90s). Confira o NTP: timedatectl"; else ok "relógios alinhados (${DIF}s)"; fi
fi

# ------------------------------------------------------------------ 4
info "4/5 Gravando no .env"
COPIA=".env.bak-$(date +%Y%m%d%H%M%S)"
cp -p .env "$COPIA"
gravar DIRETORIO_URL "$INTRANET_URL"
gravar DIRETORIO_CLIENT_ID "$CLIENT_ID"
gravar DIRETORIO_INTEGRATION_SECRET "$DERIVADA"
unset DERIVADA
chmod 600 .env
ok ".env atualizado (cópia anterior: $COPIA)"

if [[ "$MODO" == --sem-implantar ]]; then
  ok "gravado; a implantação acontece na atualização de versão."
  exit 0
fi

# ------------------------------------------------------------------ 5
info "5/5 Aplicando"
BACKUP_CONFIRMADO=s ./infrastructure/scripts/implantar.sh
testar
printf '\n\033[1;32mMonitoramento ligado à Intranet.\033[0m\n'
echo "  Falta só, na Intranet › Configurações › Controle de Acessos:"
echo "    - o Monitoramento cadastrado e ATIVO com o Client ID $CLIENT_ID;"
echo "    - as PESSOAS liberadas para o Monitoramento."
