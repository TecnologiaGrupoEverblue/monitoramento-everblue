#!/usr/bin/env bash
# Funções compartilhadas pelos scripts de operação.
# shellcheck disable=SC2034

# Raiz do projeto, a partir da localização DESTE arquivo: os roteiros são
# chamados de lugares diferentes (`./infrastructure/scripts/x.sh`, de dentro
# da pasta, por caminho absoluto), e calcular a raiz a partir do diretório
# corrente dava resultados diferentes conforme quem chamava.
RAIZ_PROJETO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# O compose vive em `infrastructure/`. `COMPOSE_FILE` é lido pelo próprio
# `docker compose`, então toda chamada dos roteiros continua valendo sem
# precisar do `-f` — e o caminho fica declarado num lugar só.
export COMPOSE_FILE="${COMPOSE_FILE:-$RAIZ_PROJETO/infrastructure/compose.yaml}"
# O compose procura o `.env` de interpolação na pasta do compose.yaml
# (infrastructure/), mas ele vive na RAIZ. Declarar aqui vale para toda chamada
# dos roteiros. À mão, use:  docker compose --env-file .env <comando>
export COMPOSE_ENV_FILES="${COMPOSE_ENV_FILES:-$RAIZ_PROJETO/.env}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
erro()  { printf '\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

# Lê o .env sem usar `source`.
#
# `source` executa o arquivo como script: um valor com espaço e sem aspas
# (ADMIN_NOME=Fulano de Tal) vira tentativa de executar um comando. Este
# leitor trata cada linha como dado, removendo aspas, comentários ao fim da
# linha e retorno de carro vindo de edição no Windows.
carregar_env() {
  local arquivo="${1:-.env}"
  [[ -f "$arquivo" ]] || erro "Arquivo $arquivo não encontrado. Execute ./infrastructure/scripts/preparar.sh primeiro."

  local linha chave valor
  while IFS= read -r linha || [[ -n "$linha" ]]; do
    linha="${linha%$'\r'}"
    [[ "$linha" =~ ^[[:space:]]*# ]] && continue
    [[ "$linha" =~ ^[[:space:]]*$ ]] && continue
    [[ "$linha" == *=* ]] || continue

    chave="${linha%%=*}"
    chave="${chave#"${chave%%[![:space:]]*}"}"
    chave="${chave%"${chave##*[![:space:]]}"}"
    [[ "$chave" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    valor="${linha#*=}"
    valor="${valor#"${valor%%[![:space:]]*}"}"

    if [[ "$valor" == \"*\" || "$valor" == \'*\' ]]; then
      valor="${valor:1:${#valor}-2}"                 # remove as aspas
    else
      valor="${valor%%[[:space:]]#*}"                # comentário ao fim da linha
      valor="${valor%"${valor##*[![:space:]]}"}"     # espaços à direita
    fi

    printf -v "$chave" '%s' "$valor"
    export "${chave?}"
  done < "$arquivo"
}
