-- 0005 — O que a classificação semanal NÃO pôde avaliar.
--
-- Dado ausente nunca é dado favorável: quando a importação não traz uma
-- informação usada pelas regras (ex.: prorrogações, operações), a ausência de
-- alerta não significa "sem problema". A classificação passa a registrar o que
-- ficou sem avaliação, para a tela mostrar "Não avaliado" em vez de silêncio.
--
-- Aditiva: linhas anteriores ficam com lista vazia (não se sabe o que faltou).

ALTER TABLE classificacao_semanal
  ADD COLUMN nao_avaliados JSONB NOT NULL DEFAULT '[]'::jsonb;
