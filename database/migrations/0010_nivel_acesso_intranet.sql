-- 0010 (1.2.4) — Perfil de acesso da Intranet (accessLevel do /api/access/v1/me).
--
-- A Intranet passou a devolver, para a pessoa logada, o perfil de acesso
-- corporativo: user (Analista), manager (Gerente), hr (Recursos Humanos),
-- director (Diretoria), support (Suporte), admin (Administrador). O
-- Monitoramento guarda o código (estável) e o nome (exibição) a cada login e
-- a cada revalidação. Ele decide quem vê Foto do Bitfin, Mapa de Garantias e
-- Parâmetros (NIVEIS_ACESSO_GESTAO). Sem valor (NULL) = sem acesso a essas
-- áreas (fail-closed).
ALTER TABLE usuario ADD COLUMN nivel_acesso_codigo TEXT
  CHECK (nivel_acesso_codigo IS NULL OR nivel_acesso_codigo ~ '^[a-z][a-z0-9_]{0,31}$');
ALTER TABLE usuario ADD COLUMN nivel_acesso_nome TEXT;
