# syntax=docker/dockerfile:1
# Contexto de build: a RAIZ do repositório (ver infrastructure/compose.yaml).
# Multi-stage: o estágio final leva só o bundle, as dependências de produção
# e as migrações — sem código-fonte, sem ferramentas de build, sem testes.

ARG NODE_IMAGEM=node:22-bookworm-slim

# ------------------------------------------------------------------ build
FROM ${NODE_IMAGEM} AS build
WORKDIR /repo
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifestos primeiro: a camada do `npm ci` só é refeita quando mudam.
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/dominio/package.json backend/dominio/
COPY backend/api/package.json backend/api/
RUN npm ci -w @monitoramento/api -w @monitoramento/dominio --include-workspace-root

COPY backend/dominio backend/dominio
COPY backend/api backend/api
RUN npm run typecheck -w @monitoramento/api \
 && npm run build -w @monitoramento/api

# ------------------------------------------------------------ dependências
FROM ${NODE_IMAGEM} AS dependencias
WORKDIR /repo
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY backend/dominio/package.json backend/dominio/
COPY backend/api/package.json backend/api/
RUN npm ci --omit=dev -w @monitoramento/api \
 && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGEM} AS runtime
ENV NODE_ENV=production \
    MIGRACOES_DIR=/app/database/migrations \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --from=dependencias /repo/node_modules ./node_modules
COPY --from=build /repo/backend/api/dist ./dist
COPY backend/api/package.json ./package.json
COPY database/migrations ./database/migrations

# Raízes PÚBLICAS de confiança da Intranet (só certificados, nunca chave):
#   - Everblue Corporate Root CA v1 — AC atual do https da Intranet;
#   - Everblue Intranet Root CA v2  — anterior, mantida para retorno.
# Entram no trust store DA IMAGEM no build, conferidas pela impressão digital
# (arquivo trocado = build falha). O Node lê o bundle por NODE_EXTRA_CA_CERTS,
# que SOMA às raízes públicas — a verificação TLS continua ligada.
# A v1 chega a infrastructure/confianca/ pelo confiar_ca_corporativa.sh,
# chamado pelo implantar.sh antes do build.
ARG CA_CORPORATIVA_V1_SHA256=27681A8063BEC545FA2E91B75A2C9BF888B2603B8F2A4997701BD14D2E59B7E9
ARG CA_INTRANET_V2_SHA256=A63C3AFBDFBE1CDBE9CFC7FF320A8D36949B3568D908704310B45D5691E76350
COPY infrastructure/confianca/everblue-corporate-root-ca-v1.pem /usr/local/share/ca-certificates/everblue-corporate-root-ca-v1.crt
COPY infrastructure/confianca/intranet-raiz-v2.pem /usr/local/share/ca-certificates/everblue-intranet-root-ca-v2.crt

# busybox: só para o healthcheck (`busybox wget`), muito mais leve que subir um
# segundo processo Node a cada verificação.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends busybox ca-certificates openssl; \
    rm -rf /var/lib/apt/lists/*; \
    D=/usr/local/share/ca-certificates; \
    for par in "everblue-corporate-root-ca-v1.crt=$CA_CORPORATIVA_V1_SHA256" "everblue-intranet-root-ca-v2.crt=$CA_INTRANET_V2_SHA256"; do \
      arq="${par%%=*}"; esperado="${par#*=}"; \
      if grep -q "PRIVATE KEY" "$D/$arq"; then echo "ERRO: $arq contem chave privada"; exit 1; fi; \
      obtido="$(openssl x509 -in "$D/$arq" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')"; \
      if [ "$obtido" != "$esperado" ]; then echo "ERRO: $arq nao confere (SHA-256 $obtido, esperado $esperado)"; exit 1; fi; \
    done; \
    update-ca-certificates; \
    mkdir -p /etc/everblue/confianca; \
    cat "$D/everblue-corporate-root-ca-v1.crt" "$D/everblue-intranet-root-ca-v2.crt" > /etc/everblue/confianca/raizes-everblue.pem; \
    chmod 644 /etc/everblue/confianca/raizes-everblue.pem
ENV NODE_EXTRA_CA_CERTS=/etc/everblue/confianca/raizes-everblue.pem

# Usuário sem privilégio e sem shell de login. O sistema de arquivos do
# contêiner é somente leitura em produção (read_only no compose).
RUN groupadd -r -g 10001 emon \
 && useradd -r -u 10001 -g emon -d /app -s /usr/sbin/nologin emon \
 && chown -R root:root /app && chmod -R a-w /app
USER emon

EXPOSE 3000
CMD ["node", "dist/principal.js"]
