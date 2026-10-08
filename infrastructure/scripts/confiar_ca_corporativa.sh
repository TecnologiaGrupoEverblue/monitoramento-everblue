#!/usr/bin/env bash
# =============================================================================
# Monitoramento Everblue — confiar na "Everblue Corporate Root CA v1"
# =============================================================================
# A Intranet (https://intranet.grupoeverblue.com.br) passou a usar certificado
# emitido pela nova AC corporativa. Este roteiro faz o SERVIDOR e a IMAGEM da
# API confiarem nela — só o certificado PÚBLICO da AC, conferido pela
# impressão digital antes de qualquer uso:
#
#   1. encontra o certificado público (ordem abaixo) e confere o SHA-256;
#   2. converte de DER para PEM;
#   3. instala em /usr/local/share/ca-certificates/everblue-corporate-root-ca-v1.crt
#      (cópia anterior guardada para retorno) e roda update-ca-certificates;
#   4. deixa a mesma raiz em infrastructure/confianca/ — o build da imagem da
#      API a coloca no trust store da imagem (nada é feito à mão em contêiner);
#   5. confere que o certificado da Intranet é validado pelo bundle do sistema
#      e que  curl --fail --show-error https://<intranet>/api/health  responde.
#
# Idempotente: rodar de novo não muda nada se já estiver tudo certo.
# NÃO remove a raiz antiga "Everblue Intranet Root CA v2" (fica para retorno).
# NÃO usa -k/--insecure. NÃO toca em chave privada, certificado do nginx,
# aplicação, banco, MinIO, proxy ou DNS.
#
# Uso:  sudo bash confiar_ca_corporativa.sh [arquivo.cer|.pem]
#       sudo bash confiar_ca_corporativa.sh --verificar     (só confere)
#   CONFIAR_REDE=aviso  → falha de rede na conferência vira aviso (implantar.sh)
#
# Origem do certificado público, na ordem (a primeira que conferir vence):
#   arquivo informado → infrastructure/confianca/ (pacote) → trust store já
#   instalado → /var/lib/everblue-corporate-pki-v1-public/ neste servidor →
#   o mesmo caminho na VM da Intranet (scp, pede a senha dela).
#
# Retorno (só se for preciso):
#   sudo rm /usr/local/share/ca-certificates/everblue-corporate-root-ca-v1.crt
#   sudo update-ca-certificates --fresh
#   (ou restaure o .bak-* guardado ao lado, se houver)
# =============================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ_APP="$(cd "$AQUI/../.." && pwd)"

CA_NOME="Everblue Corporate Root CA v1"
CA_SHA256="27681A8063BEC545FA2E91B75A2C9BF888B2603B8F2A4997701BD14D2E59B7E9"
ARQ_SO="/usr/local/share/ca-certificates/everblue-corporate-root-ca-v1.crt"
BUNDLE_SO="/etc/ssl/certs/ca-certificates.crt"
ARQ_BUILD="$RAIZ_APP/infrastructure/confianca/everblue-corporate-root-ca-v1.pem"
ORIGEM_PUBLICA="/var/lib/everblue-corporate-pki-v1-public/Everblue-Corporate-Root-CA-v1.cer"
INTRANET_SSH="${INTRANET_SSH:-everblue@192.168.0.250}"
INTRANET_URL="${INTRANET_URL:-https://intranet.grupoeverblue.com.br}"
INTRANET_URL="${INTRANET_URL%/}"
HOSTPORTA="${INTRANET_URL#https://}"; HOSTPORTA="${HOSTPORTA%%/*}"; HOST="${HOSTPORTA%%:*}"
[[ "$HOSTPORTA" == *:* ]] || HOSTPORTA="$HOSTPORTA:443"
CONFIAR_REDE="${CONFIAR_REDE:-erro}"

info()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mok\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
erro()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }
falha_rede() { if [[ "$CONFIAR_REDE" == aviso ]]; then aviso "$*"; else erro "$*"; fi; }

SUDO=""; [[ $EUID -eq 0 ]] || SUDO="sudo"
command -v openssl >/dev/null || erro "openssl não encontrado neste servidor."

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Impressão digital SHA-256 (hex maiúsculo, sem ':') de um certificado DER ou PEM.
digital() {
  { openssl x509 -in "$1" -inform PEM -noout -fingerprint -sha256 2>/dev/null \
    || openssl x509 -in "$1" -inform DER -noout -fingerprint -sha256 2>/dev/null; } \
    | cut -d= -f2 | tr -d ':' | tr '[:lower:]' '[:upper:]'
}
para_pem() {
  openssl x509 -in "$1" -inform PEM -out "$2" 2>/dev/null \
    || openssl x509 -in "$1" -inform DER -out "$2" 2>/dev/null
}
# Certificado público da AC certa: digital confere, é AC e não há chave privada no arquivo.
confere() {
  local f="$1"
  [[ -s "$f" ]] || return 1
  if grep -aq "PRIVATE KEY" "$f" 2>/dev/null; then aviso "$f contém chave privada — ignorado (só certificado público entra)"; return 1; fi
  [[ "$(digital "$f")" == "$CA_SHA256" ]] || { aviso "$f não confere com a impressão digital da $CA_NOME — ignorado"; return 1; }
  para_pem "$f" "$TMP/ca.pem" || return 1
  openssl x509 -in "$TMP/ca.pem" -noout -text | grep -q "CA:TRUE" || { aviso "$f não é certificado de AC — ignorado"; return 1; }
  return 0
}

# ------------------------------------------------------------------ verificação
verificar() {
  info "Conferindo a confiança na $CA_NOME"
  [[ -f "$ARQ_SO" && "$(digital "$ARQ_SO")" == "$CA_SHA256" ]] || erro "$ARQ_SO ausente ou diferente da $CA_NOME."
  ok "instalada no sistema: $ARQ_SO"
  grep -qF "$(sed -n '2p' "$ARQ_SO")" "$BUNDLE_SO" || erro "A $CA_NOME não está no bundle $BUNDLE_SO (rode update-ca-certificates)."
  ok "presente no bundle $BUNDLE_SO"

  local saida codigo
  saida="$(echo | timeout 20 openssl s_client -connect "$HOSTPORTA" -servername "$HOST" -verify_hostname "$HOST" \
            -CAfile "$BUNDLE_SO" -verify_return_error 2>&1 || true)"
  if grep -q "Verify return code: 0 (ok)" <<<"$saida"; then
    ok "certificado de $HOST validado pelo bundle do sistema ($(grep -m1 -o 'i:.*' <<<"$saida" | sed 's/^i://'))"
  else
    falha_rede "O certificado de $HOST NÃO foi validado pelo bundle do sistema: $(grep -m1 -E 'Verify return code|verify error|connect:' <<<"$saida" || echo 'sem conexão')"
    return 0
  fi
  if codigo="$(curl --fail --show-error -sS -o /dev/null -w '%{http_code}' -m 20 "$INTRANET_URL/api/health" 2>&1)"; then
    ok "curl --fail --show-error $INTRANET_URL/api/health → HTTP $codigo"
  else
    falha_rede "curl --fail --show-error $INTRANET_URL/api/health falhou: $codigo"
  fi
}

if [[ "${1:-}" == --verificar ]]; then verificar; exit 0; fi

# ------------------------------------------------------------------ 1. origem
info "1/4 Certificado público da $CA_NOME"
ORIGEM=""
for c in "${1:-}" "$ARQ_BUILD" "$ARQ_SO" "$ORIGEM_PUBLICA"; do
  [[ -n "$c" && -f "$c" ]] || continue
  if confere "$c"; then ORIGEM="$c"; break; fi
done
if [[ -z "$ORIGEM" ]]; then
  USUARIO_SSH="${SUDO_USER:-$(id -un)}"
  echo "  Buscando $ORIGEM_PUBLICA em $INTRANET_SSH — digite a senha da VM da INTRANET quando pedir."
  mkdir -m 700 "$TMP/remoto"
  [[ $EUID -ne 0 ]] || { chown "$USUARIO_SSH" "$TMP/remoto"; chmod 711 "$TMP"; }
  if [[ $EUID -eq 0 && "$USUARIO_SSH" != root ]]; then
    sudo -u "$USUARIO_SSH" scp -q -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$INTRANET_SSH:$ORIGEM_PUBLICA" "$TMP/remoto/ca.cer" || true
  else
    scp -q -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$INTRANET_SSH:$ORIGEM_PUBLICA" "$TMP/remoto/ca.cer" || true
  fi
  confere "$TMP/remoto/ca.cer" && ORIGEM="$INTRANET_SSH:$ORIGEM_PUBLICA"
fi
[[ -n "$ORIGEM" ]] || erro "Não encontrei o certificado público da $CA_NOME com SHA-256 $CA_SHA256.
  Copie o .cer público para este servidor e rode:  sudo bash $0 /caminho/Everblue-Corporate-Root-CA-v1.cer
  Nada foi alterado."
ok "origem: $ORIGEM"
ok "SHA-256 confere: $CA_SHA256"
ok "convertido para PEM ($(openssl x509 -in "$TMP/ca.pem" -noout -subject | sed 's/^subject=//'), válido até $(openssl x509 -in "$TMP/ca.pem" -noout -enddate | cut -d= -f2))"

# ------------------------------------------------------------------ 2. sistema
info "2/4 Trust store do sistema operacional"
if [[ -f "$ARQ_SO" ]] && cmp -s "$ARQ_SO" "$TMP/ca.pem"; then
  ok "já instalada em $ARQ_SO — nada a alterar"
else
  if [[ -f "$ARQ_SO" ]]; then
    COPIA="$ARQ_SO.bak-$(date +%Y%m%d-%H%M%S)"
    $SUDO cp -p "$ARQ_SO" "$COPIA"
    # .bak não termina em .crt: o update-ca-certificates não o considera.
    ok "versão anterior guardada em $COPIA"
  fi
  $SUDO install -m 644 -o root -g root "$TMP/ca.pem" "$ARQ_SO"
  ok "instalada em $ARQ_SO"
fi
$SUDO update-ca-certificates >/dev/null
ok "update-ca-certificates executado (a raiz antiga v2 não foi removida)"

# ------------------------------------------------------------------ 3. imagem
info "3/4 Raiz para o build da imagem da API"
if [[ ! -d "$(dirname "$ARQ_BUILD")" ]]; then
  aviso "fora de uma instalação do Monitoramento — a imagem recebe a raiz no próximo implantar.sh"
elif [[ -f "$ARQ_BUILD" ]] && cmp -s "$ARQ_BUILD" "$TMP/ca.pem"; then
  ok "já em $ARQ_BUILD"
else
  install -m 644 "$TMP/ca.pem" "$ARQ_BUILD"
  ok "gravada em $ARQ_BUILD (entra no trust store da imagem no próximo build)"
fi

# ------------------------------------------------------------------ 4. conferência
info "4/4 Conferência"
verificar
echo
ok "Servidor confia na $CA_NOME."
