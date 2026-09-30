# Rede, DNS, certificado e Entra ID

O que pedir à infraestrutura e ao administrador do tenant para colocar o
Monitoramento no ar. O modelo é **o mesmo da IA Everblue**: Entra ID autentica,
a Intranet autoriza, o endereço é restrito à rede interna.

> **Atualização 1.0.2 — mesma solução da IA Everblue (correção coordenada v20).**
> A pergunta à Intranet deixou de usar o token delegado `access_as_user`. Agora
> o `GET /api/access/v1/me` é uma **chamada interna assinada (HMAC-SHA256)**
> entre servidores: Client ID do Monitoramento + `oid` autenticado + horário +
> nonce, com uma **chave exclusiva do Monitoramento** derivada NA Intranet do
> segredo mestre dela (`ACCESS_API_MASTER_SECRET`, que nunca sai de lá).
> **Não é preciso expor a Intranet como API no Entra nem conceder
> `access_as_user`**; se essa permissão foi adicionada ao app do Monitoramento,
> pode ser removida. A Intranet recusa assinatura com mais de 90 s, nonce
> repetido e aplicação não cadastrada/inativa em Controle de Acessos.
>
> Alternativa, se a política exigir o mínimo de permissões no Graph:
> `FOTO_FONTE=intranet` (foto via `GET /api/access/v1/photo`, mesma assinatura)
> e `ENTRA_GRAPH_PERFIL=false` (nome, e-mail e cargo do cadastro da Intranet).
> Nesse caso **não é preciso nenhuma permissão do Graph** além do login.

---

## 1. Servidor

| Item | Valor |
|---|---|
| Sistema | Ubuntu Server 24.04 LTS |
| CPU / RAM | 4 vCPU / 8 GB |
| Disco do SO | 50 GB |
| Disco de dados | 150 GB montado em `/opt/everblue-monitoramento` |
| Swap | 4 GB |
| Software | Docker Engine + plugin Compose, `openssl`, `curl` |

## 2. DNS e certificado

- Registro **A** `monitoramento.grupoeverblue.com.br` → IP da VM, **somente na
  zona interna**. Nada na zona pública.
- Certificado emitido pela **AC interna** para `monitoramento.grupoeverblue.com.br`
  (SAN obrigatório). A chave é gerada **no servidor**:
  `./infrastructure/scripts/certificado.sh csr` — só o `.csr` vai para a AC.
- Ao receber o certificado: `./infrastructure/scripts/certificado.sh conferir`.

## 3. Firewall

| Origem | Destino | Porta | Observação |
|---|---|---|---|
| Rede interna e VPN | VM | 443/tcp | HTTPS — acesso normal |
| Rede interna e VPN | VM | 80/tcp | Só redireciona para 443 |
| Rede de administração | VM | 22/tcp | SSH |
| VM | `login.microsoftonline.com` | 443/tcp | Login OIDC e chaves de assinatura |
| VM | `graph.microsoft.com` | 443/tcp | Nome, e-mail, cargo e foto (se `FOTO_FONTE=graph`) |
| VM | Intranet (`https://intranet.grupoeverblue.com.br`) | 443/tcp | `GET /api/access/v1/me` assinado — autorização. A VM precisa resolver o nome no DNS interno (o mesmo da VM da IA) |
| VM | VM da Intranet (`192.168.0.250`) | 22/tcp | Só na configuração: `conectar_intranet.sh` deriva a chave lá, com o seu usuário |
| VM | `registry.npmjs.org` e registro de imagens | 443/tcp | Só no build (`implantar.sh`) |

O servidor **não recebe conexão da internet**. Se a saída passar por proxy,
preencher `HTTPS_PROXY`/`NO_PROXY` no `.env`.

## 4. App Registration "Monitoramento Everblue"

**Entra ID → App registrations → New registration**

| Campo | Valor |
|---|---|
| Name | `Monitoramento Everblue` |
| Supported account types | Single tenant |
| Redirect URI | **Web** — `https://monitoramento.grupoeverblue.com.br/oauth/oidc/callback` |

O tipo é **Web** (não SPA): a troca do código acontece no servidor, com segredo
de cliente, PKCE, `state` e `nonce`.

### 4.1 Client secret
Criar, anotar validade e responsável pela renovação. O valor vai **apenas** no
`.env` do servidor (`ENTRA_CLIENT_SECRET`).

### 4.2 Token configuration — claim de grupos
**Add groups claim → Security groups → ID: "Groups assigned to the application"**
(não "All groups": acima de 200 grupos o token chega sem nenhum, e a pessoa
entraria com o perfil mínimo). O claim traz GUIDs:

```
ENTRA_MAPA_PERFIL=<guid-comite-admin>=admin;<guid-gestores>=gestor;<guid-analistas>=analista
```

Perfis: `leitor` < `analista` < `gestor` < `admin`. Quem não cai em grupo
mapeado recebe `ENTRA_PERFIL_PADRAO` (leitor). O perfil nunca é rebaixado por
um login; `ADMIN_EMAIL` sempre entra como admin.

### 4.3 Enterprise application
**Properties → Assignment required = Yes** e, em **Users and groups**, atribuir
só os grupos do comitê/risco.

### 4.4 Permissões de API (consentimento de administrador)

| Permissão | Tipo | Para quê |
|---|---|---|
| `openid`, `profile`, `email` | Delegada | Identidade no token — QUEM a pessoa é |
| `User.Read.All` — Microsoft Graph | **Aplicação** | Foto (`FOTO_FONTE=graph`) e complemento do cargo quando a Intranet não o tiver. Sem consentimento, o login funciona igual (retrato da Intranet, iniciais no lugar da foto) |

Não há permissão da Intranet no Entra: SE a pessoa pode entrar é perguntado
pela chamada assinada (seção 4.5).

### 4.5 Intranet › Configurações › Controle de Acessos
1. Cadastrar o **Application (client) ID** do Monitoramento (ativo). É o mesmo
   valor que vai assinado em `X-Everblue-Client-Id`.
2. Liberar as pessoas que devem usar o Monitoramento.

Sem o item 2 a pessoa autentica no Entra (senha e MFA certos) e **não entra** —
comportamento desejado.

### 4.6 Chave da integração interna (HMAC)

```
chave = base64url( HMAC-SHA256( ACCESS_API_MASTER_SECRET, "everblue-directory:v1:<client id>" ) )
assinatura = hex( HMAC-SHA256( chave, "v1\nGET\n<caminho>\n<client id>\n<oid>\n<timestamp>\n<nonce>" ) )
```

Quem faz: `ATUALIZAR-E-CONECTAR-INTRANET.cmd` (ou, na VM,
`sudo bash infrastructure/scripts/conectar_intranet.sh`). Ele entra por SSH na
VM da Intranet com o seu usuário, deriva a chave lá, grava no `.env` do
Monitoramento e testa. Teste avulso a qualquer momento:

```bash
sudo bash infrastructure/scripts/conectar_intranet.sh --testar
# → "Assinatura Monitoramento/Intranet aceita: OK"
```

| Resposta da Intranet | Significado | Ação |
|---|---|---|
| `403 SYSTEM_ACCESS_DENIED` | Assinatura aceita; pessoa sem liberação | Liberar a pessoa (4.5, item 2) |
| `403 APPLICATION_NOT_AUTHORIZED` | Client ID não cadastrado/ativo | Cadastrar (4.5, item 1) |
| `401 INTERNAL_AUTH_SIGNATURE_INVALID` | Chave ou Client ID divergentes | Rodar `conectar_intranet.sh` de novo |
| `401 INTERNAL_AUTH_EXPIRED` | Relógios com mais de 90 s de diferença | Conferir NTP nas duas VMs |
| `503 INTERNAL_AUTH_CONFIGURATION_MISSING` | Intranet sem segredo mestre | Concluir a correção coordenada v20 da Intranet |

**Certificado da Intranet.** `intranet.grupoeverblue.com.br` usa certificado da
AC interna **Everblue Intranet Root CA v2** (PKI Everblue v2), que não está no
repositório público de raízes. A raiz pública vai no pacote
(`infrastructure/confianca/intranet-raiz-v2.pem`, SHA-256 `A6:3C:3A:FB:…:E7:63:50`)
e entra na API por `NODE_EXTRA_CA_CERTS` — soma-se às raízes públicas, a
verificação TLS continua ligada e nunca se usa `-k`. O `conectar_intranet.sh`
confere a impressão digital antes de usar a raiz. Na rotação da raiz da
Intranet, trocar esse arquivo e a impressão digital no roteiro.

Rotação: trocar `ACCESS_API_MASTER_SECRET` na Intranet invalida as chaves de
TODAS as aplicações (IA e Monitoramento) — rodar o `conectar` de cada uma.

## 5. O que preencher no `.env`

```bash
URL_PUBLICA=https://monitoramento.grupoeverblue.com.br
COOKIE_SEGURO=true
ENTRA_TENANT_ID=<tenant id>
ENTRA_CLIENT_ID=<application (client) id>
ENTRA_CLIENT_SECRET=<segredo de 4.1>
ENTRA_REDIRECT_URI=                 # vazio: URL_PUBLICA + /oauth/oidc/callback
ENTRA_MAPA_PERFIL=<guid>=admin;<guid>=gestor;<guid>=analista
# Gravados pelo conectar_intranet.sh (não digitar à mão):
DIRETORIO_URL=https://intranet.grupoeverblue.com.br
DIRETORIO_CLIENT_ID=<application (client) id do Monitoramento>
DIRETORIO_INTEGRATION_SECRET=<chave derivada exclusiva — 43 caracteres>
FOTO_FONTE=graph
```

## 6. Saída de emergência

A tela de login só oferece **Entrar com Microsoft**. A conta por senha existe em
`/entrar/emergencia`, sem link visível, para quando Entra ou Intranet estiverem
fora. É criada por `./infrastructure/scripts/conta_emergencia.sh`, a senha é
guardada no cofre da companhia e todo uso fica na auditoria como `excecao`.

## 7. Checklist do dia da virada

1. VM, disco de dados e Docker prontos.
2. DNS interno publicado.
3. Certificado da AC instalado e conferido.
4. App Registration completa (4.1 a 4.4) e consentimento concedido.
5. Aplicação cadastrada e pessoas liberadas na Intranet (4.5).
6. Chave HMAC provisionada e testada (4.6): `conectar_intranet.sh --testar` OK.
7. `.env` preenchido; `implantar.sh` e `verificar.sh` sem falhas.
8. Conta de emergência criada e testada.
9. Backup corporativo de `/opt/everblue-monitoramento/dados` agendado.
