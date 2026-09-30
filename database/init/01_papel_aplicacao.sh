#!/bin/sh
# Executado UMA vez, só na criação do diretório de dados do PostgreSQL
# (docker-entrypoint-initdb.d). Separa o superusuário (POSTGRES_USER, só para
# administração) do papel da aplicação, que é dono do banco mas não é
# superusuário: uma injeção de SQL na API não vira controle do servidor.
set -eu

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER ausente}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD ausente}"

psql -v ON_ERROR_STOP=1 \
     -v app_user="$POSTGRES_APP_USER" \
     -v app_senha="$POSTGRES_APP_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_user', :'app_senha')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'app_user')
\gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user')
\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database())
\gexec
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
