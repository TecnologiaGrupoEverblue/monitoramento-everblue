# Operação

Instalação: `/opt/everblue-monitoramento/app` · Dados: `/opt/everblue-monitoramento/dados`.

Os roteiros carregam o `.env` sozinhos. Comando manual do compose, sempre da raiz:

```bash
docker compose --env-file .env -f infrastructure/compose.yaml <comando>
```

## Primeira instalação

```bash
./infrastructure/scripts/preparar.sh          # .env (600) com segredos + diretórios
nano .env                                     # Entra, Intranet, mapa de perfis, imagens MinIO
./infrastructure/scripts/certificado.sh csr   # enviar só o .csr à AC interna
./infrastructure/scripts/certificado.sh conferir   # após gravar emon.crt (+ cadeia)
./infrastructure/scripts/implantar.sh
./infrastructure/scripts/conta_emergencia.sh
./infrastructure/scripts/verificar.sh
```

Ordem da subida (garantida pelo compose): `db` e `minio` saudáveis →
`minio-init` (bucket, versionamento, usuário da aplicação) → `migracao`
(migrações + bootstrap) → `api` → `nginx`.

## Atualização

```bash
# 1. Confirmar o backup corporativo de /opt/everblue-monitoramento/dados
# 2. Substituir o código (sem tocar em .env e infrastructure/nginx/certs)
./infrastructure/scripts/implantar.sh
./infrastructure/scripts/verificar.sh
```

Migrações novas são aplicadas pelo serviço `migracao` antes de a API subir.
Migração já aplicada **não pode ser editada** (checksum): mudança de esquema é
sempre um arquivo novo em `database/migrations`.

## Retorno (rollback)

```bash
docker compose --env-file .env -f infrastructure/compose.yaml down   # SEM -v
# voltar o código para a versão anterior
./infrastructure/scripts/implantar.sh
```

Se a versão nova aplicou migração, avalie com o time antes de voltar o código:
restauração de banco segue o processo corporativo de backup.

## Logs e diagnóstico

```bash
docker compose --env-file .env -f infrastructure/compose.yaml logs -f api
docker compose --env-file .env -f infrastructure/compose.yaml logs migracao minio-init
docker compose --env-file .env -f infrastructure/compose.yaml ps -a
```

Logs em JSON (pino), rotação 10 MB × 3 por contêiner. Cada resposta traz
`x-correlation-id` para cruzar com o log.

| Sintoma | Causa provável |
|---|---|
| `nginx` reiniciando | Certificado ausente/vencido ou `emon.crt` não casa com `emon.key` (`certificado.sh conferir`) |
| `migracao` com erro | `DATABASE_URL` diferente da senha do `emon_app`, ou migração editada |
| `minio-init` com erro | `MINIO_ROOT_*` errado, ou `MINIO_ACCESS_KEY` igual ao usuário raiz |
| Login volta com `erro=nao_configurado` | `ENTRA_*` incompleto |
| Autentica e não entra | Pessoa não liberada no Controle de Acessos da Intranet |
| Entrou com perfil baixo | Grupo não atribuído à Enterprise App ou GUID fora do `ENTRA_MAPA_PERFIL` |

## Rotinas

| Rotina | Frequência |
|---|---|
| `verificar.sh` | Após toda implantação e semanalmente |
| Validade do certificado | Mensal (o `implantar.sh` avisa com 30 dias) |
| Validade do client secret do Entra | Conforme vencimento cadastrado |
| Teste da conta de emergência | Trimestral |
| Espaço do disco de dados (`df -h /opt/everblue-monitoramento`) — o MinIO guarda todos os arquivos e versões | Semanal |
| Backup de `dados/postgres` e `dados/minio` | Processo corporativo |

## Arquivos (MinIO)

- Central de Arquivos na interface: `/arquivos`. Totais por finalidade em
  `GET /api/v1/arquivos/totais`.
- Sem limite de tamanho por padrão (`ARQUIVOS_MAX_MB=0`); o limite real é o
  disco de dados. Para limitar, defina o valor em MB no `.env` e rode o
  `implantar.sh`.
- Extensões podem ser recusadas por política em `ARQUIVOS_EXTENSOES_BLOQUEADAS`
  (vazio = todas aceitas).
- Expurgo é irreversível para o conteúdo; metadados, versões registradas e trilha
  permanecem. Recuperação depois de expurgo só pelo backup corporativo.

## Proibido

- `docker compose down -v`, `docker volume rm`, apagar `DADOS_DIR`.
- Editar/sobrescrever o `.env` sem cópia no cofre.
- Copiar `emon.key` para fora do servidor.
- `carga-demonstracao` em produção (o comando recusa).
