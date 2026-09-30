#!/usr/bin/env bash
# =============================================================================
# Monitoramento Everblue — PRIMEIRA INSTALAÇÃO guiada na VM
# =============================================================================
# Fica ao lado do pacote (ex.: /tmp/everblue-monitoramento/):
#
#   everblue-monitoramento-X.Y.Z.tar.gz
#   everblue-monitoramento-X.Y.Z.tar.gz.sha256
#   instalar.sh   atualizar.sh   retornar.sh
#
# Uso:   bash instalar.sh [pacote.tar.gz]
#        sudo bash instalar.sh --automatico [pacote.tar.gz]
#
# --automatico  (usado pelo INSTALAR-MONITORAMENTO.cmd no Windows): nenhuma
#   pergunta. Decide pelo caminho seguro de cada etapa: instala o Docker se
#   faltar, segue com o .env gerado (login do Entra entra depois), gera o pedido
#   à AC e sobe com certificado autoassinado, cria a conta de emergência com
#   senha forte aleatória e a mostra UMA vez no final. Só para se houver um
#   impedimento real (ex.: disco de dados não montado).
#
# RETOMÁVEL: cada etapa confere se já foi feita. Se parar no meio (para editar
# o .env, instalar Docker e reentrar no SSH, esperar o certificado da AC...),
# basta rodar de novo — ele continua de onde parou.
#
# Nunca sobrescreve .env, certificado ou dados. Nunca apaga volume.
# Backup não é papel deste roteiro (processo corporativo).
# =============================================================================
set -Eeuo pipefail

AUTOMATICO=0
if [[ "${1:-}" == --automatico ]]; then AUTOMATICO=1; shift; fi

BASE="${BASE_INSTALACAO:-/opt/everblue-monitoramento}"
APP="$BASE/app"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mok\033[0m %s\n' "$*"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
erro()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }
pare()  { printf '\n\033[1;33m>>> PAUSA:\033[0m %s\n    Depois, rode de novo:  bash %s\n\n' "$1" "$AQUI/instalar.sh"; exit 0; }
pergunta() { # texto padrão(s|n) [resposta-no-modo-automático] → 0 se sim
  local r
  if (( AUTOMATICO )); then
    r="${3:-$2}"; printf '  %s → %s (automático)\n' "$1" "$( [[ $r == s ]] && echo sim || echo não )"
    [[ "$r" == s ]]; return
  fi
  if [[ ! -t 0 ]]; then [[ "$2" == s ]]; return; fi
  read -r -p "  $1 [$( [[ "$2" == s ]] && echo S/n || echo s/N )] " r
  r="${r:-$2}"; [[ "${r,,}" == s* ]]
}

printf '\033[1m\nMonitoramento Everblue — instalação no servidor %s\033[0m\n' "$(hostname)"

# ------------------------------------------------------------------ 1. pacote
if [[ -f "$APP/VERSAO" ]]; then
  if [[ -n "${1:-}" && -f "$1" ]]; then
    VERSAO_PACOTE="$(tar -xzOf "$1" --wildcards '*/VERSAO' 2>/dev/null | cut -d' ' -f1 || true)"
    VERSAO_INSTALADA="$(cut -d' ' -f1 "$APP/VERSAO")"
    if [[ -n "$VERSAO_PACOTE" && "$VERSAO_PACOTE" != "$VERSAO_INSTALADA" ]]; then
      # Instalação anterior que NUNCA chegou a subir (banco jamais inicializado):
      # não há dado a proteger — troca o código pela versão nova, preservando
      # .env e certificado. Com banco inicializado, só pelo atualizar.sh.
      DADOS_ATUAL="$(grep -E '^DADOS_DIR=' "$APP/.env" 2>/dev/null | cut -d= -f2- || true)"
      if [[ -f "${DADOS_ATUAL:-$BASE/dados}/postgres/PG_VERSION" ]]; then
        erro "Já está instalada (e em uso) a versão $VERSAO_INSTALADA; o pacote é $VERSAO_PACOTE. Para trocar de versão use: bash atualizar.sh $1"
      fi
      info "1/8 Instalação anterior ($VERSAO_INSTALADA) não chegou a subir — trocando pela versão $VERSAO_PACOTE"
      (cd "$(dirname "$1")" && sha256sum -c "$(basename "$1").sha256" >/dev/null) || erro "Checksum NÃO confere: o pacote chegou corrompido."
      CARIMBO="$(date +%Y%m%d-%H%M%S)"
      NOVA="$BASE/app.nova-$CARIMBO"
      sudo mkdir -p "$NOVA" "$BASE/releases" && sudo chmod 700 "$BASE/releases"
      sudo chown "$(id -u)":"$(id -g)" "$NOVA"
      tar -xzf "$1" -C "$NOVA" --strip-components=1
      for f in .env .env.revisado infrastructure/nginx/certs/emon.key infrastructure/nginx/certs/emon.crt infrastructure/nginx/certs/emon.csr infrastructure/nginx/certs/openssl.cnf; do
        [[ -f "$APP/$f" ]] && cp -p "$APP/$f" "$NOVA/$f"
      done
      # Variáveis que a versão nova traz e o .env ainda não tem.
      grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$NOVA/.env.example" | while IFS= read -r linha; do
        grep -q "^${linha%%=*}=" "$NOVA/.env" || echo "$linha" >> "$NOVA/.env"
      done
      sudo mv "$APP" "$BASE/releases/app-$VERSAO_INSTALADA-incompleta-$CARIMBO"
      sudo mv "$NOVA" "$APP"
      ok "versão $VERSAO_PACOTE no lugar (.env e certificado preservados)"
    fi
  fi
  info "1/8 Aplicação já extraída em $APP ($(cat "$APP/VERSAO")) — etapa pulada (retomando)"
else
  info "1/8 Conferindo e extraindo o pacote"
  PACOTE="${1:-$(ls -1t "$AQUI"/everblue-monitoramento-*.tar.gz 2>/dev/null | head -1 || true)}"
  [[ -f "$PACOTE" ]] || erro "Pacote não encontrado. Coloque everblue-monitoramento-X.Y.Z.tar.gz ao lado deste roteiro."
  [[ -f "$PACOTE.sha256" ]] || erro "Falta $PACOTE.sha256 — sem ele não há como provar que o pacote chegou íntegro."
  (cd "$(dirname "$PACOTE")" && sha256sum -c "$(basename "$PACOTE").sha256" >/dev/null) || erro "Checksum NÃO confere: o pacote chegou corrompido. Copie de novo."
  ok "checksum confere ($(basename "$PACOTE"))"

  if ! mountpoint -q "$BASE" 2>/dev/null; then
    aviso "$BASE não é um ponto de montagem: o disco de dados de 150 GB deveria estar montado aqui."
    pergunta "Continuar mesmo assim (dados irão para o disco do sistema)?" n || erro "Monte o disco de dados em $BASE (e no /etc/fstab) e rode de novo."
  fi
  [[ -e "$APP" && -n "$(ls -A "$APP" 2>/dev/null)" ]] && erro "$APP já tem conteúdo sem VERSAO. Confira manualmente antes de instalar por cima."

  sudo mkdir -p "$APP"
  sudo chown "$(id -u)":"$(id -g)" "$APP"
  tar -xzf "$PACOTE" -C "$APP" --strip-components=1
  ok "extraído em $APP ($(cat "$APP/VERSAO"))"
fi
cd "$APP"
# shellcheck source=/dev/null
source "$APP/infrastructure/scripts/comum.sh"

# ------------------------------------------------------------------ 2. docker
info "2/8 Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  aviso "Docker ou o plugin compose não estão instalados."
  pergunta "Instalar agora pelo repositório oficial da Docker?" s || erro "Instale o Docker e rode de novo."
  sudo -E "$APP/infrastructure/scripts/instalar_docker.sh"
fi
if ! docker info >/dev/null 2>&1; then
  systemctl is-active --quiet docker || { sudo systemctl start docker; sleep 2; }
  if ! docker info >/dev/null 2>&1; then
    if [[ $EUID -ne 0 ]] && ! id -nG | grep -qw docker; then
      getent group docker | grep -qw "$(id -un)" || sudo usermod -aG docker "$(id -un)"
      pare "seu usuário entrou no grupo docker. SAIA do SSH e entre de novo."
    fi
    erro "O serviço do Docker não responde: sudo systemctl status docker"
  fi
fi
ok "$(docker --version | cut -d, -f1) · $(docker compose version --short 2>/dev/null || docker compose version | head -1)"

# ------------------------------------------------------------------ 3. requisitos
info "3/8 Requisitos da VM"
if ! ./infrastructure/scripts/verificar_requisitos.sh; then
  aviso "Há itens FALTA acima."
  pergunta "Continuar mesmo assim?" n s || pare "resolva os itens FALTA."
fi

# ------------------------------------------------------------------ 4. .env
info "4/8 Configuração (.env)"
if [[ -f .env ]]; then
  ok ".env já existe — preservado"
else
  ./infrastructure/scripts/preparar.sh
fi
carregar_env .env
PENDENTES=()
for v in ENTRA_TENANT_ID ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET DIRETORIO_URL DIRETORIO_INTEGRATION_SECRET ENTRA_MAPA_PERFIL; do
  [[ -n "${!v:-}" ]] || PENDENTES+=("$v")
done
if (( ${#PENDENTES[@]} > 0 )); then
  aviso "Ainda vazios no .env (login corporativo): ${PENDENTES[*]}"
  aviso "Sem eles a aplicação sobe e funciona pela CONTA DE EMERGÊNCIA; o login do Entra entra depois."
  if [[ ! -f .env.revisado ]]; then
    if pergunta "Abrir o .env agora para preencher (nano)?" s n; then
      "${EDITOR:-nano}" .env
      carregar_env .env
    fi
    pergunta "Seguir a instalação com o .env como está?" s || pare "preencha o .env (nano $APP/.env)."
  fi
fi
touch .env.revisado
ok "MinIO: compilado do fonte oficial — ${MINIO_VERSAO:-RELEASE.2025-10-15T17-29-55Z} · mc ${MC_VERSAO:-RELEASE.2025-08-13T08-35-41Z}"

# ------------------------------------------------------------------ 5. certificado
info "5/8 Certificado TLS"
CERTS=infrastructure/nginx/certs
if [[ -s $CERTS/emon.crt && -s $CERTS/emon.key ]]; then
  ok "certificado presente — válido até $(openssl x509 -enddate -noout -in $CERTS/emon.crt | cut -d= -f2)"
elif [[ -s $CERTS/emon.csr ]]; then
  aviso "Pedido (CSR) já gerado e ainda sem certificado assinado."
  if pergunta "Subir AGORA com certificado autoassinado (troca depois pelo da AC)?" s; then
    IP_SERVIDOR="$(hostname -I | awk '{print $1}')" ./infrastructure/scripts/certificado.sh autoassinado
  else
    pare "grave o certificado da AC (com a cadeia) em $APP/$CERTS/emon.crt e rode ./infrastructure/scripts/certificado.sh conferir."
  fi
else
  echo "  a) Pedido para a AC interna (caminho normal) — e já subir com autoassinado enquanto ela responde"
  echo "  b) Só autoassinado, para testar"
  echo "  c) Só gerar o pedido e parar"
  escolha=a
  [[ -t 0 && $AUTOMATICO == 0 ]] && read -r -p "  Escolha [a/b/c] (a): " escolha
  case "${escolha:-a}" in
    a|A) ./infrastructure/scripts/certificado.sh csr
         IP_SERVIDOR="$(hostname -I | awk '{print $1}')" ./infrastructure/scripts/certificado.sh autoassinado ;;
    b|B) IP_SERVIDOR="$(hostname -I | awk '{print $1}')" ./infrastructure/scripts/certificado.sh autoassinado ;;
    *)   ./infrastructure/scripts/certificado.sh csr
         pare "envie $APP/$CERTS/emon.csr à AC interna; grave o certificado em $CERTS/emon.crt." ;;
  esac
  [[ -s $CERTS/emon.csr ]] && aviso "Envie SOMENTE $APP/$CERTS/emon.csr à AC. A chave (emon.key) nunca sai do servidor."
fi

# ------------------------------------------------------------------ 6. implantar
info "6/8 Build e subida (a primeira vez leva alguns minutos)"
# Primeira instalação: não há dado a proteger ainda.
BACKUP_CONFIRMADO=s ./infrastructure/scripts/implantar.sh

# ------------------------------------------------------------------ 7. emergência
info "7/8 Conta de emergência"
EXISTE="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM usuario WHERE senha_hash IS NOT NULL AND motivo_acesso_local IS NOT NULL AND ativo" </dev/null 2>/dev/null | tr -dc 0-9 || true)"
SENHA_EMERGENCIA=""
EMAIL_EMERGENCIA="${EMAIL_EMERGENCIA:-emergencia.monitoramento@grupoeverblue.com.br}"
if [[ "${EXISTE:-0}" -gt 0 ]]; then
  ok "já existe ${EXISTE} conta de emergência ativa"
elif (( AUTOMATICO )); then
  # Senha forte aleatória: 3 classes garantidas + 20 caracteres aleatórios.
  SENHA_EMERGENCIA="Em!$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | cut -c1-20)9z"
  export CONTA_EMERGENCIA_SENHA="$SENHA_EMERGENCIA"
  docker compose exec -T -e CONTA_EMERGENCIA_SENHA api node dist/cli.js conta-emergencia "$EMAIL_EMERGENCIA" "Conta de Emergência" </dev/null
  unset CONTA_EMERGENCIA_SENHA
  ok "conta de emergência criada: $EMAIL_EMERGENCIA"
elif [[ -t 0 ]]; then
  ./infrastructure/scripts/conta_emergencia.sh
else
  aviso "sem terminal interativo: rode depois ./infrastructure/scripts/conta_emergencia.sh"
fi

# ------------------------------------------------------------------ 8. verificação
info "8/8 Verificação final"
mkdir -p "$BASE/evidencias" 2>/dev/null || sudo mkdir -p "$BASE/evidencias"
EVIDENCIA="$BASE/evidencias/instalacao-$(date +%Y%m%d-%H%M%S).log"
if ./infrastructure/scripts/verificar.sh 2>&1 | sudo tee "$EVIDENCIA" >/dev/null; then
  ok "verificação sem falhas — evidência em $EVIDENCIA"
else
  aviso "verificação com falhas — veja $EVIDENCIA e: docker compose --env-file .env -f infrastructure/compose.yaml logs --tail=80"
fi
rm -f .env.revisado

cat <<FIM

$(printf '\033[1;32mInstalação concluída.\033[0m')

  Endereço:     ${URL_PUBLICA}
  Emergência:   ${URL_PUBLICA}/entrar/emergencia
  Aplicação:    $APP  ($(cat VERSAO))
  Dados:        ${DADOS_DIR}   ← incluir no backup CORPORATIVO

  Antes do DNS interno publicar o nome, aponte-o para $(hostname -I | awk '{print $1}')
  no arquivo hosts do seu computador (pelo IP o login é recusado de propósito).

  Próximas versões:  bash atualizar.sh everblue-monitoramento-X.Y.Z.tar.gz
FIM

if [[ -n "$SENHA_EMERGENCIA" ]]; then
  printf '\n\033[1;33m  ================ GUARDE AGORA NO COFRE DE SENHAS ================\033[0m\n'
  printf '    Conta de emergência:  %s\n' "$EMAIL_EMERGENCIA"
  printf '    Senha:                %s\n' "$SENHA_EMERGENCIA"
  printf '    Acesso:               %s/entrar/emergencia\n' "${URL_PUBLICA}"
  printf '\033[1;33m  Esta senha não será mostrada de novo e não fica gravada no servidor.\033[0m\n'
  printf '\033[1;33m  ================================================================\033[0m\n\n'
fi
