# syntax=docker/dockerfile:1
# MinIO compilado a partir do CÓDIGO-FONTE OFICIAL (github.com/minio/minio).
#
# Por quê: desde outubro de 2025 a MinIO deixou de publicar imagens e binários
# da edição comunitária (o repositório minio/minio saiu do Docker Hub e o do
# quay.io exige login). O caminho indicado pela própria MinIO passou a ser
# compilar do fonte. Assim não dependemos de imagem de terceiros e a versão
# fica FIXADA por tag (MINIO_VERSAO / MC_VERSAO no .env).
#
# Uma imagem só leva os dois binários: `minio` (servidor) e `mc` (cliente,
# usado pelo minio-init para criar bucket, versionamento e usuário da app).
# Licença: AGPLv3 (uso interno, sem modificação do código).

ARG GO_IMAGEM=golang:1.24-bookworm
ARG BASE_IMAGEM=alpine:3.21

FROM ${GO_IMAGEM} AS build
ARG MINIO_VERSAO=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSAO=RELEASE.2025-08-13T08-35-41Z
# O go.mod do MinIO pede toolchain go1.24.8; `auto` baixa a versão exata.
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto GOFLAGS=-trimpath
WORKDIR /src

RUN git -c advice.detachedHead=false clone --depth 1 --branch "${MINIO_VERSAO}" https://github.com/minio/minio.git minio \
 && cd minio \
 && LDFLAGS="$(go run buildscripts/gen-ldflags.go)" \
 && go build -tags kqueue -ldflags "${LDFLAGS} -s -w" -o /out/minio . \
 && /out/minio --version

RUN git -c advice.detachedHead=false clone --depth 1 --branch "${MC_VERSAO}" https://github.com/minio/mc.git mc \
 && cd mc \
 && LDFLAGS="$(go run buildscripts/gen-ldflags.go)" \
 && go build -tags kqueue -ldflags "${LDFLAGS} -s -w" -o /out/mc . \
 && /out/mc --version

FROM ${BASE_IMAGEM}
# alpine já traz sh, wget (busybox) e os certificados raiz: nada a instalar.
COPY --from=build /out/minio /out/mc /usr/local/bin/
ENV MINIO_BROWSER=off
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data"]
