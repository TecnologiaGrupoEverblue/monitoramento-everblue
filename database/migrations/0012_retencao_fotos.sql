-- 0012 (1.4.0) — Retenção das fotos do Bitfin (decisão de 05/11/2026, ADR-021).
--
-- "A foto grava em banco de dados, que alimenta os gráficos e etc. é para
-- sempre, não podemos apagar. A carga que fazemos de teste pode apagar depois
-- de 90 dias." Tradução em regra:
--
--   PERMANENTE (nunca apagada): foto que GRAVOU a posição do comitê, ou cuja
--   base gerou um Mapa de Garantias enviado (mapa_envio). Inclui a leitura
--   bruta no MinIO, o detalhe por cliente e a base do mapa.
--   TESTE (apagável depois de 90 dias): qualquer outra foto — conferência sem
--   posição, posição que já existia, recusada ou com falha.
--
-- O banco é a última barreira: as tabelas continuam append-only; o DELETE só
-- passa numa sessão de expurgo explícita (SET LOCAL monitoramento.expurgo_foto
-- = 'on') E para foto de teste com mais de 90 dias. Nenhuma configuração da
-- aplicação consegue baixar esse piso.

CREATE OR REPLACE FUNCTION foto_permanente(p_foto UUID) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM foto_execucao f WHERE f.id = p_foto AND f.posicao_semanal = 'GRAVADA')
      OR EXISTS (SELECT 1 FROM mapa_envio e WHERE e.foto_id = p_foto)
$$;

CREATE OR REPLACE FUNCTION foto_expurgavel(p_foto UUID) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('monitoramento.expurgo_foto', true), '') = 'on'
     AND EXISTS (
       SELECT 1 FROM foto_execucao f
        WHERE f.id = p_foto
          AND f.status <> 'EXECUTANDO'
          AND f.iniciado_em < now() - interval '90 days')
     AND NOT foto_permanente(p_foto)
$$;

-- Detalhe por cliente e base do mapa: append-only, salvo expurgo de teste.
CREATE OR REPLACE FUNCTION recusar_alteracao_foto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND foto_expurgavel(OLD.foto_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é append-only: % não é permitido (só expurgo de foto de teste com mais de 90 dias).', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS foto_cliente_append_only ON foto_cliente;
CREATE TRIGGER foto_cliente_append_only BEFORE UPDATE OR DELETE ON foto_cliente
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_foto();

DROP TRIGGER IF EXISTS foto_mapa_append_only ON foto_mapa;
CREATE TRIGGER foto_mapa_append_only BEFORE UPDATE OR DELETE ON foto_mapa
  FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_foto();

-- A execução em si: DELETE só no expurgo de teste.
CREATE OR REPLACE FUNCTION recusar_exclusao_foto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF foto_expurgavel(OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Foto do Bitfin não pode ser apagada (permanente ou com menos de 90 dias).'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER foto_execucao_sem_exclusao BEFORE DELETE ON foto_execucao
  FOR EACH ROW EXECUTE FUNCTION recusar_exclusao_foto();

-- Leitura bruta no MinIO (Central de Arquivos): não pode ser excluída nem
-- expurgada enquanto a foto for permanente ou tiver menos de 90 dias.
CREATE OR REPLACE FUNCTION proteger_arquivo_foto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao IS DISTINCT FROM OLD.situacao AND NEW.situacao IN ('EXCLUIDO', 'EXPURGADO')
     AND EXISTS (SELECT 1 FROM foto_execucao f
                  WHERE f.arquivo_id = NEW.id
                    AND (foto_permanente(f.id) OR f.iniciado_em >= now() - interval '90 days')) THEN
    RAISE EXCEPTION 'Leitura bruta de foto do Bitfin protegida (foto permanente ou com menos de 90 dias).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arquivo_foto_protegido BEFORE UPDATE OF situacao ON arquivo
  FOR EACH ROW EXECUTE FUNCTION proteger_arquivo_foto();

CREATE INDEX IF NOT EXISTS mapa_envio_foto ON mapa_envio (foto_id);
CREATE INDEX IF NOT EXISTS foto_execucao_anterior ON foto_execucao (foto_anterior_id);
CREATE INDEX IF NOT EXISTS foto_execucao_arquivo ON foto_execucao (arquivo_id);
