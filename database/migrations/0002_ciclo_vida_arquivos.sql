-- =============================================================================
-- 0002 — Ciclo de vida completo dos arquivos (MinIO)
-- =============================================================================
-- O MinIO é o repositório central de TODOS os arquivos do Monitoramento:
-- importados, processados, exportados e anexos. Cada arquivo percorre um ciclo
-- de vida completo — envio, novas versões, metadados, arquivamento, exclusão
-- lógica, restauração e expurgo definitivo — e cada passo fica registrado.
--
-- Migração ADITIVA: nenhum dado existente é perdido. Os arquivos já gravados
-- viram "versão 1" do seu próprio histórico.
--
-- `arquivo` deixa de ser append-only (situação e versão atual mudam ao longo
-- da vida). A imutabilidade passa para `arquivo_versao` (cada conteúdo enviado)
-- e `arquivo_evento` (trilha do ciclo de vida), ambas append-only.

DROP TRIGGER IF EXISTS arquivo_append_only ON arquivo;

ALTER TABLE arquivo DROP CONSTRAINT IF EXISTS arquivo_finalidade_check;
ALTER TABLE arquivo
  ADD CONSTRAINT arquivo_finalidade_check
  CHECK (finalidade IN ('importado', 'processado', 'exportado', 'anexo'));

ALTER TABLE arquivo
  ADD COLUMN situacao          TEXT NOT NULL DEFAULT 'ATIVO'
                               CHECK (situacao IN ('ATIVO', 'ARQUIVADO', 'EXCLUIDO', 'EXPURGADO')),
  ADD COLUMN versao_atual      INTEGER NOT NULL DEFAULT 1 CHECK (versao_atual >= 1),
  ADD COLUMN descricao         TEXT,
  ADD COLUMN tags              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Vínculo com a entidade de negócio (cliente, comitê, importação, plano...).
  ADD COLUMN recurso_tipo      TEXT,
  ADD COLUMN recurso_id        TEXT,
  -- Correlação importado → processado/exportado.
  ADD COLUMN arquivo_origem_id UUID REFERENCES arquivo (id),
  -- Retenção obrigatória: enquanto vigente, o expurgo é recusado.
  ADD COLUMN retencao_ate      DATE,
  ADD COLUMN atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN atualizado_por    UUID REFERENCES usuario (id),
  ADD COLUMN excluido_em       TIMESTAMPTZ,
  ADD COLUMN excluido_por      UUID REFERENCES usuario (id),
  ADD COLUMN motivo_exclusao   TEXT;

CREATE INDEX arquivo_situacao   ON arquivo (situacao, criado_em DESC);
CREATE INDEX arquivo_finalidade ON arquivo (finalidade, criado_em DESC);
CREATE INDEX arquivo_recurso    ON arquivo (recurso_tipo, recurso_id) WHERE recurso_tipo IS NOT NULL;
CREATE INDEX arquivo_origem     ON arquivo (arquivo_origem_id) WHERE arquivo_origem_id IS NOT NULL;
CREATE INDEX arquivo_nome_busca ON arquivo (lower(nome_original) text_pattern_ops);

-- Cada conteúdo enviado é uma versão própria, com objeto próprio no bucket.
-- O histórico não depende do versionamento do MinIO (que continua ligado como
-- proteção extra contra sobrescrita e exclusão acidental).
CREATE TABLE arquivo_versao (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id      UUID NOT NULL REFERENCES arquivo (id),
  numero          INTEGER NOT NULL CHECK (numero >= 1),
  chave_objeto    TEXT NOT NULL UNIQUE,
  id_versao_minio TEXT,
  nome_original   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  tamanho_bytes   BIGINT NOT NULL CHECK (tamanho_bytes >= 0),
  sha256          TEXT NOT NULL,
  comentario      TEXT,
  criado_por      UUID REFERENCES usuario (id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT arquivo_versao_unica UNIQUE (arquivo_id, numero)
);
CREATE TRIGGER arquivo_versao_append_only BEFORE UPDATE OR DELETE ON arquivo_versao
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- Trilha do ciclo de vida (quem fez o quê, quando e por quê).
CREATE TABLE arquivo_evento (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id  UUID NOT NULL REFERENCES arquivo (id),
  acao        TEXT NOT NULL,
  versao      INTEGER,
  ator_id     UUID REFERENCES usuario (id),
  ator_nome   TEXT,
  detalhes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX arquivo_evento_arquivo ON arquivo_evento (arquivo_id, criado_em);
CREATE TRIGGER arquivo_evento_append_only BEFORE UPDATE OR DELETE ON arquivo_evento
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- Arquivos já existentes: versão 1 e evento de origem.
INSERT INTO arquivo_versao (arquivo_id, numero, chave_objeto, nome_original, mime, tamanho_bytes, sha256, criado_por, criado_em)
SELECT id, 1, chave_objeto, nome_original, mime, tamanho_bytes, sha256, criado_por, criado_em FROM arquivo;

INSERT INTO arquivo_evento (arquivo_id, acao, versao, ator_id, detalhes, criado_em)
SELECT id, 'enviado', 1, criado_por, jsonb_build_object('migrado', true), criado_em FROM arquivo;

UPDATE arquivo a SET recurso_tipo = 'importacao', recurso_id = i.id::text
  FROM importacao i WHERE i.arquivo_id = a.id AND a.recurso_tipo IS NULL;
