-- 0009 — Mapa de Garantias (1.2.0).
--
-- O especialista escolhe os clientes do mapa pelo CNPJ; a foto do Bitfin lê a
-- base deles (contas, títulos da Cobrança Vinculada, garantias, contas
-- gráficas e responsáveis) e o mapa é calculado e enviado por e-mail todos os
-- dias após a foto agendada: cada responsável recebe os seus clientes; os
-- e-mails em cópia recebem todos.
--
--   * mapa_cliente: clientes do mapa (incluir/excluir guarda quem e quando);
--   * mapa_copia: e-mails que recebem cópia;
--   * mapa_config_cliente: contas gráficas escolhidas e campos manuais
--     (deduções com justificativa, concentração excedida, sacado com restrição);
--   * foto_mapa: base do mapa lida em cada foto (append-only);
--   * mapa_envio: registro de cada e-mail (append-only).

CREATE TABLE mapa_cliente (
  documento      TEXT PRIMARY KEY CHECK (documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  nome           TEXT,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  incluido_por   UUID NOT NULL REFERENCES usuario (id),
  incluido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  removido_por   UUID REFERENCES usuario (id),
  removido_em    TIMESTAMPTZ
);

CREATE TABLE mapa_copia (
  email          TEXT PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  incluido_por   UUID NOT NULL REFERENCES usuario (id),
  incluido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  removido_por   UUID REFERENCES usuario (id),
  removido_em    TIMESTAMPTZ
);

CREATE TABLE mapa_config_cliente (
  documento        TEXT PRIMARY KEY REFERENCES mapa_cliente (documento),
  contas_graficas  INT[],
  deducoes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  concentracao     JSONB,
  restricao        JSONB,
  atualizado_por   UUID NOT NULL REFERENCES usuario (id),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE foto_mapa (
  foto_id     UUID PRIMARY KEY REFERENCES foto_execucao (id),
  documentos  TEXT[] NOT NULL,
  dados       JSONB NOT NULL
);
CREATE TRIGGER foto_mapa_append_only BEFORE UPDATE OR DELETE ON foto_mapa
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE TABLE mapa_envio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL,
  foto_id       UUID NOT NULL REFERENCES foto_execucao (id),
  origem        TEXT NOT NULL CHECK (origem IN ('AGENDADO', 'MANUAL')),
  solicitado_por UUID NOT NULL REFERENCES usuario (id),
  destinatario  TEXT NOT NULL,
  papeis        TEXT[] NOT NULL,
  clientes      TEXT[] NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ENVIADO', 'FALHOU', 'NAO_ENVIADO')),
  mensagem      TEXT,
  arquivo_id    UUID REFERENCES arquivo (id),
  em            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mapa_envio_em ON mapa_envio (em DESC);
CREATE INDEX mapa_envio_lote ON mapa_envio (lote_id);
CREATE TRIGGER mapa_envio_append_only BEFORE UPDATE OR DELETE ON mapa_envio
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

-- Envio diário: uma linha só, controla o "uma vez por dia".
CREATE TABLE mapa_agendamento (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_envio_dia   DATE,
  atualizado_por     UUID REFERENCES usuario (id),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO mapa_agendamento (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
