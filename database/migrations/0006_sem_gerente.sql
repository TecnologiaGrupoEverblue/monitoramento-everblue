-- 0006 — Cliente sem gerente na base fica sob "Sem Gerente".
--
-- A importação de uma base com a coluna Gerente vazia criava um cadastro de
-- gerente de nome vazio — linha sem nome na Visão por Gerente. A partir da
-- 1.1.4 a importação já grava "Sem Gerente"; esta migração corrige o que já
-- foi importado:
--   * o gerente de nome vazio passa a se chamar "Sem Gerente" (ou, se esse
--     cadastro já existir, os clientes e registros de IASR são movidos para ele
--     e o vazio deixa de existir);
--   * o responsável vazio dos clientes passa a ser "Sem Gerente".
-- Idempotente: sem gerente vazio, não faz nada.

DO $$
DECLARE
  vazio TEXT;
  sem   TEXT;
BEGIN
  SELECT id INTO vazio FROM gerente WHERE btrim(nome) = '';
  IF vazio IS NOT NULL THEN
    SELECT id INTO sem FROM gerente WHERE lower(btrim(nome)) = 'sem gerente';
    IF sem IS NULL THEN
      UPDATE gerente SET nome = 'Sem Gerente' WHERE id = vazio;
    ELSE
      UPDATE cliente       SET gerente_id = sem WHERE gerente_id = vazio;
      UPDATE registro_iasr SET gerente_id = sem WHERE gerente_id = vazio;
      DELETE FROM gerente WHERE id = vazio;
    END IF;
  END IF;
END $$;

UPDATE cliente SET responsavel = 'Sem Gerente' WHERE btrim(responsavel) = '';
