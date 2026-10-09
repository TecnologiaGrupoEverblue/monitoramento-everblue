-- 0007 — Formato da planilha importada (1.1.5).
--
-- Além do modelo oficial, a importação aceita a base do comitê ("Base Carteira
-- - Monitoramento", aba "Análise da Carteira"), convertida para o modelo antes
-- da validação. Fica registrado qual formato chegou e o resumo da conversão
-- (aba, cabeçalho, colunas não importadas), para a prévia e para a auditoria.
-- Aditiva: importações anteriores ficam como MODELO, sem observações.

ALTER TABLE importacao
  ADD COLUMN formato TEXT NOT NULL DEFAULT 'MODELO' CHECK (formato IN ('MODELO', 'BASE_COMITE')),
  ADD COLUMN observacoes TEXT[] NOT NULL DEFAULT '{}';
