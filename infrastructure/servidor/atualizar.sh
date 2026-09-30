#!/usr/bin/env bash
# =============================================================================
# Monitoramento Everblue — ATUALIZAÇÃO para uma nova versão
# =============================================================================
# Uso:   bash atualizar.sh everblue-monitoramento-X.Y.Z.tar.gz
#
# Troca de pasta, não sobrescrita:
#   1. confere o checksum e o backup corporativo;
#   2. extrai a versão nova em uma pasta ao lado;
#   3. leva para ela o .env e o certificado da instalação atual;
#   4. guarda a versão atual em  releases/  (é o caminho de volta);
#   5. põe a nova no lugar, implanta e verifica.
# Se a implantação falhar, oferece voltar na hora (retornar.sh).
#
# Dados (PostgreSQL e MinIO) ficam em DADOS_DIR e não são tocados.
# Nunca `down -v`. Nunca apaga volume.
# =============================================================================
set -Eeuo pipefail

BASE="${BASE_INSTALACAO:-/opt/everblue-monitoramento}"
APP="$BASE/app"
RELEASES="$BASE/releases"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mok\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
erro()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }
pergunta() {
  local r
  if [[ ! -t 0 ]]; then [[ "$2" == s ]]; return; fi
  read -r -p "  $1 [$( [[ "$2" == s ]] && echo S/n || echo s/N )] " r
  r="${r:-$2}"; [[ "${r,,}" == s* ]]
}

PACOTE="${1:-$(ls -1t "$AQUI"/everblue-monitoramento-*.tar.gz 2>/dev/null | head -1 || true)}"
[[ -f "$PACOTE" ]] || erro "Informe o pacote: bash atualizar.sh everblue-monitoramento-X.Y.Z.tar.gz"
PACOTE="$(cd "$(dirname "$PACOTE")" && pwd)/$(basename "$PACOTE")"
[[ -f "$APP/.env" && -f "$APP/VERSAO" ]] || erro "Não há instalação em $APP. Para a primeira vez use instalar.sh."

info "1/5 Conferências"
[[ -f "$PACOTE.sha256" ]] || erro "Falta $PACOTE.sha256."
(cd "$(dirname "$PACOTE")" && sha256sum -c "$(basename "$PACOTE").sha256" >/dev/null) || erro "Checksum NÃO confere. Copie o pacote de novo."
ok "checksum confere"
ATUAL="$(cut -d' ' -f1 "$APP/VERSAO")"
NOVA="$(tar -xzOf "$PACOTE" --wildcards '*/VERSAO' | cut -d' ' -f1)"
ok "versão instalada: $ATUAL  →  nova: $NOVA"
[[ "$ATUAL" != "$NOVA" ]] || pergunta "É a MESMA versão. Reinstalar mesmo assim?" n || exit 0

if [[ "${BACKUP_CONFIRMADO:-}" != s ]]; then
  aviso "Antes de atualizar, o backup CORPORATIVO de $BASE/dados (postgres e minio) precisa estar em dia."
  pergunta "Backup corporativo confirmado?" n || erro "Atualização interrompida: confirme o backup e rode de novo."
fi

info "2/5 Preparando a versão nova ao lado da atual"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
DESTINO_NOVA="$BASE/app.nova-$CARIMBO"
sudo mkdir -p "$DESTINO_NOVA" "$RELEASES"
sudo chown "$(id -u)":"$(id -g)" "$DESTINO_NOVA"
sudo chmod 700 "$RELEASES"          # releases guardam .env e chave: só o dono
tar -xzf "$PACOTE" -C "$DESTINO_NOVA" --strip-components=1

# O que é DESTA instalação e não vem no pacote: configuração e certificado.
cp -p "$APP/.env" "$DESTINO_NOVA/.env"
for f in emon.key emon.crt emon.csr openssl.cnf; do
  [[ -f "$APP/infrastructure/nginx/certs/$f" ]] && cp -p "$APP/infrastructure/nginx/certs/$f" "$DESTINO_NOVA/infrastructure/nginx/certs/$f"
done
ok "versão $NOVA pronta em $DESTINO_NOVA (com .env e certificado da instalação)"

# Variáveis novas do modelo que o .env atual ainda não tem.
FALTANDO="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$DESTINO_NOVA/.env.example" | cut -d= -f1 | while read -r k; do grep -q "^$k=" "$DESTINO_NOVA/.env" || echo "$k"; done | xargs)"
if [[ -n "$FALTANDO" ]]; then
  aviso "A versão nova tem variáveis que o seu .env não tem: $FALTANDO"
  aviso "Sem elas vale o padrão do código. Para ajustar: nano $DESTINO_NOVA/.env (antes de continuar)."
  pergunta "Continuar com os padrões?" s || { echo "  A versão nova ficou em $DESTINO_NOVA; nada foi trocado."; exit 0; }
fi

# Roteiro de retorno: o que veio junto com este (sempre presente), senão o do pacote.
RETORNAR="$AQUI/retornar.sh"
[[ -f "$RETORNAR" ]] || RETORNAR="$BASE/app/infrastructure/servidor/retornar.sh"

info "3/5 Trocando a versão"
GUARDADA="$RELEASES/app-$ATUAL-$CARIMBO"
sudo mv "$APP" "$GUARDADA"
sudo mv "$DESTINO_NOVA" "$APP"
ok "versão anterior guardada em $GUARDADA"

info "4/5 Implantando $NOVA"
cd "$APP"
if ! BACKUP_CONFIRMADO=s ./infrastructure/scripts/implantar.sh; then
  aviso "A implantação da versão $NOVA falhou."
  if pergunta "Voltar AGORA para a versão $ATUAL?" s; then
    BACKUP_CONFIRMADO=s bash "$RETORNAR" "$GUARDADA" || erro "O retorno automático falhou. Veja a saída acima; a versão $ATUAL está em $GUARDADA."
    exit 1
  fi
  erro "Versão $NOVA ficou no lugar, com falha. Para voltar depois: bash $RETORNAR"
fi

info "5/5 Verificação"
sudo mkdir -p "$BASE/evidencias"
EVIDENCIA="$BASE/evidencias/atualizacao-$NOVA-$CARIMBO.log"
if ./infrastructure/scripts/verificar.sh 2>&1 | sudo tee "$EVIDENCIA" >/dev/null; then
  ok "verificação sem falhas — evidência em $EVIDENCIA"
else
  aviso "verificação com falhas — veja $EVIDENCIA. Voltar: bash $RETORNAR"
fi

printf '\n\033[1;32mAtualizado: %s → %s.\033[0m\n' "$ATUAL" "$NOVA"
echo "  Versões guardadas (caminho de volta):"
sudo bash -c "ls -1dt '$RELEASES'/app-* 2>/dev/null | xargs -r du -sh" | sed 's/^/    /' || true
echo "  Para liberar espaço, remova as mais antigas manualmente (elas contêm cópia do .env)."
