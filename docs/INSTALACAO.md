# Instalação na VM — passo a passo

VM: Ubuntu 24.04, 4 vCPU, 8 GB, disco de dados de 150 GB em
`/opt/everblue-monitoramento`. Código em `/opt/everblue-monitoramento/app`,
dados em `/opt/everblue-monitoramento/dados`.

> Os segredos (client secret do Entra, senhas) são digitados **direto no `.env`
> do servidor**. Não passam por chat, e-mail, chamado nem pelo pacote.

## 0. O que ter em mãos

| Item | Onde é usado | Obrigatório para |
|---|---|---|
| Directory (tenant) ID, Application (client) ID e client secret do app "Monitoramento Everblue" | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Login corporativo |
| Senha do `everblue` da VM da Intranet (192.168.0.250) | `conectar_intranet.sh` deriva a chave HMAC lá | Autorizar quem entra |
| GUIDs dos grupos do Entra e o perfil de cada um | `ENTRA_MAPA_PERFIL` | Perfis (leitor/analista/gestor/admin) |
| E-mail e nome da conta de emergência | `conta_emergencia.sh` | Primeiro acesso e contingência |

Sem os dados do Entra e da Intranet a aplicação **sobe e funciona** com a conta
de emergência; o login corporativo entra quando o `.env` for completado.

## Caminho mais simples: um arquivo só

Na pasta `pacote`, **duplo clique em `INSTALAR-MONITORAMENTO.cmd`**. Ele já sabe
o servidor (192.168.0.248) e o usuário (everblue) e pede só a senha, duas vezes:
no SSH e no `sudo` (a mesma senha). O pacote vai pela própria conexão SSH, o
checksum é conferido na VM e a instalação roda sem perguntas — Docker, `.env`
com segredos gerados, pedido à AC + certificado autoassinado, build, migração,
conta de emergência (senha forte mostrada UMA vez no fim) e verificação.

Pode dar duplo clique de novo a qualquer momento: continua de onde parou.
Depois: `CONFIGURAR-LOGIN-ENTRA.cmd` (dados do Entra) e
`ATUALIZAR-E-CONECTAR-INTRANET.cmd` (chave HMAC da Intranet) ligam o login
corporativo.

## Caminho com mais controle (roteiros separados)

Na pasta do pacote, no Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\enviar_para_vm.ps1 -Servidor IP_DA_VM -Usuario SEU_USUARIO -Instalar
```

Ele confere o checksum, copia pacote e roteiros para `/tmp/everblue-monitoramento`
na VM e abre o `instalar.sh`, que conduz as 8 etapas abaixo fazendo perguntas.
Se parar no meio (instalar Docker e reentrar no SSH, preencher o `.env`, esperar
a AC), rode de novo — ele continua de onde parou:

```bash
cd /tmp/everblue-monitoramento && bash instalar.sh
```

Atualizações futuras: `enviar_para_vm.ps1 ... -Atualizar` (ou `bash atualizar.sh pacote.tar.gz`
na VM). A versão anterior fica em `/opt/everblue-monitoramento/releases/`; se a
implantação falhar, o roteiro oferece voltar na hora. Retorno manual:
`bash retornar.sh`. Evidências de cada instalação/atualização ficam em
`/opt/everblue-monitoramento/evidencias/`.

O restante deste documento é o mesmo processo feito à mão, etapa por etapa.

## 1. Copiar o pacote para a VM

No Windows (PowerShell), da pasta onde está o pacote:

```powershell
scp .\everblue-monitoramento-X.Y.Z.tar.gz .\everblue-monitoramento-X.Y.Z.tar.gz.sha256 USUARIO@IP_DA_VM:/tmp/
```

(WinSCP também serve — modo binário.)

## 2. Extrair no servidor

```bash
cd /tmp
sha256sum -c everblue-monitoramento-X.Y.Z.tar.gz.sha256        # tem de dizer: OK
sudo mkdir -p /opt/everblue-monitoramento/app
sudo chown "$USER":"$USER" /opt/everblue-monitoramento/app
tar -xzf everblue-monitoramento-X.Y.Z.tar.gz -C /opt/everblue-monitoramento/app --strip-components=1
cd /opt/everblue-monitoramento/app
```

O pacote já vem com fim de linha Linux e permissão de execução nos roteiros.

## 3. Conferir a VM

```bash
./infrastructure/scripts/verificar_requisitos.sh
```

Só lê — não muda nada. Resolva o que aparecer como **FALTA**:

- Docker ausente: `sudo -E ./infrastructure/scripts/instalar_docker.sh` e
  **saia e entre de novo** no SSH (grupo docker).
- Disco de dados não montado ou fora do `/etc/fstab`: com o time de infraestrutura.
- Sem saída para Docker Hub / npm / Entra: liberar no firewall ou informar o
  proxy (`export HTTPS_PROXY=...` antes do `instalar_docker.sh`, e no `.env`).

## 4. Gerar o `.env`

```bash
./infrastructure/scripts/preparar.sh
nano .env
```

O `preparar.sh` gera **todas** as senhas e chaves. Preencha só:

```bash
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
ENTRA_MAPA_PERFIL=<guid>=admin;<guid>=gestor;<guid>=analista
```

A ligação com a Intranet (`DIRETORIO_URL`, `DIRETORIO_CLIENT_ID`,
`DIRETORIO_INTEGRATION_SECRET`) **não é digitada**: rode
`sudo bash infrastructure/scripts/conectar_intranet.sh` (ou o
`ATUALIZAR-E-CONECTAR-INTRANET.cmd` no Windows). Ver
[REDE-E-ENTRA.md §4.6](REDE-E-ENTRA.md).

Guarde uma cópia do `.env` no cofre de senhas da companhia (ele contém as chaves
que decifram os tokens e abrem o banco e o MinIO).

## 5. Certificado

```bash
# Caminho normal: gera a chave AQUI e um pedido para a AC interna
./infrastructure/scripts/certificado.sh csr
# → envie SOMENTE infrastructure/nginx/certs/emon.csr para a AC
# → grave o certificado devolvido (com a cadeia) em infrastructure/nginx/certs/emon.crt
./infrastructure/scripts/certificado.sh conferir

# Para subir e testar já, antes da AC responder:
IP_SERVIDOR=IP_DA_VM ./infrastructure/scripts/certificado.sh autoassinado
```

## 6. Implantar

```bash
./infrastructure/scripts/implantar.sh
```

Na primeira vez o build leva alguns minutos (baixa imagens e dependências). O
roteiro valida `.env`, certificado e nginx; sobe banco, MinIO, cria o bucket e o
usuário da aplicação, aplica as migrações, sobe API e nginx e confere as rotas.

## 7. Conta de emergência

```bash
./infrastructure/scripts/conta_emergencia.sh
```

Acesso: `https://monitoramento.grupoeverblue.com.br/entrar/emergencia`.

> **Antes do DNS interno publicar o nome**, acesse pelo nome mesmo assim,
> apontando-o para a VM no arquivo `hosts` do seu computador
> (`C:\Windows\System32\drivers\etc\hosts`: `IP_DA_VM monitoramento.grupoeverblue.com.br`).
> Pelo IP a tela abre, mas o login é recusado de propósito: a aplicação só
> aceita ações vindas do endereço oficial (`URL_PUBLICA`).

## 8. Verificar

```bash
./infrastructure/scripts/verificar.sh
```

Guarde a saída como evidência da implantação.

## Atualizar depois

```bash
# confirme o backup corporativo de /opt/everblue-monitoramento/dados
cd /tmp && sha256sum -c everblue-monitoramento-X.Y.Z.tar.gz.sha256
cd /opt/everblue-monitoramento/app
tar -xzf /tmp/everblue-monitoramento-X.Y.Z.tar.gz --strip-components=1   # não toca em .env nem certs
./infrastructure/scripts/implantar.sh && ./infrastructure/scripts/verificar.sh
```

Retorno e diagnóstico: [OPERACAO.md](OPERACAO.md). Nunca `docker compose down -v`.
