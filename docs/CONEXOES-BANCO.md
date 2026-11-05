# Conexões e proteção de bancos — Monitoramento Everblue

Aderência ao **Padrão Corporativo Everblue de Conexões e Proteção de Bancos de
Dados** (skill de desenvolvimento, regra soberana 17). Versão 1.3.0, 05/11/2026.
Decisão registrada na ADR-020 (`decisoes-arquitetura`).

## 1. Diagnóstico de aderência

- **Projeto / serviço / ambiente:** Monitoramento Everblue — `api` (Fastify), `migracao` (job), `cli` (diagnóstico e limpeza) — produção em srvmnt01 (192.168.0.248).
- **Stack e versões:** Node.js 22 (imagem `node:22-bookworm-slim`), TypeScript strict, `pg` 8.23.0 (PostgreSQL 16), `mssql` 11.0.2 / tedious 18.6.2 (SQL Server do Bitfin). Lockfile `package-lock.json`.
- **PostgreSQL (banco próprio):** `backend/api/src/infra/banco.ts` — um `pg.Pool` por processo (`criarBanco`), `max` = `DATABASE_POOL_MAX` (10), `connectionTimeoutMillis` 10 s, `idleTimeoutMillis` 30 s, `statement_timeout` 30 s, `lock_timeout` 10 s, `idle_in_transaction_session_timeout` 60 s, `application_name`. Usuário da aplicação sem superusuário (`database/init/01_papel_aplicacao.sh`). Conexão por `db:5432` na rede interna.
- **SQL Server / Bitfin (legado, só leitura):** `backend/api/src/infra/bitfin.ts` + `gatewayLegado.ts`. Antes da 1.3.0: um pool novo por foto e por busca de nome, timeout único de 180 s, `RIGHT()`/`REPLACE()` sobre colunas de documento, mensagem do driver exibida na tela, sem fila nem disjuntor. A partir da 1.3.0: ver §3.
- **Processos e réplicas máximos:** `api` 1 processo (1 réplica); `migracao` 1 processo transitório; `cli` 1 processo transitório (exec/run manual).
- **Controles já existentes (preservados):** usuário `Everblue` com `db_datareader` apenas; `conferirSomenteLeitura` (recusa comando de escrita, `INTO`, `sp_`/`xp_`, coluna `Senha`); `readOnlyIntent`; leitura da foto numa única transação desfeita ao final; uma foto por vez (índice único em `foto_execucao`); catálogo fechado de consultas (`bitfinConsultas.ts`); binding tipado (`@dN`); foto agendada no máximo uma vez por dia; fail-closed da foto (leitura com falha não grava nada).
- **Lacunas comprovadas e corrigidas na 1.3.0:** ver §6.
- **Risco de alterar o ambiente:** baixo — mesmas consultas e regras; mudam o ciclo de vida da conexão (pool estável por processo, máx. 1), os filtros de documento (normalização no parâmetro) e as mensagens de erro.
- **Decisões que dependem do DBA/fornecedor do Bitfin:** capacidade reservada ao Monitoramento (proposta: 2 conexões), certificado TLS confiável no SQL Server, confirmação de índice em `Entidade.Documento` e do plano das visões `VIEW_VADU_2_*`.

## 2. Orçamento agregado de conexões

| Serviço | Banco | Processos máx. | Pool por processo | Conexões máx. | Aprovação |
|---|---|---|---|---|---|
| api | PostgreSQL (monitoramento) | 1 | `DATABASE_POOL_MAX` = 10 | 10 | Tecnologia |
| migracao (job) | PostgreSQL | 1 | 2 | 2 | Tecnologia |
| cli (exec/run manual) | PostgreSQL | até 2 simultâneos | 2 | 4 | Tecnologia |
| **Total PostgreSQL** | | | | **16** | `max_connections` = 50; reserva de superusuário 3; aprovado: **40** (`DATABASE_CONEXOES_APROVADAS`) |
| api | SQL Server (Bitfin) | 1 | 1 (fila e concorrência 1) | 1 | **Pendente DBA** |
| cli `testar-bitfin` | SQL Server (Bitfin) | 1 | 1 | 1 | **Pendente DBA** |
| **Total Bitfin** | | | | **2** | **Pendente DBA** |

Acoplamento com o número de processos: o limite de concorrência do Bitfin
(1 execução + fila de `BITFIN_FILA_MAX`) é **por processo**. Aumentar réplicas
da `api` multiplica o teto do Bitfin e exige gateway compartilhado (fila no
PostgreSQL) antes — não escale a API sem rever esta tabela.

A validação de configuração recusa o boot quando `DATABASE_POOL_MAX + 6`
passa de `DATABASE_CONEXOES_APROVADAS`.

## 3. Gateway do Bitfin (`backend/api/src/infra/gatewayLegado.ts`)

| Item do padrão | Implementação |
|---|---|
| Gateway único | Toda leitura passa por `LeitorBitfinSqlServer` → `GatewayLegado.executar` |
| Catálogo fechado de operações | `foto.leitura`, `mapa.nomes`, `diagnostico.conexao` (`OPERACOES_LEGADO`); SQL só de `bitfinConsultas.ts` |
| Pool | um `ConnectionPool` por processo, `max: 1`, `min: 0`, fecha a conexão após 30 s ociosa |
| Concorrência e fila | 1 execução; fila de `BITFIN_FILA_MAX` (3); fila cheia = recusa imediata; espera máxima por classe |
| Single-flight | `mapa.nomes` com a mesma lista de documentos compartilha a execução (mesmo resultado para qualquer usuário autorizado ao Mapa) |
| Disjuntor | CLOSED → OPEN após `BITFIN_DISJUNTOR_FALHAS` (3) falhas de dependência seguidas (conexão, tempo); credencial inválida abre na hora; OPEN por `BITFIN_DISJUNTOR_ABERTO_S` (300 s); HALF_OPEN com uma sondagem; erro de SQL não abre |
| Timeouts por classe | foto: 180 s por consulta e 900 s total; nomes/diagnóstico: 15 s por consulta; conexão 15 s |
| Cancelamento real | no fim do teto chama `request.cancel()` (tedious envia ATTENTION ao SQL Server); a vaga só é liberada quando o driver devolve o controle |
| Retentativa | **zero** em todas as operações |
| Isolamento | SNAPSHOT só se `sys.databases.snapshot_isolation_state = 1`; senão READ COMMITTED; transação desfeita ao final; nunca `NOLOCK` |
| Auditoria | tabela `integracao_execucao` (migração 0011, append-only): uma linha por execução física ou recusa, com requisições lógicas atendidas; sem PII. Falha ao gravar a auditoria vai para o log e não derruba a leitura (decisão ADR-020) |
| Log estruturado | `bitfin_operacao` com `database_alias`, `operation_id`, `correlation_id`, `duration_ms`, `queue_wait_ms`, `status`, `error_category`, `retry_count`, `circuit_state`, `result_count`; detalhe do driver só em `bitfin_erro_detalhe` |
| Health | `/api/health/live` (sem dependências), `/api/health/ready` (PostgreSQL + MinIO, nunca o Bitfin), `/api/health/dependencies` (autenticado, área de gestão: UP/DEGRADED/DOWN/UNKNOWN sem host nem credencial; não consulta o Bitfin) |
| Shutdown | para de admitir, drena a execução em curso (até 10 s) e fecha o pool do Bitfin antes do PostgreSQL |

### Catálogo de erros

| Código | Situação | Retry | Ao usuário |
|---|---|---|---|
| `DB_LEGACY_NOT_CONFIGURED` | BITFIN_* ausente | Não | conexão não configurada |
| `DB_LEGACY_CIRCUIT_OPEN` | disjuntor aberto | Não | Bitfin indisponível, nova tentativa automática |
| `DB_LEGACY_QUEUE_FULL` | fila cheia ou desligando | Não | tente em instantes |
| `DB_LEGACY_QUEUE_TIMEOUT` | espera na fila excedida | Não | descartada sem executar |
| `DB_LEGACY_CONNECT_ERROR` | rede/servidor | Não | não foi possível conectar |
| `DB_LEGACY_CREDENTIAL` | usuário/senha recusados | Não (abre o disjuntor) | Bitfin recusou o usuário |
| `DB_LEGACY_QUERY_TIMEOUT` | teto excedido (cancelada) | Não | passou do tempo e foi cancelada |
| `DB_LEGACY_QUERY_ERROR` | SQL recusado | Não | Bitfin recusou uma consulta |
| `DB_FORBIDDEN_OPERATION` | fora do catálogo | Nunca | operação não autorizada |

A tela mostra só a mensagem do catálogo, o código e a etapa (nome da consulta).
O texto do driver fica no log do servidor e na saída do `cli testar-bitfin`.

## 4. Proteção da carga no Bitfin

- Filtro de documento sem função sobre a coluna: `Entidade.Documento` (varchar(15), zeros à esquerda) recebe o parâmetro já normalizado em duas formas (15 dígitos e só dígitos); `pesCNPJCPF` (varchar(14), só dígitos) é comparado direto. Ordem dos valores = ordem dos `@dN` no SQL (teste automatizado).
- `CAST(<datetime> AS date)` em filtros de data é sargável no SQL Server (mantido).
- A foto lê só clientes com situação ≠ Normal e risco > 0, e os do Mapa; quase tudo agregado no próprio SQL; títulos linha a linha só os em aberto da Cobrança Vinculada dos clientes do Mapa.
- Pendente com o DBA: plano de execução das visões `VIEW_VADU_2_CedenteRisco/Resumo` (podem calcular a visão inteira antes do filtro) e índice em `Entidade.Documento`.

## 5. Exceção de TLS (registro formal)

| Campo | Valor |
|---|---|
| Sistema | Monitoramento → SQL Server do Bitfin (192.168.0.180:1433, UNLTD_EVERBLUE) |
| Configuração | `encrypt=true`, `trustServerCertificate=true` (`BITFIN_CONFIAR_CERTIFICADO=true`) |
| Proprietário | Tecnologia Everblue (Waldomiro Silva) |
| Justificativa | SQL Server com certificado autoassinado; mesma forma de conexão da Intranet; decisão do responsável em 29/10/2026 (ADR-014) |
| Risco | canal cifrado sem validar o servidor: um equipamento na rede interna que se passe pelo SQL Server poderia capturar a senha do usuário de leitura |
| Controles compensatórios | usuário só `db_datareader`; host fixo na rede interna; senha só no `.env` (600) digitada na VM; recusa de comando de escrita e de leitura de senha no código; `readOnlyIntent`; 1 conexão por processo; trilha `integracao_execucao` |
| Regularização | certificado da AC corporativa (ou CA privada distribuída) com o nome DNS do servidor no SQL Server; testar `BITFIN_CONFIAR_CERTIFICADO=false` em homologação; implantar |
| Revisão | 05/02/2027 ou na troca do certificado do SQL Server |
| Aprovador | Waldomiro Silva (Tecnologia) — 29/10/2026 |

## 6. Lacunas encontradas e corrigidas na 1.3.0

1. Pool do Bitfin criado a cada foto e a cada busca de nome → um pool por processo, máx. 1 conexão.
2. Sem fila, single-flight nem disjuntor → `GatewayLegado`.
3. Timeout único (180 s) para tudo, sem cancelamento → teto por classe e `request.cancel()`; a busca de nome usava `Promise.race` de 20 s, que não cancelava a consulta no servidor.
4. `RIGHT('000…' + e.Documento, 15)` e `REPLACE(…pesCNPJCPF…)` nos filtros → normalização no parâmetro.
5. Mensagem do driver (ex.: "Snapshot isolation transaction failed…") exibida na tela → mensagem do catálogo + código; detalhe só no log.
6. Sem trilha das execuções no legado → `integracao_execucao`.
7. Sem `/api/health/dependencies` → criado.
8. E-mail do destinatário no log de falha de envio do Mapa → removido.
9. Orçamento agregado não documentado nem validado → §2 e validação no boot.
10. Exceção de TLS sem registro formal → §5.
11. Roteiros `configurar_bitfin.sh`, `configurar_email.sh`, `configurar_entra.sh` e `zerar_dados.sh` com `set -u` apenas → `set -euo pipefail`; a limpeza grava manifesto antes de apagar.

## 7. Plano de testes (T01–T20)

| ID | Situação | Evidência |
|---|---|---|
| T01 | Coberto | suíte da API contra PostgreSQL real |
| T02 | Coberto | Bitfin não configurado/fora: foto falha sem gravar; inclusão no Mapa entra com nome pendente; demais telas seguem (testes de foto e mapa) |
| T03 | Coberto | `gateway-bitfin.test.ts` — cancel() no driver e `DB_LEGACY_QUERY_TIMEOUT` |
| T04 | Coberto | fila cheia recusa na hora, sem executar |
| T05 | Coberto | 3 pedidos idênticos = 1 execução física, `requisicoes_logicas = 3` |
| T06 | Coberto | chaves diferentes não compartilham |
| T07 | Coberto | disjuntor aberto não executa |
| T08 | Coberto | HALF_OPEN com uma sondagem; sucesso fecha |
| T09 | Coberto | credencial inválida abre na hora; erro de SQL não abre |
| T10 | Parcial | pool do PostgreSQL com `connectionTimeoutMillis`; sem teste de saturação |
| T11 | Documentado | orçamento §2 e validação no boot |
| T12 | Coberto | vaga só liberada quando o driver devolve o controle |
| T13 | Coberto | falha ao gravar auditoria: operação segue, um log, sem loop |
| T14 | Coberto | operação fora do catálogo e comando de escrita recusados |
| T15 | Parcial | `lock_timeout` no PostgreSQL; no Bitfin, leitura em transação de leitura sem `NOLOCK` |
| T16 | Coberto | drenagem: fila recusada, execução em curso concluída |
| T17 | Coberto | `/ready` não consulta o Bitfin; `/dependencies` testado |
| T18 | Coberto | detalhe do driver só no log; mensagem ao usuário sem texto do driver |
| T19 | Coberto | cenário atual mantido; exceção registrada (§5) |
| T20 | Coberto | suíte completa sem regressão |

Teste de carga contra o Bitfin real: **não executado** (banco do fornecedor em
produção, exige janela e autorização formal).

## 8. Runbook

1. Estado: `GET /api/health/dependencies` (logado com perfil de gestão) — disjuntor, fila, última execução.
2. Execuções recentes no Bitfin (sem PII):
   ```bash
   cd /opt/everblue-monitoramento/app
   sudo docker compose --env-file .env -f infrastructure/compose.yaml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select iniciado_em, operacao, status, categoria_erro, duracao_ms, espera_fila_ms, estado_disjuntor from integracao_execucao order by iniciado_em desc limit 20;"'
   ```
3. Detalhe técnico do erro: `sudo docker compose --env-file .env -f infrastructure/compose.yaml logs --since 1h api | grep bitfin_`.
4. Teste de leitura completo (somente leitura): `... exec -T api node dist/cli.js testar-bitfin`.
5. Disjuntor aberto por credencial: corrigir com `configurar_bitfin.sh` (recria a API, o disjuntor volta a CLOSED).
6. Nunca matar sessão no SQL Server do Bitfin sem autorização do fornecedor; acionar o DBA com o `correlation_id` e o `operation_id`.
