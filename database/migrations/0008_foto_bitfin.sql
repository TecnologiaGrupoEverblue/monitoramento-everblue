-- 0008 — Foto do Bitfin (1.2.0).
--
-- A posição dos clientes passa a vir do Bitfin por "foto" (ADR-013/014): a
-- leitura é feita uma vez por execução (manual ou agendada), gravada aqui e
-- comparada com a foto anterior. A importação por planilha fica desligada.
--
--   * cliente: nova situação RECUPERACAO_DE_CREDITO (existe no Bitfin);
--   * importacao: formato BITFIN (a foto passa pela MESMA validação,
--     classificação e gravação da importação semanal);
--   * snapshot: "% liquidado no prazo" pode ficar não informado (fail-closed:
--     sem pontualidade do mês fechado no Bitfin, nunca 0%);
--   * foto_execucao (histórico de execuções), foto_cliente (posição e detalhe
--     de cada cliente, append-only) e foto_agendamento (agendador);
--   * usuário de sistema "Agendador" (autor das fotos agendadas; não entra).
-- Aditiva: nada existente é apagado.

ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_status_check;
ALTER TABLE cliente ADD CONSTRAINT cliente_status_check
  CHECK (status IN ('NORMAL', 'MONITORAMENTO', 'SAIDA_DE_RISCO', 'RECUPERACAO_DE_CREDITO', 'JURIDICO'));

ALTER TABLE importacao DROP CONSTRAINT IF EXISTS importacao_formato_check;
ALTER TABLE importacao ADD CONSTRAINT importacao_formato_check CHECK (formato IN ('MODELO', 'BASE_COMITE', 'BITFIN'));

ALTER TABLE snapshot_semanal ALTER COLUMN perc_liquidado_no_prazo DROP NOT NULL;

-- Usuário de sistema: autor das execuções agendadas. Sem senha, inativo
-- (o login recusa usuário inativo) e sem vínculo com o Entra.
INSERT INTO usuario (id, email, nome, cargo, perfil, origem, ativo, motivo_acesso_local)
VALUES ('00000000-0000-4000-8000-00000000f070', 'agendador@monitoramento.local', 'Agendador do Monitoramento', 'Sistema', 'leitor', 'local', FALSE,
        'Usuário de sistema das fotos agendadas do Bitfin. Não entra no sistema.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE foto_execucao (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origem             TEXT NOT NULL CHECK (origem IN ('MANUAL', 'AGENDADA')),
  solicitado_por     UUID NOT NULL REFERENCES usuario (id),
  iniciado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em       TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'EXECUTANDO'
                     CHECK (status IN ('EXECUTANDO', 'CONCLUIDA', 'RECUSADA', 'FALHOU')),
  -- O que foi pedido para a posição semanal e o que aconteceu.
  gravar_posicao     BOOLEAN NOT NULL DEFAULT FALSE,
  semana_ref         DATE,
  posicao_semanal    TEXT CHECK (posicao_semanal IN ('GRAVADA', 'JA_EXISTIA', 'NAO_SOLICITADA', 'NAO_GRAVADA')),
  importacao_id      UUID REFERENCES importacao (id),
  arquivo_id         UUID REFERENCES arquivo (id),
  versao_regras      TEXT NOT NULL,
  bitfin_lido_em     TIMESTAMPTZ,
  bitfin_apurado_em  TIMESTAMPTZ,
  clientes           INT,
  totais             JSONB,
  divergencias       JSONB NOT NULL DEFAULT '[]'::jsonb,
  recusas            JSONB NOT NULL DEFAULT '[]'::jsonb,
  tempos_ms          JSONB,
  mensagem           TEXT,
  foto_anterior_id   UUID REFERENCES foto_execucao (id)
);
CREATE INDEX foto_execucao_iniciado ON foto_execucao (iniciado_em DESC);
-- Uma foto por vez: duas leituras simultâneas do Bitfin não fazem sentido.
CREATE UNIQUE INDEX foto_execucao_uma_por_vez ON foto_execucao ((TRUE)) WHERE status = 'EXECUTANDO';

CREATE TABLE foto_cliente (
  foto_id            UUID NOT NULL REFERENCES foto_execucao (id),
  bitfin_cliente_id  INT NOT NULL,
  cliente_id         TEXT REFERENCES cliente (id),
  documento          TEXT NOT NULL,
  nome               TEXT NOT NULL,
  status             TEXT NOT NULL,
  risco              NUMERIC(18,2) NOT NULL,
  linha              JSONB NOT NULL,
  detalhe            JSONB NOT NULL,
  PRIMARY KEY (foto_id, bitfin_cliente_id)
);
CREATE INDEX foto_cliente_cliente ON foto_cliente (cliente_id, foto_id);
CREATE INDEX foto_cliente_documento ON foto_cliente (documento);
CREATE TRIGGER foto_cliente_append_only BEFORE UPDATE OR DELETE ON foto_cliente
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- Agendador: uma linha só (id = 1).
CREATE TABLE foto_agendamento (
  id                  INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo               BOOLEAN NOT NULL DEFAULT FALSE,
  horario             TEXT NOT NULL DEFAULT '07:30' CHECK (horario ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 0 = domingo … 6 = sábado (fuso America/Sao_Paulo).
  dias_semana         INT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  -- Dia em que a foto agendada também grava a posição do comitê (NULL = nunca).
  dia_posicao_semanal INT CHECK (dia_posicao_semanal BETWEEN 0 AND 6),
  ultima_execucao_em  TIMESTAMPTZ,
  atualizado_por      UUID REFERENCES usuario (id),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(dias_semana) BETWEEN 1 AND 7 AND dias_semana <@ ARRAY[0,1,2,3,4,5,6])
);
INSERT INTO foto_agendamento (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Prazo médio e atraso médio com 2 casas (a foto calcula 37,89 dias; o INT
-- arredondava para 38). Conversão sem perda: inteiros viram n,00.
ALTER TABLE snapshot_semanal ALTER COLUMN prazo_medio_carteira_dias TYPE NUMERIC(9,2);
ALTER TABLE snapshot_semanal ALTER COLUMN atraso_medio_dias TYPE NUMERIC(9,2);

-- Fail-closed (1.2): campo que a fonte não informa fica NULL ("não
-- informado"), nunca 0 — prazo médio sem operação, atraso sem título pago na
-- janela, % sem atuação sem carteira manifestada, liquidado sem apuração.
ALTER TABLE snapshot_semanal ALTER COLUMN prazo_medio_carteira_dias DROP NOT NULL;
ALTER TABLE snapshot_semanal ALTER COLUMN atraso_medio_dias DROP NOT NULL;
ALTER TABLE snapshot_semanal ALTER COLUMN manifesto_perc_sem_atuacao DROP NOT NULL;
ALTER TABLE snapshot_semanal ALTER COLUMN liquidado_no_periodo DROP NOT NULL;
