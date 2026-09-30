#!/bin/sh
# Inicialização idempotente do MinIO (executada pelo serviço `minio-init`).
#
#   1. bucket da aplicação (com Object Lock só se MINIO_OBJECT_LOCK=true — o
#      Object Lock só pode ser ligado NA CRIAÇÃO do bucket);
#   2. versionamento ligado (arquivo sobrescrito continua recuperável);
#   3. bucket privado (sem acesso anônimo);
#   4. usuário da APLICAÇÃO com controle TOTAL do bucket dela (s3:* no bucket):
#      gravar, ler, listar, copiar, versionar, etiquetar, reter, excluir e
#      expurgar — o ciclo de vida inteiro de qualquer arquivo. O que ele não
#      tem é administração do servidor MinIO (usuários, políticas, outros
#      buckets): isso fica com a credencial raiz, só da operação.
#
# O MinIO é o repositório central de TODOS os arquivos do Monitoramento
# (importados, processados, exportados, anexos). NÃO é destino de backup.
set -eu

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${MINIO_BUCKET:?}" "${MINIO_ACCESS_KEY:?}" "${MINIO_SECRET_KEY:?}"

if [ "$MINIO_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "ERRO: MINIO_ACCESS_KEY não pode ser a credencial raiz do MinIO." >&2
  exit 1
fi

tentativas=0
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  tentativas=$((tentativas + 1))
  [ "$tentativas" -ge 30 ] && { echo "ERRO: MinIO não respondeu." >&2; exit 1; }
  sleep 2
done

if mc ls "local/$MINIO_BUCKET" >/dev/null 2>&1; then
  echo "bucket $MINIO_BUCKET já existe — mantido"
else
  case "$(echo "${MINIO_OBJECT_LOCK:-false}" | tr 'A-Z' 'a-z')" in
    1|true|sim|yes) mc mb --with-lock "local/$MINIO_BUCKET"; echo "bucket criado COM Object Lock" ;;
    *)              mc mb "local/$MINIO_BUCKET";             echo "bucket criado" ;;
  esac
fi

mc version enable "local/$MINIO_BUCKET"
mc anonymous set none "local/$MINIO_BUCKET" >/dev/null

sed "s/__BUCKET__/$MINIO_BUCKET/g" /config/politica-app.json > /tmp/politica-app.json
# `policy create` com nome existente ATUALIZA a política: idempotente.
mc admin policy create local emon-app /tmp/politica-app.json >/dev/null

# `user add` em usuário existente atualiza a senha: o .env é a fonte da verdade.
mc admin user add local "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc admin policy attach local emon-app --user "$MINIO_ACCESS_KEY" >/dev/null 2>&1 || true

echo "MinIO pronto: bucket $MINIO_BUCKET, versionamento $(mc version info "local/$MINIO_BUCKET" 2>/dev/null | awk '{print $NF}')"
