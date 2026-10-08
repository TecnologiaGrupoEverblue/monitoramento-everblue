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
Na 1.1, o mesmo serviço classifica uma única vez a última posição já
importada (se ainda não tiver classificação).

Contêineres (1.1.1): healthchecks a cada 30 s com binário leve (`pg_isready`,
`wget`/`busybox wget`), `init: true` na API e na migração, heap do Node a ~75%
do limite (`--max-old-space-size`), `memswap_limit` igual ao limite de memória
(sem swap no contêiner) e `no-new-privileges` em todos os serviços. O nginx tem
verificação própria em `http://127.0.0.1/nginx-saude` (porta 80, sem redirecionar).

Sem Gerente (1.1.4): linha importada com a coluna Gerente vazia fica sob o
gerente **"Sem Gerente"** (com aviso na prévia da importação). A migração
0006 corrige o que já tinha sido importado com gerente de nome vazio.

Central de Arquivos (1.1.4): programas e scripts executáveis são sempre
recusados — pelo nome (.exe, .dll, .msi, .bat, .cmd, .ps1, .vbs, .js, .jar,
.sh…) e pelo CONTEÚDO (executável renomeado, ELF, Mach-O, script com `#!`),
sem deixar resto no bucket. Limite padrão de 100 MB por arquivo
(`ARQUIVOS_MAX_MB`, 0 = padrão). Versão antiga executável não pode ser
restaurada. Arquivos já guardados não são apagados.

Alerta da Intranet (1.1.4): a API acompanha toda validação de acesso e
verifica a Intranet a cada `DIRETORIO_MONITOR_MINUTOS` (5). Quando cai: aviso
na tela de login e no topo do sistema, log de ERRO `intranet_indisponivel`
(aparece em "Erros recentes da API" do `verificar.sh`) e evento de auditoria
`intranet.indisponivel`; ao voltar, `intranet.restabelecida`. Estado para
ferramentas de monitoração: `GET /api/health/intranet` (200 ok, 503 fora).

Confiança na Intranet (1.1.3): o `implantar.sh` roda antes do build o
`confiar_ca_corporativa.sh`, que instala (uma vez; depois só confere) o
certificado público da **Everblue Corporate Root CA v1** no servidor e na
imagem da API. Se o certificado não estiver no pacote nem no servidor, ele o
busca na VM da Intranet (pede a senha dela). Ao fim da implantação há um
smoke test da chamada assinada à Intranet; o `verificar.sh` confere as duas
coisas. Retorno da confiança: apagar
`/usr/local/share/ca-certificates/everblue-corporate-root-ca-v1.crt` e rodar
`update-ca-certificates --fresh` (a raiz v2 continua instalada na imagem).

Apresentação de valores (1.1.2): a partir de **R$ 1 milhão** todo valor em
tela, ata, alerta e gráfico aparece em milhões com **3 casas decimais**
(`R$ 14,665 mi`); abaixo disso, por extenso (`R$ 229.000`). A regra fica em
`backend/dominio/src/utils/formatters.ts`. A exportação CSV continua com o
número completo, para conferência e uso em planilha. Sem migração.

Retenção (1.1): `atualizar.sh` mantém só as **3 versões mais recentes** em
`releases/`; os scripts que gravam o `.env` mantêm só as **3 cópias
`.env.bak-*` mais recentes**, todas com permissão 600.
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
