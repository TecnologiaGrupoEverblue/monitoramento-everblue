-- =============================================================================
-- 0003 — Autorização pela Intranet por assinatura interna (HMAC)
-- =============================================================================
-- Desde a 1.0.2 o Monitoramento pergunta à Intranet (/api/access/v1/me) com
-- uma chamada ASSINADA entre servidores — o mesmo modelo da IA Everblue. O
-- token delegado `access_as_user` deixou de ser pedido ao Entra e deixou de
-- ser guardado.
--
-- Esta migração apaga os tokens delegados de versões anteriores (menos
-- credencial em repouso) e zera `autorizado_em`, para que a próxima requisição
-- de cada sessão aberta repergunte à Intranet pelo caminho novo.
--
-- As colunas ficam (expansão/contração): a remoção é etapa posterior, depois
-- que nenhuma versão em uso as referenciar. Nenhum usuário é alterado além
-- desses três campos.

UPDATE usuario
   SET entra_token_cifrado = NULL,
       entra_token_expira_em = NULL,
       autorizado_em = NULL
 WHERE entra_token_cifrado IS NOT NULL
    OR entra_token_expira_em IS NOT NULL
    OR autorizado_em IS NOT NULL;

COMMENT ON COLUMN usuario.entra_token_cifrado IS 'Obsoleta desde 1.0.2 (autorização por HMAC). Sempre NULL; remover em migração futura.';
COMMENT ON COLUMN usuario.entra_token_expira_em IS 'Obsoleta desde 1.0.2 (autorização por HMAC). Sempre NULL; remover em migração futura.';
