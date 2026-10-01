# Monitoramento Everblue

Gestão semanal do **Comitê de Monitoramento do FIDC**: carteira de cedentes,
importação semanal da posição, alertas automáticos, checklist de análise,
decisões e planos de ação, atas, saída de risco, jurídico e IASR.

Padrão de desenvolvimento Everblue: **React · Node · PostgreSQL · MinIO**, tudo
em Docker. Identidade visual Everblue; login **idêntico ao da IA Everblue** (Entra
ID + autorização na Intranet por chamada interna assinada — HMAC, como a IA).

## Estrutura

```text
everblue-monitoramento/
├── frontend/         Aplicação web React 19 + Vite + Tailwind 4: telas e componentes
├── backend/          Regras de negócio, integrações, segurança, jobs e testes
│   ├── api/          Node 22 + Fastify 5 + TypeScript: API REST, autenticação e CLI
│   └── dominio/      Tipos, regras puras e contratos — compartilhados por frontend e api
├── database/         Esquema PostgreSQL: migrações versionadas e criação do papel da aplicação
├── infrastructure/   Docker Compose, imagens, nginx, MinIO e roteiros operacionais
└── docs/             Arquitetura, rede e Entra ID, instalação e operação
```

| Serviço      | Papel                                                            | Memória |
|--------------|------------------------------------------------------------------|---------|
| `nginx`      | TLS, front estático, proxy para a API, cabeçalhos de segurança   | 192 MB  |
| `api`        | API REST `/api/v1`, login OIDC, sessão, regras de negócio        | 1 GB    |
| `migracao`   | Execução única: migrações + bootstrap idempotente                | 512 MB  |
| `db`         | PostgreSQL 16                                                    | 2,5 GB  |
| `minio`      | Repositório central de TODOS os arquivos (ciclo de vida completo) | 1 GB    |
| `minio-init` | Execução única: bucket, versionamento, usuário de política mínima | —       |

Só o `nginx` publica portas (80 → 443). Banco e MinIO ficam na rede interna do
Docker.

## Primeira subida na VM

Requisitos: Ubuntu 24.04, Docker Engine + plugin Compose, `openssl`, `curl`.
Instalação em `/opt/everblue-monitoramento/app`, dados em
`/opt/everblue-monitoramento/dados`.

```bash
# Se o código veio por cópia do Windows (e não por git), restaure permissão e LF:
chmod +x infrastructure/scripts/*.sh infrastructure/minio/*.sh database/init/*.sh
sed -i 's/\r$//' infrastructure/scripts/*.sh infrastructure/minio/*.sh database/init/*.sh

./infrastructure/scripts/verificar_requisitos.sh   # só lê: diz o que falta na VM
sudo -E ./infrastructure/scripts/instalar_docker.sh # se a VM ainda não tiver Docker
./infrastructure/scripts/preparar.sh        # .env com segredos gerados no servidor
sudo bash infrastructure/scripts/configurar_entra.sh    # ENTRA_* e grupos → perfil
sudo bash infrastructure/scripts/conectar_intranet.sh   # chave HMAC da Intranet (DIRETORIO_*)
./infrastructure/scripts/certificado.sh csr # chave no servidor + pedido para a AC interna
#   (para testar antes da AC: certificado.sh autoassinado)
./infrastructure/scripts/implantar.sh       # build, migração, subida, saúde e rotas
./infrastructure/scripts/conta_emergencia.sh
./infrastructure/scripts/verificar.sh       # evidência do estado final
```

Roteiros prontos: `infrastructure/windows/{INSTALAR-MONITORAMENTO,CONFIGURAR-LOGIN-ENTRA,ATUALIZAR-E-CONECTAR-INTRANET,DIAGNOSTICAR-LOGIN,ENVIAR-PARA-GIT}.cmd`, `enviar_para_vm.ps1` (envia e instala) e `infrastructure/servidor/{instalar,atualizar,retornar}.sh`. Passo a passo completo da VM em [docs/INSTALACAO.md](docs/INSTALACAO.md); operação em [docs/OPERACAO.md](docs/OPERACAO.md). Pedido de rede, DNS e
App Registration em [docs/REDE-E-ENTRA.md](docs/REDE-E-ENTRA.md).

## Desenvolvimento local

Node ≥ 22.12, PostgreSQL 16 e um MinIO (ou compatível S3) locais.

```bash
npm ci
cp .env.example .env     # ajuste DATABASE_URL, MINIO_*, URL_PUBLICA=http://localhost:5173,
                         # AMBIENTE=desenvolvimento, COOKIE_SEGURO=false
npm run cli -w @monitoramento/api -- migrar
npm run cli -w @monitoramento/api -- carga-demonstracao   # dados fictícios (recusado em produção)
npm run dev:api          # http://localhost:3000
npm run dev:web          # http://localhost:5173 (proxy de /api, /entrar/entra e /oauth)
npm run verify           # typecheck + lint + testes + build
```

Testes de integração do banco usam `TESTE_DATABASE_URL` (base descartável).

## Regras que não se negociam

- **MinIO não é backup.** É o repositório central de todos os arquivos —
  importados, processados, exportados e anexos — com ciclo de vida completo
  (versões, arquivamento, exclusão lógica, restauração, expurgo). Backup de
  `DADOS_DIR` (postgres e minio) segue o processo corporativo.
- **Nunca** `docker compose down -v`, nunca apagar `DADOS_DIR`, nunca resetar o banco.
- **Nunca** versionar `.env`, chaves, certificados, dumps ou backups.
- A chave privada TLS é gerada **no servidor** e não sai dele.
- Snapshots semanais, histórico, atas, auditoria, versões e trilha de arquivos
  são **append-only** (gatilhos no banco).
- Produção só com autorização explícita.
