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

Foto do Bitfin e Mapa de Garantias (1.2.0): os dados dos clientes vêm direto
do Bitfin (SQL Server 192.168.0.180, usuário só leitura), numa "foto" tirada
pelo botão (Monitoramento → Foto do Bitfin) ou pelo agendador (horário e dias
configuráveis, fuso de Brasília). A importação por planilha fica desligada
(`IMPORTACAO_PLANILHA_HABILITADA=false`; `true` só como contingência).

```bash
# Primeira vez (senha do Bitfin digitada NA VM, sem eco):
sudo bash infrastructure/scripts/configurar_bitfin.sh      # ou CONECTAR-BITFIN.cmd no Windows
# Teste a qualquer momento (lê tudo, não grava nada):
sudo docker compose --env-file .env -f infrastructure/compose.yaml exec -T api node dist/cli.js testar-bitfin
# E-mail do Mapa de Garantias (segredo digitado NA VM, sem eco; testa e, se falhar, volta como estava):
sudo bash infrastructure/scripts/configurar_email.sh        # ou CONFIGURAR-EMAIL.cmd no Windows (LIGAR-EMAIL-MAPA.cmd responde tudo sozinho: credenciais do login)
# Testes avulsos:
sudo docker compose --env-file .env -f infrastructure/compose.yaml exec -T api node dist/cli.js testar-rede-email
sudo docker compose --env-file .env -f infrastructure/compose.yaml exec -T api node dist/cli.js testar-email voce@grupoeverblue.com.br
```

Conexões com bancos (1.3.0, ADR-020): ver `docs/CONEXOES-BANCO.md` —
diagnóstico de aderência, orçamento agregado, gateway do Bitfin (fila,
disjuntor, teto por classe, cancelamento real, zero retentativa), trilha
`integracao_execucao`, `/api/health/dependencies`, exceção de TLS e runbook.

Áreas de gestão (1.2.4, ADR-019): Foto do Bitfin, Mapa de Garantias e
Parâmetros aparecem e funcionam só para quem tem, na Intranet, o perfil de
acesso Administrador, Diretoria ou Gerente (`NIVEIS_ACESSO_GESTAO`, códigos
admin, director, manager). O perfil vem do `/api/access/v1/me` a cada login e
revalidação (5 min). Pré-requisito na Intranet: função "Consultar perfis de
acesso" ligada para o Monitoramento (Configurações → Aplicações de acesso).
Sem perfil informado = sem acesso; a conta de emergência local admin entra.
Negativas ficam na auditoria (`acesso.negado`, motivo "perfil da Intranet").

Limpeza total (1.2.2, ADR-018) — feita UMA vez, antes da primeira foto
oficial: apaga tudo o que foi carregado por planilha e em testes (clientes,
posições, alertas, classificações, eventos, importações, fotos, comitês,
atas, checklists, planos de ação, saídas de risco, jurídico, IASR,
restritivos, Mapa de Garantias, auditoria e todos os arquivos do MinIO).
Mantém só usuários e perfis; regras de alerta/classificação e agendadores
voltam ao padrão. Mostra antes o que será apagado e exige a frase
`APAGAR TUDO`; a API fica parada durante a limpeza. Irreversível pelo sistema.

```bash
sudo bash infrastructure/scripts/zerar_dados.sh            # ou ZERAR-DADOS.cmd no Windows
# Só ver o que seria apagado (não altera nada):
sudo docker compose --env-file .env -f infrastructure/compose.yaml run --rm --no-deps -T migracao node dist/cli.js zerar-dados
```

E-mail (1.2.1): Microsoft 365 pelo Graph (`EMAIL_TRANSPORTE=graph`),
caixa remetente em `EMAIL_REMETENTE` (escolha do responsável), credenciais em
`GRAPH_MAIL_TENANT_ID`/`GRAPH_MAIL_CLIENT_ID`/`GRAPH_MAIL_CLIENT_SECRET`
(vazios usam `ENTRA_*`). Pré-requisito: permissão de APLICAÇÃO `Mail.Send`
com consentimento de administrador. O segredo expira: anote a validade e
rode `configurar_email.sh` de novo ao renovar. Erros comuns, como aparecem:
`AADSTS7000215` segredo inválido · `AADSTS7000222` segredo expirado ·
`ErrorAccessDenied` falta Mail.Send/consentimento ou o Exchange não permite a
caixa · `ErrorInvalidUser`/`MailboxNotEnabledForRESTAPI` caixa sem
Exchange Online.

Fail-closed: leitura que falha, situação desconhecida no Bitfin ou linha que
não passa na validação da importação RECUSA a foto inteira (nada vai para a
posição). Divergências (ex.: índice de liquidez recalculado ≠ gravado) ficam
registradas e visíveis na execução; a liquidez de 60 a 180 dias desse cliente
fica "não informado". A posição do comitê só é gravada quando pedida (opção no
botão ou dia configurado no agendador). O Mapa de Garantias é enviado todos os
dias após a foto agendada; se a foto falhar, o mapa NÃO sai e as cópias são
avisadas. Execução que fica "em andamento" por queda do serviço é encerrada
como falha após 30 minutos.

Mesmo cliente em mais de uma linha (1.1.6): linhas com CNPJs diferentes que
pertencem ao mesmo cliente cadastrado (ex.: matriz e filial) viram UMA posição
na semana, somada: valores em R$ somados, percentuais ponderados pelo risco
(% liquidado no prazo pelo liquidado), pior status e pior status de proposta,
datas mais antigas, maior aging e maior atraso médio, restritivos somados por
tipo; cadastro (grupo, gerente, plataforma, carteira) da primeira linha, com
aviso se divergir. A prévia mostra o aviso "Linhas X e Y ... foram somadas".
Se, mesmo assim, a gravação encontrar posição repetida na semana, a resposta
é 409 com o nome do cliente (antes: 500 "erro inesperado"). Sem migração.

Dois layouts de importação (1.1.5): a Importação Semanal aceita o modelo
oficial OU a própria base do comitê ("Base Carteira - Monitoramento", aba
"Análise da Carteira"). A base é convertida para o modelo e passa pela mesma
validação: colunas lidas pelo NOME (ordem e colunas novas não importam);
coluna essencial ausente recusa a carga; percentuais em fração viram pontos;
"SEM BASE" na liquidez fica sem base; número com observação na célula usa o
número (com aviso); prorrogações e operações saem do texto dos Alertas;
QUATTUOR = carteira apartada com status NORMAL; aging calculado entre
"Vencido desde" e a semana escolhida. Não são importados os campos que o
sistema calcula (enquadramento, criticidade, alertas) nem os do comitê
(decisões, planos, responsáveis). A prévia mostra o formato e o resumo da
conversão. Migração 0007 (aditiva). O `atualizar.sh` passou a limpar o cache
de montagem do Docker com mais de 7 dias após uma atualização bem-sucedida.

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
| Expurgo das fotos de teste do Bitfin (automático, ADR-021) | Diário, a partir das 03:00 |

## Retenção das fotos do Bitfin (1.4.0, ADR-021)

- **Permanentes (nunca apagadas):** a foto que gravou a posição do comitê
  (alimenta telas, gráficos e histórico) e a foto cuja base gerou Mapa de
  Garantias enviado. O banco recusa apagá-las (gatilho da migração 0012),
  inclusive pela Central de Arquivos.
- **Teste / só histórico:** as demais fotos são apagadas depois de
  `RETENCAO_FOTO_TESTE_DIAS` (padrão e mínimo 90). O expurgo roda sozinho na
  API, uma vez por dia a partir das 03:00, em lotes de 200: apaga a leitura
  bruta no MinIO (metadados e trilha do arquivo ficam), religa a comparação
  com a foto anterior mantida e grava auditoria `foto.expurgo` com os ids.
- Conferir o que é permanente, o que é teste e quando expira (só consulta):

  ```bash
  cd /opt/everblue-monitoramento/app && sudo bash infrastructure/scripts/retencao_fotos.sh
  ```
- O `verificar.sh` confere que os gatilhos de proteção existem.

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
