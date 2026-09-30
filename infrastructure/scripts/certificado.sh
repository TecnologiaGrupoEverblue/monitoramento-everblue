#!/usr/bin/env bash
#
# Certificado TLS do Monitoramento Everblue (mesmo roteiro da IA Everblue).
#
# A CHAVE PRIVADA É GERADA AQUI, NO SERVIDOR, E NUNCA SAI DELE. Não vai em
# pacote de implantação, não vai em repositório, não vai em conversa. Chave que
# viaja é chave comprometida — e quem a tiver pode se passar pelo servidor no
# login corporativo, que é justamente o que o TLS existe para impedir.
#
# Dois modos:
#
#   ./infrastructure/scripts/certificado.sh csr
#       Gera a chave e uma requisição (CSR) para a AC interna da Everblue
#       assinar. É o caminho normal: o certificado assinado pela AC da
#       companhia já é confiável em toda máquina com a política de domínio, e
#       ninguém vê aviso de segurança.
#
#   ./infrastructure/scripts/certificado.sh autoassinado
#       Gera um certificado assinado por ele mesmo, válido por 397 dias.
#       Serve para levantar o HTTPS e testar o fluxo ANTES de a AC responder.
#       Todo navegador vai avisar, e o aviso está certo: ninguém garantiu que
#       este servidor é quem diz ser. Não deixe assim em produção.
#
# Em ambos, o resultado fica em infrastructure/nginx/certs/emon.key e infrastructure/nginx/certs/emon.crt —
# exatamente onde o docker-compose monta.
set -euo pipefail

# O segundo argumento permite gerar o par direto na instalação, a partir do
# pacote recém-extraído — sem isso a ordem ficaria travada: a atualização chama
# o implantar.sh, que recusa por falta de certificado, que só poderia ser
# gerado depois da atualização.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALACAO="${2:-$RAIZ}"
INSTALACAO="${INSTALACAO%$'\r'}"
DESTINO="$INSTALACAO/infrastructure/nginx/certs"
CHAVE="$DESTINO/emon.key"
CERT="$DESTINO/emon.crt"
PEDIDO="$DESTINO/emon.csr"

NOME_PRINCIPAL="monitoramento.grupoeverblue.com.br"
# O mesmo certificado atende os dois nomes. Um certificado por nome dobraria a
# renovação e criaria a chance de um vencer sem o outro — e o que vence sempre
# é o que ninguém está olhando.
# IP_SERVIDOR (opcional) entra no certificado só para a transição, enquanto o
# DNS interno não publica o nome.
ALTERNATIVOS="DNS:monitoramento.grupoeverblue.com.br${IP_SERVIDOR:+,IP:$IP_SERVIDOR}"

modo="${1:-}"

_config_openssl() {
    cat <<CFG
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = ext
x509_extensions    = ext

[dn]
C  = BR
ST = Sao Paulo
L  = Sao Paulo
O  = Grupo Everblue
OU = Tecnologia
CN = $NOME_PRINCIPAL

[ext]
subjectAltName   = $ALTERNATIVOS
basicConstraints = critical, CA:FALSE
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
CFG
}

_preparar() {
    mkdir -p "$DESTINO"
    # A chave é legível só pelo dono. O nginx a lê como root antes de baixar
    # privilégio, então 600 basta e é o mínimo.
    if [[ -f "$CHAVE" ]]; then
        echo "A chave já existe em $CHAVE — mantida."
        echo "Para trocá-la de propósito, mova a antiga antes: mv $CHAVE $CHAVE.bak"
    else
        openssl genrsa -out "$CHAVE" 2048 2>/dev/null
        chmod 600 "$CHAVE"
        echo "Chave privada gerada: $CHAVE (permissão 600)"
    fi
}

case "$modo" in
  csr)
    _preparar
    _config_openssl > "$DESTINO/openssl.cnf"
    openssl req -new -key "$CHAVE" -out "$PEDIDO" -config "$DESTINO/openssl.cnf"
    echo
    echo "Requisição gerada: $PEDIDO"
    echo
    echo "Envie ESTE arquivo (só ele) para a equipe que opera a AC interna."
    echo "O pedido cobre os nomes: $ALTERNATIVOS"
    echo
    echo "Quando o certificado assinado voltar, grave-o como $CERT —"
    echo "com a cadeia intermediária concatenada ABAIXO do certificado do"
    echo "servidor, senão o navegador não consegue montar o caminho de"
    echo "confiança e reclama mesmo com a AC instalada."
    echo
    echo "Depois: ./infrastructure/scripts/implantar.sh"
    ;;

  autoassinado)
    _preparar
    _config_openssl > "$DESTINO/openssl.cnf"
    # 397 dias é o teto que os navegadores aceitam desde 2020. Pedir mais faz
    # o certificado ser recusado de saída.
    openssl req -new -x509 -key "$CHAVE" -out "$CERT" -days 397 \
        -config "$DESTINO/openssl.cnf" -extensions ext
    chmod 644 "$CERT"
    echo
    echo "Certificado autoassinado gerado: $CERT"
    echo "Válido até: $(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)"
    echo
    echo "ATENÇÃO: todo navegador vai avisar que este certificado não é"
    echo "confiável, e o aviso está correto. Use-o para subir o HTTPS e testar"
    echo "o fluxo; troque pelo certificado da AC interna antes de liberar para"
    echo "a companhia."
    ;;

  conferir)
    # Roda ANTES do implantar.sh, sobre o certificado que a AC devolveu.
    #
    # O nginx recusa iniciar com certificado que não casa com a chave, e um
    # `implantar.sh` que falha nessa etapa deixa a plataforma FORA DO AR, não
    # degradada. A mensagem do nginx nesse caso — "key values mismatch" — é
    # correta e não diz o que fazer.
    #
    # Os três defeitos abaixo vêm de UMA fonte só, e é a mais comum de todas:
    # a AC devolveu o arquivo em outro formato, ou sem os nomes alternativos,
    # e o operador da AC não tem como perceber — do lado dele parece certo.
    falhou=0
    [[ -f "$CERT" ]]  || { echo "FALHA: não existe $CERT"; exit 1; }
    [[ -f "$CHAVE" ]] || { echo "FALHA: não existe $CHAVE"; exit 1; }

    if ! openssl x509 -in "$CERT" -noout >/dev/null 2>&1; then
      echo "FALHA: $CERT não é um certificado PEM legível."
      echo
      echo "  A AC provavelmente devolveu em DER ou PKCS#7. Converta:"
      echo "    openssl x509 -inform DER -in emon.cer -out $CERT"
      echo "    openssl pkcs7 -print_certs -in emon.p7b -out $CERT"
      exit 1
    fi

    echo "titular : $(openssl x509 -in "$CERT" -noout -subject | sed 's/^subject=//')"
    echo "emissor : $(openssl x509 -in "$CERT" -noout -issuer | sed 's/^issuer=//')"
    echo "validade: até $(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)"

    # Certificado que não casa com a chave é o que derruba o nginx. Comparar o
    # módulo da chave pública dos dois é o teste definitivo.
    m_cert="$(openssl x509 -in "$CERT" -noout -modulus 2>/dev/null | openssl md5 || true)"
    m_key="$(openssl rsa -in "$CHAVE" -noout -modulus 2>/dev/null | openssl md5 || true)"
    if [[ -n "$m_cert" && "$m_cert" == "$m_key" ]]; then
      echo "ok      certificado casa com a chave privada deste servidor"
    else
      echo "FALHA   o certificado NÃO casa com a chave em $CHAVE."
      echo "        Foi assinado a partir de outro pedido. Peça à AC que assine"
      echo "        o $PEDIDO deste servidor — a chave não pode ser trocada por"
      echo "        outra sem gerar um pedido novo."
      falhou=1
    fi

    # Navegador atual IGNORA o CN e exige o nome em subjectAltName. Uma AC
    # Windows descarta os SAN do pedido quando o modelo não está configurado
    # para "fornecer na solicitação" — e o certificado volta com CN correto,
    # aparência perfeita e aviso no navegador do mesmo jeito.
    sans="$(openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null | tail -1 | xargs || true)"
    echo "nomes   : ${sans:-<NENHUM>}"
    for nome in monitoramento.grupoeverblue.com.br; do
      if [[ "$sans" == *"$nome"* ]]; then
        echo "ok      cobre $nome"
      else
        echo "FALHA   NÃO cobre $nome em subjectAltName."
        echo "        Navegador atual ignora o CN: sem o nome aqui, o aviso"
        echo "        continua. Peça à AC um modelo que preserve os nomes"
        echo "        alternativos do pedido."
        falhou=1
      fi
    done

    # Sem a cadeia, o navegador não liga o certificado à raiz confiável.
    if [[ "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$CERT")" -lt 2 ]]; then
      echo "AVISO   o arquivo tem um único certificado — sem cadeia."
      echo "        Se a AC tiver intermediária, concatene-a ABAIXO deste."
      echo "        Só a raiz nas máquinas não basta: o navegador precisa do"
      echo "        caminho completo para chegar até ela."
    else
      echo "ok      há mais de um certificado no arquivo (cadeia presente)"
    fi

    echo
    (( falhou )) && { echo "NÃO instale ainda — corrija o que está acima."; exit 1; }
    echo "Pode seguir: ./infrastructure/scripts/implantar.sh"
    ;;

  *)
    echo "Uso: $0 {csr|autoassinado|conferir} [diretorio-da-instalacao]"
    echo
    echo "  csr           gera chave + requisição para a AC interna assinar"
    echo "  autoassinado  gera chave + certificado próprio, para teste"
    echo "  conferir      confere o certificado que a AC devolveu, ANTES de"
    echo "                implantar — casamento com a chave, nomes cobertos"
    echo "                e presença da cadeia"
    echo
    echo "O diretório é opcional; sem ele, grava ao lado deste script."
    exit 2
    ;;
esac
