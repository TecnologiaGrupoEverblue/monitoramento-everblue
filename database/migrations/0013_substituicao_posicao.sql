-- 0013 — A última foto gravada como posição vale até a ata do comitê (ADR-023, 1.4.2).
--
-- Antes: uma posição por cliente e semana, e a PRIMEIRA foto gravada ficava.
-- Agora: uma nova foto com "gravar posição" substitui a posição da mesma
-- semana enquanto o comitê dessa data não tiver ata (status REALIZADO).
--
-- Nada some: a posição substituída vai para uma tabela de histórico
-- append-only antes de sair, com a importação que a substituiu. A exclusão só
-- é aceita na sessão de substituição (SET LOCAL monitoramento.substituicao_posicao
-- = 'on'), e nunca para semana de comitê com ata. UPDATE continua proibido.

CREATE TABLE snapshot_semanal_substituido (LIKE snapshot_semanal INCLUDING DEFAULTS);
ALTER TABLE snapshot_semanal_substituido
  ADD COLUMN substituido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN substituido_por_importacao UUID NOT NULL;
CREATE INDEX snapshot_substituido_cliente ON snapshot_semanal_substituido (cliente_id, semana_ref);
CREATE TRIGGER snapshot_substituido_append_only BEFORE UPDATE OR DELETE ON snapshot_semanal_substituido
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE TABLE classificacao_semanal_substituida (LIKE classificacao_semanal INCLUDING DEFAULTS);
ALTER TABLE classificacao_semanal_substituida
  ADD COLUMN substituido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN substituido_por_importacao UUID NOT NULL;
CREATE INDEX classificacao_substituida_cliente ON classificacao_semanal_substituida (cliente_id, semana_ref);
CREATE TRIGGER classificacao_substituida_append_only BEFORE UPDATE OR DELETE ON classificacao_semanal_substituida
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_historico();

CREATE OR REPLACE FUNCTION proteger_posicao_semanal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('monitoramento.substituicao_posicao', true) = 'on'
     AND NOT EXISTS (SELECT 1 FROM comite WHERE data = OLD.semana_ref AND status = 'REALIZADO') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é append-only: % não é permitido.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER snapshot_append_only ON snapshot_semanal;
CREATE TRIGGER snapshot_append_only BEFORE UPDATE OR DELETE ON snapshot_semanal
  FOR EACH ROW EXECUTE FUNCTION proteger_posicao_semanal();

DROP TRIGGER classificacao_append_only ON classificacao_semanal;
CREATE TRIGGER classificacao_append_only BEFORE UPDATE OR DELETE ON classificacao_semanal
  FOR EACH ROW EXECUTE FUNCTION proteger_posicao_semanal();
