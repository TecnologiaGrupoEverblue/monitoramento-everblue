#!/usr/bin/env bash
# Cria ou redefine a CONTA DE EMERGÊNCIA do Monitoramento (mesmo modelo da IA).
#
# A tela de login tem uma porta só: o Microsoft Entra ID. O acesso por senha
# existe em `/entrar/emergencia`, sem link a partir de lugar nenhum — é a saída
# para quando o tenant ou a Intranet estiverem fora do ar. Todo uso fica na
# auditoria com resultado 'excecao'.
#
# A senha NUNCA aparece na tela, no histórico do shell nem na linha de comando
# de processo algum: é lida com eco desligado e entregue ao contêiner por
# variável de ambiente herdada (`-e NOME` sem valor).
#
# Uso:  ./infrastructure/scripts/conta_emergencia.sh
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
source "$RAIZ/infrastructure/scripts/comum.sh"
carregar_env .env

[[ -t 0 ]] || erro "Execute em terminal interativo (a senha é digitada)."
docker compose ps --status running --services 2>/dev/null | grep -qx api || erro "A API não está em execução. Rode o implantar.sh antes."

echo
echo "=== Conta de emergência do Monitoramento Everblue ==="
echo
echo "Contas que hoje podem entrar por senha:"
docker compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
  "SELECT '  ' || email || '  (' || perfil || ', ' || CASE WHEN ativo THEN 'ativa' ELSE 'INATIVA' END || ')'
     FROM usuario WHERE senha_hash IS NOT NULL AND motivo_acesso_local IS NOT NULL" </dev/null || true
echo

read -r -p "E-mail da conta de emergência: " EMAIL
EMAIL="$(echo "$EMAIL" | tr -d '\r' | xargs)"
[[ "$EMAIL" == *@*.* ]] || erro "E-mail inválido."
read -r -p "Nome para exibição: " NOME
NOME="$(echo "$NOME" | tr -d '\r' | xargs)"
[[ -n "$NOME" ]] || erro "Nome obrigatório."

echo "A senha precisa de ao menos 12 caracteres, combinando três entre maiúscula, minúscula, número e símbolo."
read -r -s -p "Senha: " SENHA1; echo
read -r -s -p "Confirme a senha: " SENHA2; echo
[[ "$SENHA1" == "$SENHA2" ]] || erro "As senhas não conferem."

export CONTA_EMERGENCIA_SENHA="$SENHA1"
unset SENHA1 SENHA2
docker compose exec -T -e CONTA_EMERGENCIA_SENHA api node dist/cli.js conta-emergencia "$EMAIL" "$NOME" </dev/null
unset CONTA_EMERGENCIA_SENHA

ok "Conta de emergência definida para ${EMAIL} (perfil admin)."
echo "  Acesso: ${URL_PUBLICA}/entrar/emergencia"
echo "  Guarde a senha no cofre de senhas da companhia. Todo uso é auditado."
