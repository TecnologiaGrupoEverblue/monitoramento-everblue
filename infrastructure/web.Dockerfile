# syntax=docker/dockerfile:1
# Contexto de build: a RAIZ do repositório. O front é compilado aqui e o
# resultado estático vai para dentro da imagem do nginx — o servidor não
# precisa de Node para servir a interface.

ARG NODE_IMAGEM=node:22-bookworm-slim
ARG NGINX_IMAGEM=nginx:1.27-alpine

FROM ${NODE_IMAGEM} AS build
WORKDIR /repo
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/dominio/package.json backend/dominio/
COPY frontend/package.json frontend/
RUN npm ci -w @monitoramento/web -w @monitoramento/dominio --include-workspace-root

COPY backend/dominio backend/dominio
COPY frontend frontend
RUN npm run typecheck -w @monitoramento/web \
 && npm run build -w @monitoramento/web

FROM ${NGINX_IMAGEM} AS runtime
# A configuração (conf.d, incluir, certs) é montada pelo compose como
# DIRETÓRIO; a imagem leva só o conteúdo estático.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
