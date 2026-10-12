#!/bin/sh
# Instala o .ipk numa TV LG (webOS) pela rede local, pelo Modo Desenvolvedor.
#
#   macOS: duplo clique.   Linux: sh install-tv.command [arquivo.ipk] [ip-da-tv]
#   Windows: install-tv.bat (mesmo fluxo, em PowerShell: install-tv.ps1)
#
# Só usa o que já vem no sistema (curl, ssh, ssh-keygen): nem Node nem SDK da
# LG. É o mesmo caminho do ares-install: chave do Key Server (porta 9991), SSH
# na 9922 como "prisoner", .ipk em /media/developer/temp e instalação pelo
# luna (com.webos.appInstallService/dev/install), em install-tv-remote.sh.
#
# Antes, na TV: app "Developer Mode" da LG Content Store, conta LG, "Dev Mode
# Status" e "Key Server" ligados. A sessão expira (~50h): renovar no próprio
# app, senão a TV apaga o Zapp.

AQUI=$(cd "$(dirname "$0")" && pwd)
# Só pra testar contra um sshd local no lugar da TV
TV_USER=${TV_USER:-prisoner}
DESTINO=${TV_DIR:-/media/developer/temp}

fim() { printf '\nEnter pra fechar... '; read -r _; exit "$1"; }
falhou() {
    printf '\n%s\n' "$1"
    cat <<'EOF'
Confira:
  - TV e computador na MESMA rede;
  - Developer Mode com "Dev Mode Status" e "Key Server" ligados;
  - a Passphrase igual à da tela;
  - a sessão de desenvolvedor não expirou (renove no app Developer Mode).
EOF
    fim 1
}

for bin in curl ssh ssh-keygen; do
    command -v "$bin" >/dev/null 2>&1 || { echo "Falta o comando $bin no sistema."; fim 1; }
done

# .ipk: o do argumento, senão o mais novo ao lado do script ou em dist/ipk
IPK=$1
[ -n "$IPK" ] || IPK=$(ls -t "$AQUI"/*.ipk dist/ipk/*.ipk 2>/dev/null | head -n 1)
[ -f "$IPK" ] || { echo "Nenhum .ipk encontrado. Uso: sh install-tv.command [arquivo.ipk] [ip-da-tv]"; fim 1; }
# ares-package nomeia <id>_<versão>_<arq>.ipk
APP_ID=$(basename "$IPK" | cut -d_ -f1)

IP=$2
while ! printf '%s' "$IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; do
    printf 'IP da TV (Configurações → Rede, ex.: 192.168.0.20): '
    read -r IP || fim 1
done

cat <<'EOF'

Na TV, abra o app "Developer Mode" e confira:
  - Dev Mode Status: ON
  - Key Server: ON
EOF
printf 'Passphrase que aparece na tela (6 caracteres): '
read -r PASS || fim 1
# A TV mostra sempre em maiúsculas; aceita digitada de qualquer jeito
PASS=$(printf "%s" "$PASS" | tr "[:lower:]" "[:upper:]")

TMP=$(mktemp -d) || fim 1
trap 'rm -rf "$TMP"' EXIT
KEY=$TMP/webos_rsa

echo "Buscando a chave da TV..."
curl -fsS -m 10 -o "$KEY" "http://$IP:9991/webos_rsa" || falhou "Não consegui falar com o Key Server da TV."
chmod 600 "$KEY"
# Tira a senha de uma cópia temporária: ssh não pergunta a cada comando
ssh-keygen -p -P "$PASS" -N "" -f "$KEY" >/dev/null 2>&1 || falhou "A Passphrase não confere com a da TV."

# O SSH do Modo Desenvolvedor ainda usa chave RSA/SHA-1, que o OpenSSH novo
# desliga por padrão; host key muda a cada sessão, então não guarda
tv() {
    ssh -p 9922 -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 \
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
        -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedKeyTypes=+ssh-rsa \
        "$TV_USER@$IP" "$@"
}

echo "Enviando $(basename "$IPK")..."
tv "mkdir -p $DESTINO && cat > $DESTINO/zapp.ipk" < "$IPK" || falhou "Não consegui enviar o app pra TV."

echo "Instalando..."
tv "sh -s $APP_ID $DESTINO" < "$AQUI/install-tv-remote.sh" || falhou "A TV recusou a instalação."
echo "Pronto! O app já está aberto na TV."
fim 0
