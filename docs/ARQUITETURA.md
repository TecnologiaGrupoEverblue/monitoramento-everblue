# Arquitetura

## Visão geral

```text
navegador ──443──> nginx ──┬── /assets, /, rotas da SPA ──> build estático do React
                           └── /api, /entrar/entra, /oauth ──> api (Fastify, :3000)
                                                              ├── PostgreSQL 16 (db)
                                                              ├── MinIO (arquivos)
                                                              ├── Entra ID (OIDC, Graph)
                                                              └── Intranet (/api/access/v1/me)
```

## Camadas (SOLID)

| Camada | Onde | Responsabilidade |
|---|---|---|
| Domínio | `backend/dominio` | Tipos, regras puras (motor de alertas, checklist, transacional), contratos da API. Sem I/O. Compartilhado por web e api. |
| Casos de uso | `backend/api/src/servicos` | Carteira, checklist, comitê/ata, decisão, importação. Dependem de interfaces. |
| Repositórios | `backend/api/src/repositorios` | SQL parametrizado, colunas por lista branca, `ORDER BY` determinístico. |
| Identidade | `backend/api/src/identidade` | Entra (OIDC+PKCE), Graph, Intranet, login, revalidação de acesso. |
| Infra | `backend/api/src/infra` | Pool do banco, migrador, armazenamento S3/MinIO, bootstrap. |
| HTTP | `backend/api/src/http` | Rotas, sessão, autorização por perfil, erros RFC 9457. |
| Composição | `backend/api/src/composicao.ts` | ÚNICO ponto que instancia implementações concretas. |

Troca de provedor (ex.: outro S3) = nova implementação de
`ArmazenamentoArquivos`, sem tocar em caso de uso.

## Autenticação e autorização (igual à IA Everblue)

1. `GET /entrar/entra` → Entra ID com PKCE, `state` e `nonce` em cookie assinado
   (`emon_oidc`, 10 min). Escopo: `openid profile email` — só identidade.
2. `GET /oauth/oidc/callback` → troca do código no servidor, validação do
   `id_token` pelas chaves (JWKS) do tenant.
3. Intranet `GET /api/access/v1/me` decide acesso e departamento, por
   **chamada interna assinada (HMAC-SHA256)**: Client ID + `oid` do ID token +
   horário + nonce, com chave exclusiva do Monitoramento derivada na Intranet
   (`DIRETORIO_INTEGRATION_SECRET`). O `oid` da resposta é conferido contra o
   do token. Negado → sai; Intranet indisponível → **nunca** vira permissão.
4. Graph (app-only, `User.Read.All`) completa nome, e-mail, cargo e foto.
5. Grupos do token → perfil (`ENTRA_MAPA_PERFIL`), sem rebaixar.
6. Sessão: cookie `emon_sessao` (JWT HS256, HttpOnly, Secure, SameSite=Lax).
   O usuário é relido do banco a cada requisição; o acesso é **revalidado na
   Intranet a cada 5 minutos**, entre servidores, com a mesma assinatura —
   sem ida ao Entra, senha ou MFA. **Nenhum token delegado é guardado**
   (a migração 0003 apagou os de versões anteriores). Negativa desativa a
   pessoa (todas as sessões); Intranet fora do ar por mais de 5 min encerra a
   sessão, salvo `DIRETORIO_GRACA_MINUTOS`.
7. Conta de emergência (argon2) em `/entrar/emergencia`, auditada como `excecao`.

Perfis: `leitor` (consulta) < `analista` (importa, checklist, decisões, atas)
< `gestor` < `admin` (configurações de alerta).

## Dados

- **PostgreSQL**: `NUMERIC(18,2)` para dinheiro, `NUMERIC(9,4)` para
  percentuais; snapshots, histórico, atas, auditoria e arquivos **append-only**
  por gatilho; migrações com checksum e trava consultiva (não rodam em paralelo).
- A aplicação conecta com o papel `emon_app` (dono do banco, **não** superusuário).
- **MinIO**: repositório central de **todos** os arquivos — ver a seção abaixo.
  Não é backup.

## Arquivos (MinIO) — ciclo de vida completo

Todo arquivo que entra ou sai do Monitoramento fica no MinIO, sem restrição de
tipo nem de tamanho (limite opcional: `ARQUIVOS_MAX_MB`, padrão 0 = sem limite).

| Finalidade | Exemplos | Prefixo no bucket |
|---|---|---|
| `importado` | planilha semanal, extratos, bases recebidas | `importados/` |
| `processado` | atas, relatórios, resultados de processamento | `processados/` |
| `exportado` | CSV da carteira, planos de ação (gerados pelo servidor) | `exportados/` |
| `anexo` | contratos, evidências, documentos de clientes | `anexos/` |

Chave do objeto gerada pelo sistema: `<prefixo>/<categoria>/<aaaa>/<mm>/<id>/v<n>.<ext>`
— nunca o nome original. Cada versão é um objeto próprio.

```text
          ┌──────────── nova versão / restaurar versão ───────────┐
          ▼                                                       │
 envio → ATIVO ⇄ ARQUIVADO                                        │
          │  ▲       │                                            │
 excluir  ▼  │ reativar                                           │
        EXCLUIDO ◄───┘   (lógico: conteúdo intacto, recuperável)  │
          │                                                       │
 expurgar ▼  (admin, com motivo; recusado se houver retenção)     │
        EXPURGADO        (todas as versões apagadas do MinIO; metadados e trilha ficam)
```

- **Metadados** no PostgreSQL (`arquivo`): finalidade, categoria, descrição,
  etiquetas, vínculo com a entidade (cliente, importação, comitê…), correlação
  de origem (importado → processado/exportado), retenção, tipo REAL detectado
  pelo conteúdo, tamanho e SHA-256.
- **Versões** (`arquivo_versao`) e **trilha** (`arquivo_evento`) append-only:
  envio, nova versão, restauração, download, alteração de dados, arquivamento,
  exclusão, reativação e expurgo — com autor e horário. Operações que mudam
  estado também vão para `auditoria`.
- **Fluxo**: upload e download passam em stream (multipart de 16 MB para o
  MinIO). Memória da API constante qualquer que seja o tamanho — medido: 300 MB
  enviados com pico de ~244 MB de RSS no processo.
- **Download** sempre como anexo com `nosniff`; PDF e imagens podem ser
  visualizados no navegador. Qualquer versão pode ser baixada.
- **Permissões na aplicação**: leitor consulta e baixa; analista envia,
  versiona, edita, arquiva, exclui e reativa; admin expurga.
- **Credencial da aplicação no MinIO**: `s3:*` no bucket dela (ciclo de vida
  inteiro). Administração do servidor MinIO fica com a credencial raiz.
- Versionamento do bucket ligado (proteção extra). Object Lock opcional
  (`MINIO_OBJECT_LOCK`), desligado por padrão — com ele ligado, objetos retidos
  não podem ser expurgados.
- Novas exportações entram registrando um `Exportador` na composição
  (`servicoExportacao.ts`), sem alterar o núcleo.

## Importação semanal

1. Upload (multipart, limite `IMPORTACAO_MAX_MB`), tipo detectado pelo
   **conteúdo** (não pela extensão), original gravado no MinIO.
2. Leitura e validação no servidor; CNPJ repetido vai para a lista de erros.
3. Prévia guardada por id; confirmação em transação com `FOR UPDATE` —
   segunda confirmação devolve `409`.
4. **Qualidade do dado (1.1)**: texto em campo numérico recusa a linha (antes
   virava 0); IL vazio ou "SEM BASE" é gravado como ausente (`NULL`); avisos
   não bloqueantes na prévia — tranche/limite simbólico (≤ R$ 1.000), salto de
   risco acima do limiar frente à posição anterior, documento novo.
5. **Vários CNPJs por cliente (1.1)**: a célula aceita uma lista (`;` ou `,`);
   o primeiro é o principal (`cliente.cnpj`); todos ficam em
   `cliente_documento` (único por documento). O cliente é reconhecido por
   qualquer um deles; documentos de clientes diferentes na mesma linha
   recusam a linha.
6. **Carteira (1.1)**: coluna opcional `Carteira`; carteira **apartada**
   (ex.: QUATTUOR) fica fora do dashboard, da ata, da pauta e do painel da
   diretoria, salvo filtro explícito.
7. **Classificação semanal (1.1)**: na confirmação, cada cliente recebe
   prioridade (1-Jurídico … 4-Normal, 9-apartada), enquadramento,
   criticidade, tendência da liquidez e alertas — pelas regras da base do
   comitê (`backend/dominio/src/regras/classificacao.ts`), com limiares em
   `regra_classificacao` (Cadastros). Grava `classificacao_semanal`
   (append-only) e atualiza prioridade/criticidade do cliente. Unidade de
   análise: grupo econômico consolidado (`riscoGrupo`), como na base.
   Conferência contra as 106 linhas da base de 24/09/2026: prioridade 106,
   criticidade 106, alertas 105, tendência 105, enquadramento 100 (o
   enquadramento da base tem julgamento manual em 6 casos).
8. **Restritivos por tipo (1.1)**: colunas opcionais `Pefin (qtd)`,
   `Pefin (R$)`, … ou lançamento na ficha; piora gera alerta e evento.

## Comitê (1.1)

- Plano com prazo vencido vira `ATRASADO` sozinho; andamento (feito / não
  feito / prazo / responsável / concluir / reabrir) por `PATCH /api/v1/planos/:id`,
  com evento e auditoria.
- Pauta automática do próximo comitê (`GET /api/v1/comites/proximo/pauta`):
  plano atrasado ou vencendo até a data do comitê, crítico, alerta vermelho
  novo, piora de restritivos, mudança de status.
- A ata traz, por cliente, status atual, praça de pagamento, evolução do
  quadro restritivo e transacional (pareceres do checklist da semana do
  comitê), decisões anterior e atual, plano, responsável, feito/não feito e a
  classificação.
- Painel semanal da diretoria (`GET /api/v1/dashboard/painel-semanal`):
  críticos, vencido, consumo do limite e planos atrasados, com comparação à
  semana anterior.

## Segurança

- CSP sem terceiros, HSTS, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy (nginx).
- Checagem de `Origin` em métodos que alteram estado; limites de taxa no nginx
  e na API; `Cache-Control: no-store` em `/api`.
- Contêiner da API somente leitura, sem capacidades, usuário sem privilégio;
  credenciais raiz do banco e do MinIO **não** entram no contêiner da API.

## Front

React 19 + Vite + Tailwind 4 na identidade visual Everblue (fundo azul-marinho
em degradê, menu de 240 px, violeta `#7C3AED` para ações, dourado `#DFBF7D` de
acento, DM Sans / Plus Jakarta Sans / JetBrains Mono servidas localmente).
Toda cor passa por variáveis CSS (`frontend/src/index.css`).
