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
COPY packages/dominio/package.json packages/dominio/
COPY apps/api/package.json apps/api/
RUN npm ci -w @monitoramento/api -w @monitoramento/dominio --include-workspace-root

COPY packages/dominio packages/dominio
COPY apps/api apps/api
RUN npm run typecheck -w @monitoramento/api \
 && npm run build -w @monitoramento/api

# ------------------------------------------------------------ dependências
FROM ${NODE_IMAGEM} AS dependencias
WORKDIR /repo
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY packages/dominio/package.json packages/dominio/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev -w @monitoramento/api \
 && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGEM} AS runtime
ENV NODE_ENV=production \
    MIGRACOES_DIR=/app/database/migrations \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --from=dependencias /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./package.json
COPY database/migrations ./database/migrations

# Usuário sem privilégio e sem shell de login. O sistema de arquivos do
# contêiner é somente leitura em produção (read_only no compose).
RUN groupadd -r -g 10001 emon \
 && useradd -r -u 10001 -g emon -d /app -s /usr/sbin/nologin emon \
 && chown -R root:root /app && chmod -R a-w /app
USER emon

EXPOSE 3000
CMD ["node", "dist/principal.js"]
