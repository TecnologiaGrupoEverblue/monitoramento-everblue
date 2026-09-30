-- 0001 — Estrutura inicial do EverBlue Monitoramento
--
-- Tradução relacional do modelo de domínio (packages/dominio/src/models/types.ts)
-- que o protótipo guardava no IndexedDB do navegador.
--
-- Três decisões que valem para o esquema inteiro:
--
-- 1. Valores monetários são NUMERIC(18,2) e percentuais NUMERIC(9,4). Nunca
--    ponto flutuante no banco: o arredondamento binário de um float somado em
--    milhares de linhas aparece como centavo sobrando na ata do comitê.
-- 2. Histórico é append-only NO BANCO, não só na aplicação: snapshots,
--    eventos, atas e auditoria recusam UPDATE/DELETE por gatilho. Um bug ou
--    um acesso indevido na aplicação não consegue reescrever o passado.
-- 3. Identificadores das entidades de negócio são TEXT (prefixo + aleatório),
--    compatíveis com os que o protótipo já gerava — assim a carga de
--    demonstração e qualquer exportação antiga continuam casando.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- utilitários

CREATE OR REPLACE FUNCTION recusar_alteracao_historico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é append-only: % não é permitido.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------- identidade

CREATE TABLE usuario (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   TEXT NOT NULL,
  nome                    TEXT NOT NULL,
  cargo                   TEXT,
  perfil                  TEXT NOT NULL DEFAULT 'leitor'
                          CHECK (perfil IN ('leitor', 'analista', 'gestor', 'admin')),
  origem                  TEXT NOT NULL DEFAULT 'entra' CHECK (origem IN ('entra', 'local')),
  ativo                   BOOLEAN NOT NULL DEFAULT TRUE,
  entra_oid               TEXT UNIQUE,
  entra_grupos            JSONB NOT NULL DEFAULT '[]'::jsonb,
  departamento_externo_id TEXT,
  departamento_nome       TEXT,
  -- Conta local: existe só como saída de emergência. `motivo_acesso_local`
  -- é a declaração de por que ela pode entrar por senha, e ninguém a reescreve.
  senha_hash              TEXT,
  motivo_acesso_local     TEXT,
  tentativas_falhas       INT NOT NULL DEFAULT 0,
  bloqueado_ate           TIMESTAMPTZ,
  -- Token DELEGADO do Entra (escopo access_as_user da API de identidade),
  -- cifrado. Serve apenas para reperguntar ao /api/access/v1/me da Intranet
  -- durante a sessão. Refresh token nunca é guardado.
  entra_token_cifrado     TEXT,
  entra_token_expira_em   TIMESTAMPTZ,
  autorizado_em           TIMESTAMPTZ,
  ultimo_acesso_em        TIMESTAMPTZ,
  sincronizado_em         TIMESTAMPTZ,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuario_email_unico ON usuario (lower(email));

CREATE TABLE auditoria (
  id             BIGSERIAL PRIMARY KEY,
  em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ator_id        UUID,
  ator_email     TEXT,
  acao           TEXT NOT NULL,
  resultado      TEXT NOT NULL DEFAULT 'sucesso'
                 CHECK (resultado IN ('sucesso', 'negado', 'falha', 'excecao')),
  recurso_tipo   TEXT,
  recurso_id     TEXT,
  origem_ip      TEXT,
  correlation_id TEXT,
  motivo         TEXT,
  detalhes       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX auditoria_em ON auditoria (em DESC);
CREATE INDEX auditoria_acao ON auditoria (acao, em DESC);
CREATE TRIGGER auditoria_append_only BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- ---------------------------------------------------------------- cadastros

CREATE TABLE grupo_economico (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL
);
CREATE UNIQUE INDEX grupo_economico_nome_unico ON grupo_economico (lower(btrim(nome)));

CREATE TABLE gerente (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL,
  email TEXT
);
CREATE UNIQUE INDEX gerente_nome_unico ON gerente (lower(btrim(nome)));

CREATE TABLE plataforma (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL
);
CREATE UNIQUE INDEX plataforma_nome_unico ON plataforma (lower(btrim(nome)));

CREATE TABLE cliente (
  id                 TEXT PRIMARY KEY,
  nome               TEXT NOT NULL,
  cnpj               TEXT NOT NULL,
  cnpj_normalizado   TEXT GENERATED ALWAYS AS (regexp_replace(cnpj, '\D', '', 'g')) STORED,
  grupo_economico_id TEXT NOT NULL REFERENCES grupo_economico (id),
  gerente_id         TEXT NOT NULL REFERENCES gerente (id),
  plataforma_id      TEXT NOT NULL REFERENCES plataforma (id),
  setor              TEXT NOT NULL,
  ramo_atividade     TEXT NOT NULL,
  produtos           TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL CHECK (status IN ('NORMAL', 'MONITORAMENTO', 'SAIDA_DE_RISCO', 'JURIDICO')),
  prioridade         TEXT NOT NULL CHECK (prioridade IN ('BAIXA', 'MEDIA', 'ALTA')),
  criticidade        TEXT NOT NULL CHECK (criticidade IN ('NORMAL', 'ATENCAO', 'CRITICA')),
  responsavel        TEXT NOT NULL,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cliente_cnpj_unico ON cliente (cnpj_normalizado);
CREATE INDEX cliente_grupo ON cliente (grupo_economico_id);
CREATE INDEX cliente_gerente ON cliente (gerente_id);
CREATE INDEX cliente_plataforma ON cliente (plataforma_id);
CREATE INDEX cliente_status ON cliente (status);
CREATE INDEX cliente_produtos ON cliente USING GIN (produtos);

-- ---------------------------------------------------------------- posição semanal

CREATE TABLE snapshot_semanal (
  id                                 TEXT PRIMARY KEY,
  cliente_id                         TEXT NOT NULL REFERENCES cliente (id),
  semana_ref                         DATE NOT NULL,
  criado_em                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  importacao_id                      UUID,

  risco_cliente                      NUMERIC(18,2) NOT NULL,
  risco_grupo                        NUMERIC(18,2) NOT NULL,
  limite_global                      NUMERIC(18,2) NOT NULL,
  perc_consumo_limite                NUMERIC(9,4) NOT NULL,
  status_proposta                    TEXT NOT NULL CHECK (status_proposta IN ('EM_ANALISE', 'APROVADA', 'VENCIDA', 'REPROVADA')),
  validade_proposta                  DATE,
  tranche_consolidada                NUMERIC(18,2) NOT NULL,
  valor_em_andamento                 NUMERIC(18,2) NOT NULL,
  perc_consumo_tranche               NUMERIC(9,4) NOT NULL,
  status_tranche                     TEXT NOT NULL CHECK (status_tranche IN ('DENTRO_DO_LIMITE', 'PROXIMA_DO_LIMITE', 'EXCEDIDA')),

  vencido_oficial                    NUMERIC(18,2) NOT NULL,
  vencido_desde                      DATE,
  aging_carteira_dias                INT NOT NULL,
  prazo_medio_carteira_dias          INT NOT NULL,

  il30                               NUMERIC(9,4) NOT NULL,
  il60                               NUMERIC(9,4) NOT NULL,
  il90                               NUMERIC(9,4) NOT NULL,
  il120                              NUMERIC(9,4) NOT NULL,
  il150                              NUMERIC(9,4) NOT NULL,
  il180                              NUMERIC(9,4) NOT NULL,

  manifesto_perc_sem_atuacao         NUMERIC(9,4) NOT NULL,
  manifesto_inacessivel              NUMERIC(18,2) NOT NULL,
  manifesto_nao_confirma             NUMERIC(18,2) NOT NULL,
  manifesto_transacao_desconhecida   NUMERIC(18,2) NOT NULL,
  manifesto_lastro_inconsistente     NUMERIC(18,2) NOT NULL,
  manifesto_transacao_nao_concluida  NUMERIC(18,2) NOT NULL,

  liquidado_no_periodo               NUMERIC(18,2) NOT NULL,
  recompras                          NUMERIC(18,2) NOT NULL,
  motivo_recompra                    TEXT,
  perc_liquidado_no_prazo            NUMERIC(9,4) NOT NULL,
  atraso_medio_dias                  INT NOT NULL,

  restritivos                        INT NOT NULL,

  CONSTRAINT snapshot_um_por_semana UNIQUE (cliente_id, semana_ref)
);
CREATE INDEX snapshot_semana ON snapshot_semanal (semana_ref);
CREATE TRIGGER snapshot_append_only BEFORE UPDATE OR DELETE ON snapshot_semanal
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE TABLE movimento_conta_mensal (
  id              TEXT PRIMARY KEY,
  cliente_id      TEXT NOT NULL REFERENCES cliente (id),
  mes_ref         DATE NOT NULL,
  entradas        NUMERIC(18,2) NOT NULL,
  saidas          NUMERIC(18,2) NOT NULL,
  qtd_transacoes  INT NOT NULL,
  maior_pagamento NUMERIC(18,2) NOT NULL,
  CONSTRAINT movimento_um_por_mes UNIQUE (cliente_id, mes_ref)
);

-- ---------------------------------------------------------------- histórico e alertas

CREATE TABLE evento_historico (
  id                TEXT PRIMARY KEY,
  cliente_id        TEXT NOT NULL REFERENCES cliente (id),
  data              TIMESTAMPTZ NOT NULL,
  usuario           TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('MUDANCA_STATUS', 'DECISAO_COMITE', 'PLANO_ACAO', 'ALERTA', 'IMPORTACAO', 'OUTRO')),
  valor_anterior    TEXT,
  valor_novo        TEXT,
  justificativa     TEXT NOT NULL,
  decisao_comite_id TEXT
);
CREATE INDEX evento_cliente ON evento_historico (cliente_id, data DESC);
CREATE INDEX evento_data ON evento_historico (data DESC);
CREATE INDEX evento_tipo ON evento_historico (tipo);
CREATE TRIGGER evento_append_only BEFORE UPDATE OR DELETE ON evento_historico
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE TABLE alerta (
  id          TEXT PRIMARY KEY,
  cliente_id  TEXT NOT NULL REFERENCES cliente (id),
  tipo        TEXT NOT NULL,
  gravidade   TEXT NOT NULL CHECK (gravidade IN ('VERDE', 'AMARELO', 'VERMELHO')),
  data        TIMESTAMPTZ NOT NULL,
  descricao   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ABERTO', 'EM_TRATATIVA', 'RESOLVIDO')),
  responsavel TEXT NOT NULL
);
CREATE INDEX alerta_cliente ON alerta (cliente_id, data DESC);
CREATE INDEX alerta_abertos ON alerta (data DESC) WHERE status <> 'RESOLVIDO';

CREATE TABLE configuracao_alerta (
  id                 TEXT PRIMARY KEY,
  tipo               TEXT NOT NULL UNIQUE,
  descricao          TEXT NOT NULL,
  limiar             NUMERIC(18,4) NOT NULL,
  unidade            TEXT NOT NULL CHECK (unidade IN ('%', 'R$', 'dias')),
  gravidade_sugerida TEXT NOT NULL CHECK (gravidade_sugerida IN ('VERDE', 'AMARELO', 'VERMELHO')),
  ativo              BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------- comitê

CREATE TABLE comite (
  id            TEXT PRIMARY KEY,
  data          DATE NOT NULL,
  participantes TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL CHECK (status IN ('PLANEJADO', 'REALIZADO'))
);
CREATE INDEX comite_data ON comite (data DESC);
-- Um único comitê planejado por vez: é ele que a Importação e o Modo de
-- Revisão tomam como "próximo comitê".
CREATE UNIQUE INDEX comite_um_planejado ON comite (status) WHERE status = 'PLANEJADO';

CREATE TABLE plano_acao (
  id                     TEXT PRIMARY KEY,
  cliente_id             TEXT NOT NULL REFERENCES cliente (id),
  comite_origem_id       TEXT REFERENCES comite (id),
  decisao_anterior       TEXT,
  data_decisao_anterior  DATE,
  decisao_atual          TEXT NOT NULL,
  data_decisao_atual     DATE NOT NULL,
  prazo_regularizacao    DATE NOT NULL,
  plano                  TEXT NOT NULL,
  responsavel            TEXT NOT NULL,
  o_que_foi_feito        TEXT,
  o_que_nao_foi_feito    TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('EM_DIA', 'ATRASADO', 'CONCLUIDO')),
  data_limite            DATE NOT NULL,
  evidencias             TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX plano_cliente ON plano_acao (cliente_id);
CREATE INDEX plano_comite ON plano_acao (comite_origem_id);
CREATE INDEX plano_status ON plano_acao (status);

CREATE TABLE ata (
  id                  TEXT PRIMARY KEY,
  comite_id           TEXT NOT NULL UNIQUE REFERENCES comite (id),
  data_geracao        TIMESTAMPTZ NOT NULL,
  data_comite         DATE NOT NULL,
  participantes       TEXT[] NOT NULL DEFAULT '{}',
  resumo_executivo    JSONB NOT NULL,
  clientes_discutidos JSONB NOT NULL,
  pendencias          JSONB NOT NULL
);
CREATE TRIGGER ata_append_only BEFORE UPDATE OR DELETE ON ata
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- ---------------------------------------------------------------- saída de risco, IASR e jurídico

CREATE TABLE saida_de_risco (
  id                     TEXT PRIMARY KEY,
  cliente_id             TEXT NOT NULL REFERENCES cliente (id),
  data_entrada           DATE NOT NULL,
  motivo                 TEXT NOT NULL,
  risco_na_entrada       NUMERIC(18,2) NOT NULL,
  plano_saida            TEXT NOT NULL,
  prazo_esperado         DATE NOT NULL,
  responsavel            TEXT NOT NULL,
  liquidado_integralmente BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX saida_cliente ON saida_de_risco (cliente_id);

CREATE TABLE registro_iasr (
  id                   TEXT PRIMARY KEY,
  cliente_id           TEXT NOT NULL REFERENCES cliente (id),
  data_decisao         DATE NOT NULL,
  motivo               TEXT NOT NULL,
  risco_existente      NUMERIC(18,2) NOT NULL,
  indicadores_na_data  JSONB NOT NULL,
  decisao_comite_id    TEXT,
  gerente_id           TEXT NOT NULL,
  plataforma_id        TEXT NOT NULL,
  analista             TEXT NOT NULL,
  acompanhar_ate       DATE NOT NULL
);
CREATE INDEX iasr_cliente ON registro_iasr (cliente_id);

CREATE TABLE evento_iasr (
  id               TEXT PRIMARY KEY,
  registro_iasr_id TEXT NOT NULL REFERENCES registro_iasr (id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('INADIMPLENCIA_RELEVANTE', 'PROTESTO', 'RECUPERACAO_JUDICIAL', 'FALENCIA',
                                                 'DETERIORACAO_FINANCEIRA', 'RESTRITIVO_RELEVANTE', 'PROBLEMA_PUBLICO_CREDITO', 'OUTRO')),
  data             DATE NOT NULL,
  descricao        TEXT NOT NULL
);
CREATE INDEX evento_iasr_registro ON evento_iasr (registro_iasr_id);

CREATE TABLE juridico (
  id                   TEXT PRIMARY KEY,
  cliente_id           TEXT NOT NULL REFERENCES cliente (id),
  data_envio           DATE NOT NULL,
  motivo               TEXT NOT NULL,
  medida_adotada       TEXT NOT NULL,
  responsavel_juridico TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('EM_ANDAMENTO', 'ACORDO', 'ENCERRADO')),
  valor_recuperado     NUMERIC(18,2) NOT NULL,
  saldo                NUMERIC(18,2) NOT NULL,
  proximo_passo        TEXT NOT NULL,
  prazo                DATE NOT NULL,
  ultima_atualizacao   DATE NOT NULL
);
CREATE INDEX juridico_cliente ON juridico (cliente_id);

-- ---------------------------------------------------------------- checklist de análise

CREATE TABLE checklist_analise (
  id               TEXT PRIMARY KEY,
  cliente_id       TEXT NOT NULL REFERENCES cliente (id),
  semana_ref       DATE NOT NULL,
  item             TEXT NOT NULL,
  gravidade        TEXT NOT NULL CHECK (gravidade IN ('VERDE', 'AMARELO', 'VERMELHO')),
  gravidade_manual BOOLEAN NOT NULL DEFAULT FALSE,
  parecer          TEXT NOT NULL DEFAULT '',
  atualizado_em    TIMESTAMPTZ NOT NULL,
  atualizado_por   TEXT NOT NULL,
  CONSTRAINT checklist_um_por_item UNIQUE (cliente_id, semana_ref, item)
);

-- ---------------------------------------------------------------- arquivos (MinIO) e importação

-- Metadados de todo objeto guardado no MinIO. O objeto em si mora no bucket
-- com chave gerada pelo sistema; nome original, hash e autor ficam aqui.
CREATE TABLE arquivo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finalidade    TEXT NOT NULL CHECK (finalidade IN ('importado', 'processado')),
  categoria     TEXT NOT NULL,
  chave_objeto  TEXT NOT NULL UNIQUE,
  nome_original TEXT NOT NULL,
  mime          TEXT NOT NULL,
  tamanho_bytes BIGINT NOT NULL CHECK (tamanho_bytes >= 0),
  sha256        TEXT NOT NULL,
  criado_por    UUID REFERENCES usuario (id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX arquivo_categoria ON arquivo (categoria, criado_em DESC);
CREATE TRIGGER arquivo_append_only BEFORE UPDATE OR DELETE ON arquivo
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE TABLE importacao (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id       UUID NOT NULL REFERENCES arquivo (id),
  semana_ref       DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PREVIA' CHECK (status IN ('PREVIA', 'CONFIRMADA')),
  linhas_validas   JSONB NOT NULL,
  linhas_com_erro  JSONB NOT NULL,
  colunas_faltando TEXT[] NOT NULL DEFAULT '{}',
  totais           JSONB,
  criado_por       UUID NOT NULL REFERENCES usuario (id),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_por   UUID REFERENCES usuario (id),
  confirmado_em    TIMESTAMPTZ
);
CREATE INDEX importacao_criado_em ON importacao (criado_em DESC);

ALTER TABLE snapshot_semanal
  ADD CONSTRAINT snapshot_importacao_fk FOREIGN KEY (importacao_id) REFERENCES importacao (id);
