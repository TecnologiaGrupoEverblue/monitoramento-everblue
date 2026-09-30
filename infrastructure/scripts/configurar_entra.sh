#!/usr/bin/env bash
# Configura o login corporativo (Entra ID) no .env e reimplanta. A ligação com
# a Intranet (chave HMAC) é feita por conectar_intranet.sh.
# Pergunta os valores NA VM (segredo sem eco); valida; guarda cópia do .env.
# Uso: sudo bash infrastructure/scripts/configurar_entra.sh
set -u
APP="${APP:-/opt/everblue-monitoramento/app}"
cd "$APP" || { echo "ERRO: $APP nao encontrado"; exit 1; }
[ -f .env ] || { echo "ERRO: .env nao encontrado"; exit 1; }
GUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
atual() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }
mascarar() { local v="$1"; [ -z "$v" ] && echo "(vazio)" || echo "${v:0:4}…(${#v} caracteres)"; }
perguntar() { # CHAVE "rótulo" validacao(guid|url|segredo|texto) opcional(s/n)
  local k="$1" rot="$2" tipo="$3" opc="${4:-n}" v cur; cur="$(atual "$k")"
  while :; do
    if [ "$tipo" = segredo ]; then
      printf '  %s [atual: %s] (Enter mantém): ' "$rot" "$(mascarar "$cur")"; IFS= read -rs v; echo
    else
      printf '  %s [atual: %s] (Enter mantém): ' "$rot" "${cur:-vazio}"; IFS= read -r v
    fi
    v="$(printf '%s' "$v" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$v" ] && v="$cur"
    if [ -z "$v" ]; then [ "$opc" = s ] && break; echo "    obrigatório."; continue; fi
    case "$tipo" in
      guid) [[ "$v" =~ $GUID ]] || { echo "    formato inválido (esperado GUID: 00000000-0000-0000-0000-000000000000)"; continue; } ;;
      url)  [[ "$v" =~ ^https://[^[:space:]]+$ ]] || { echo "    precisa começar com https://"; continue; }; v="${v%/}" ;;
      segredo) [[ "$v" =~ [[:space:]] ]] && { echo "    não pode ter espaço"; continue; } ;;
    esac
    break
  done
  printf -v "NOVO_$k" '%s' "$v"
}
gravar() { # CHAVE VALOR  (sem escapar nada: o valor vai pelo ambiente)
  VAL="$2" awk -v k="$1" 'BEGIN{v=ENVIRON["VAL"]} $0 ~ "^"k"=" {print k"="v; f=1; next} {print} END{if(!f) print k"="v}' .env > .env.novo && cat .env.novo > .env && rm -f .env.novo
}

echo
echo "=== Login corporativo: Entra ID ==="
echo "  App Registration 'Monitoramento Everblue' (Entra › App registrations › Overview)"
perguntar ENTRA_TENANT_ID     "Directory (tenant) ID      " guid
perguntar ENTRA_CLIENT_ID     "Application (client) ID    " guid
perguntar ENTRA_CLIENT_SECRET "Client secret (VALOR, não o ID)" segredo
echo "  Grupos do Entra → perfil (Object ID do grupo; Enter deixa sem grupo)"
MAPA_ATUAL="$(atual ENTRA_MAPA_PERFIL)"
[ -n "$MAPA_ATUAL" ] && echo "  mapa atual: $MAPA_ATUAL  (deixe tudo em branco para manter)"
MAPA=""
for p in admin gestor analista leitor; do
  while :; do
    printf '    Grupo %-8s: ' "$p"; IFS= read -r g; g="$(printf '%s' "$g" | tr -d '\r[:space:]')"
    [ -z "$g" ] && break
    [[ "$g" =~ $GUID ]] && { MAPA="${MAPA:+$MAPA;}$g=$p"; break; }
    echo "      formato inválido (GUID)"
  done
done
[ -z "$MAPA" ] && MAPA="$MAPA_ATUAL"

echo
echo "==> Conferindo"
FALHA=0
CODIGO=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://login.microsoftonline.com/$NOVO_ENTRA_TENANT_ID/v2.0/.well-known/openid-configuration")
[ "$CODIGO" = 200 ] && echo "  ok  tenant existe no Entra ID" || { echo "  FALHA tenant não encontrado ou sem saída para login.microsoftonline.com (HTTP $CODIGO)"; FALHA=1; }
SEG_INTRANET="$(atual DIRETORIO_INTEGRATION_SECRET)"
if [ -z "$(atual DIRETORIO_URL)" ] || [ ${#SEG_INTRANET} -lt 32 ]; then
  echo "  PENDENTE ligação com a Intranet — sem ela NINGUÉM entra pelo Entra."
  echo "           Rode depois o CONECTAR-INTRANET (chave HMAC). A conta de emergência continua funcionando."
else
  echo "  ok  ligação com a Intranet já configurada ($(atual DIRETORIO_URL))"
fi
[ -n "$MAPA" ] && echo "  ok  mapa de perfis: $MAPA" || echo "  atenção nenhum grupo mapeado: todos entram como '$(atual ENTRA_PERFIL_PADRAO)'"
URL_PUB="$(atual URL_PUBLICA)"
echo "  Redirect URI que precisa estar na App Registration (Web): $URL_PUB/oauth/oidc/callback"
if [ "$FALHA" = 1 ]; then
  printf '  Há falhas acima. Gravar mesmo assim? [s/N] '; read -r r; [[ "${r,,}" == s* ]] || { echo "Nada foi alterado."; exit 1; }
fi

cp -p .env ".env.bak-$(date +%Y%m%d%H%M%S)"
gravar ENTRA_TENANT_ID "$NOVO_ENTRA_TENANT_ID"
gravar ENTRA_CLIENT_ID "$NOVO_ENTRA_CLIENT_ID"
# `$` seria interpretado pelo Docker Compose: no .env ele vira `$$`.
SEG="${NOVO_ENTRA_CLIENT_SECRET//\$\$/\$}"   # idempotente: valor mantido já vinha escapado
gravar ENTRA_CLIENT_SECRET "${SEG//\$/\$\$}"
gravar ENTRA_MAPA_PERFIL "$MAPA"
chmod 600 .env
echo "  ok  .env atualizado (cópia anterior: $(ls -1t .env.bak-* | head -1))"

echo
echo "==> Aplicando (recria só o que mudou)"
BACKUP_CONFIRMADO=s ./infrastructure/scripts/implantar.sh
