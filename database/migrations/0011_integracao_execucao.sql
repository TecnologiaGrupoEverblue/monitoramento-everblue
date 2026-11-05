-- 0011 (1.3.0) — Trilha de auditoria das consultas ao Bitfin (ADR-020).
--
-- Padrão Corporativo Everblue de Conexões e Proteção de Bancos de Dados, §12:
-- uma linha por EXECUÇÃO FÍSICA no legado (ou recusa antes de executar), com
-- quantas requisições lógicas ela atendeu (single-flight). Sem PII: nenhum
-- documento, nome, SQL, parâmetro ou resultado — só a operação do catálogo,
-- o pseudônimo do ator, tempos, categoria de erro e estado do disjuntor.
CREATE TABLE integracao_execucao (
  id                  UUID PRIMARY KEY,
  correlation_id      TEXT NOT NULL,
  servico             TEXT NOT NULL DEFAULT 'everblue-monitoramento-api',
  ambiente            TEXT NOT NULL,
  integracao          TEXT NOT NULL CHECK (integracao IN ('bitfin')),
  operacao            TEXT NOT NULL CHECK (operacao IN ('foto.leitura', 'mapa.nomes', 'diagnostico.conexao')),
  ator_ref            TEXT,
  status              TEXT NOT NULL CHECK (status IN ('SUCESSO', 'ERRO', 'RECUSADA')),
  iniciado_em         TIMESTAMPTZ NOT NULL,
  concluido_em        TIMESTAMPTZ NOT NULL,
  duracao_ms          INTEGER NOT NULL CHECK (duracao_ms >= 0),
  espera_fila_ms      INTEGER NOT NULL CHECK (espera_fila_ms >= 0),
  tentativas          SMALLINT NOT NULL CHECK (tentativas IN (0, 1)),
  requisicoes_logicas INTEGER NOT NULL CHECK (requisicoes_logicas >= 1),
  categoria_erro      TEXT CHECK (categoria_erro IS NULL OR categoria_erro ~ '^DB_[A-Z_]+$'),
  estado_disjuntor    TEXT NOT NULL CHECK (estado_disjuntor IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  linhas              INTEGER,
  dados_de            TIMESTAMPTZ,
  sistema_origem      TEXT NOT NULL DEFAULT 'bitfin'
);
CREATE INDEX integracao_execucao_em ON integracao_execucao (iniciado_em DESC);
CREATE INDEX integracao_execucao_operacao ON integracao_execucao (operacao, iniciado_em DESC);
CREATE TRIGGER integracao_execucao_append_only BEFORE UPDATE OR DELETE ON integracao_execucao
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();
