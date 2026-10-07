-- 0004 — Carteiras, documentos do cliente, qualidade de dado, restritivos
-- estruturados, andamento de planos e classificação semanal.
--
-- Migração aditiva: nada existente é apagado nem reescrito. Snapshots, eventos
-- e atas continuam append-only; o que era gravado antes desta versão fica
-- como estava (ex.: IL "sem base" que entrou como 0 continua 0 — só as
-- posições novas passam a gravar ausência como ausência).

-- ---------------------------------------------------------------- 1. carteiras

-- Carteira = universo de análise. Uma carteira APARTADA (ex.: QUATTUOR) é
-- acompanhada no sistema, mas fica fora dos indicadores da carteira Everblue
-- (dashboard, ata, painel da diretoria), a não ser que seja filtrada de propósito.
CREATE TABLE carteira (
  id        TEXT PRIMARY KEY,
  nome      TEXT NOT NULL,
  apartada  BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carteira_nome_unico ON carteira (lower(btrim(nome)));
INSERT INTO carteira (id, nome, apartada) VALUES
  ('car_everblue', 'EVERBLUE', FALSE),
  ('car_quattuor', 'QUATTUOR', TRUE);

ALTER TABLE cliente ADD COLUMN carteira_id TEXT NOT NULL DEFAULT 'car_everblue' REFERENCES carteira (id);
CREATE INDEX cliente_carteira ON cliente (carteira_id);

-- Antes desta versão a carteira QUATTUOR entrava pela coluna "Plataforma
-- Comercial". Quem já está assim passa para a carteira apartada.
UPDATE cliente c SET carteira_id = 'car_quattuor'
  FROM plataforma p
 WHERE p.id = c.plataforma_id AND upper(btrim(p.nome)) = 'QUATTUOR';

-- ---------------------------------------------------------------- 2. documentos do cliente

-- Um cliente (unidade de análise) pode ter vários CNPJs. O primeiro é o
-- principal e continua em cliente.cnpj; todos ficam aqui, e nenhum documento
-- pertence a dois clientes.
CREATE TABLE cliente_documento (
  id                    BIGSERIAL PRIMARY KEY,
  cliente_id            TEXT NOT NULL REFERENCES cliente (id),
  documento             TEXT NOT NULL,
  documento_normalizado TEXT GENERATED ALWAYS AS (regexp_replace(documento, '\D', '', 'g')) STORED,
  principal             BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cliente_documento_nao_vazio CHECK (regexp_replace(documento, '\D', '', 'g') <> '')
);
CREATE UNIQUE INDEX cliente_documento_unico ON cliente_documento (documento_normalizado);
CREATE UNIQUE INDEX cliente_documento_um_principal ON cliente_documento (cliente_id) WHERE principal;
CREATE INDEX cliente_documento_cliente ON cliente_documento (cliente_id);

INSERT INTO cliente_documento (cliente_id, documento, principal)
SELECT id, cnpj, TRUE FROM cliente;

-- Todo cliente novo nasce com o documento principal registrado, venha de onde
-- vier (importação, carga de demonstração).
CREATE OR REPLACE FUNCTION registrar_documento_principal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cliente_documento (cliente_id, documento, principal) VALUES (NEW.id, NEW.cnpj, TRUE);
  RETURN NEW;
END;
$$;
CREATE TRIGGER cliente_documento_principal AFTER INSERT ON cliente
  FOR EACH ROW EXECUTE FUNCTION registrar_documento_principal();

-- ---------------------------------------------------------------- 3. posição semanal

-- "SEM PROPOSTA" passa a ser um status próprio (antes entrava como EM_ANALISE).
ALTER TABLE snapshot_semanal DROP CONSTRAINT snapshot_semanal_status_proposta_check;
ALTER TABLE snapshot_semanal ADD CONSTRAINT snapshot_semanal_status_proposta_check
  CHECK (status_proposta IN ('EM_ANALISE', 'APROVADA', 'VENCIDA', 'REPROVADA', 'SEM_PROPOSTA'));

-- Janela de liquidez sem base é AUSÊNCIA de dado, não liquidez zero.
ALTER TABLE snapshot_semanal
  ALTER COLUMN il30 DROP NOT NULL,
  ALTER COLUMN il60 DROP NOT NULL,
  ALTER COLUMN il90 DROP NOT NULL,
  ALTER COLUMN il120 DROP NOT NULL,
  ALTER COLUMN il150 DROP NOT NULL,
  ALTER COLUMN il180 DROP NOT NULL;

-- Colunas opcionais da importação: prorrogações acima de 60 dias e volume de
-- operações do mês e do mês anterior (R$). Ausente = não informado.
ALTER TABLE snapshot_semanal
  ADD COLUMN prorrogacoes_acima60d NUMERIC(18,2),
  ADD COLUMN operacoes_mes_anterior NUMERIC(18,2),
  ADD COLUMN operacoes_mes NUMERIC(18,2);

-- ---------------------------------------------------------------- 4. restritivos estruturados

-- Quantidade e valor por tipo, por cliente e semana. Vem da importação
-- (colunas opcionais) ou é lançado/corrigido pela ficha do cliente; toda
-- gravação manual deixa evento no histórico.
CREATE TABLE restritivo_semanal (
  id             TEXT PRIMARY KEY,
  cliente_id     TEXT NOT NULL REFERENCES cliente (id),
  semana_ref     DATE NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('PEFIN', 'REFIN', 'PROTESTO', 'ACAO_JUDICIAL', 'DIVIDA_VENCIDA', 'CHEQUE_SEM_FUNDO', 'RECUPERACAO_FALENCIA', 'OUTRO')),
  quantidade     INT NOT NULL CHECK (quantidade >= 0),
  valor          NUMERIC(18,2) NOT NULL CHECK (valor >= 0),
  origem         TEXT NOT NULL CHECK (origem IN ('IMPORTACAO', 'MANUAL')),
  observacao     TEXT,
  registrado_por TEXT NOT NULL,
  registrado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT restritivo_um_por_tipo UNIQUE (cliente_id, semana_ref, tipo)
);
CREATE INDEX restritivo_cliente ON restritivo_semanal (cliente_id, semana_ref DESC);

-- ---------------------------------------------------------------- 5. histórico

ALTER TABLE evento_historico DROP CONSTRAINT evento_historico_tipo_check;
ALTER TABLE evento_historico ADD CONSTRAINT evento_historico_tipo_check
  CHECK (tipo IN ('MUDANCA_STATUS', 'DECISAO_COMITE', 'PLANO_ACAO', 'ALERTA', 'IMPORTACAO', 'OUTRO',
                  'MUDANCA_CRITICIDADE', 'RESTRITIVOS'));

-- ---------------------------------------------------------------- 6. andamento dos planos

ALTER TABLE plano_acao
  ADD COLUMN concluido_em   TIMESTAMPTZ,
  ADD COLUMN atualizado_em  TIMESTAMPTZ,
  ADD COLUMN atualizado_por TEXT;
CREATE INDEX plano_data_limite ON plano_acao (data_limite) WHERE status <> 'CONCLUIDO';

-- ---------------------------------------------------------------- 7. classificação semanal

-- Prioridade, enquadramento, criticidade e alertas calculados pelas regras do
-- sistema na confirmação da importação — uma linha por cliente e semana,
-- imutável como o snapshot que a originou.
CREATE TABLE classificacao_semanal (
  cliente_id          TEXT NOT NULL REFERENCES cliente (id),
  semana_ref          DATE NOT NULL,
  prioridade_ordem    SMALLINT NOT NULL CHECK (prioridade_ordem IN (1, 2, 3, 4, 9)),
  enquadramento       TEXT NOT NULL CHECK (enquadramento IN ('ENQUADRADO', 'DESENQUADRADO', 'APARTADO')),
  criticidade         TEXT NOT NULL CHECK (criticidade IN ('CRITICO', 'ATENCAO', 'REGULAR', 'APARTADO')),
  tendencia_liquidez  TEXT NOT NULL CHECK (tendencia_liquidez IN ('ESTAVEL', 'SEM_BASE', 'QUEDA_SIGNIFICATIVA', 'QUEDA_CONTINUA')),
  qtd_alertas         INT NOT NULL,
  alertas             JSONB NOT NULL,
  motivos_enquadramento JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, semana_ref)
);
CREATE INDEX classificacao_semana ON classificacao_semanal (semana_ref);
CREATE TRIGGER classificacao_append_only BEFORE UPDATE OR DELETE ON classificacao_semanal
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- Limiares das regras de classificação e dos avisos de qualidade — editáveis
-- pelo administrador em Cadastros e Configurações. Valores iniciais iguais às
-- regras da base do comitê.
CREATE TABLE regra_classificacao (
  chave         TEXT PRIMARY KEY,
  grupo         TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  valor         NUMERIC(18,4) NOT NULL CHECK (valor >= 0),
  unidade       TEXT NOT NULL CHECK (unidade IN ('%', 'R$', 'p.p.')),
  ordem         INT NOT NULL,
  atualizado_em TIMESTAMPTZ,
  atualizado_por TEXT
);
