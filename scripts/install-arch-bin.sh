#!/usr/bin/env bash
# Instala OU atualiza o Zapp TV desktop no Arch a partir do release mais
# recente do GitHub, sem compilar: o binário do .deb do release linka contra o
# WebKitGTK do sistema e roda no Arch como está. Só pro usuário (~/.local).
#
# Uso: curl -fsSL https://raw.githubusercontent.com/tabica-tabica/Zapp-TV/main/scripts/install-arch-bin.sh | bash
# Compilar do código-fonte em vez disso: scripts/install-arch.sh

set -euo pipefail

REPO="tabica-tabica/Zapp-TV"
BIN="$HOME/.local/bin/zapp-tv"
ICON="$HOME/.local/share/icons/hicolor/128x128/apps/zapp-tv.png"
DESKTOP="$HOME/.local/share/applications/zapp-tv.desktop"

# Runtime: WebKitGTK + GStreamer (sem bad/libav o HLS não toca, vídeo preto)
missing=$(pacman -T webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav || true)
if [ -n "$missing" ]; then
    echo "Instalando dependências: $missing"
    # shellcheck disable=SC2086
    sudo pacman -S --needed $missing
fi

latest=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
tag=$(grep -m1 '"tag_name"' <<<"$latest" | cut -d'"' -f4)
[ -n "$tag" ] || { echo "Não achei o release mais recente de $REPO." >&2; exit 1; }
version=${tag#v}

if [ -x "$BIN" ] && [ -f "$BIN.version" ] && [ "$(cat "$BIN.version")" = "$version" ]; then
    echo "Zapp TV $version já está instalado."
    exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Baixando Zapp TV $version..."
curl -fL --progress-bar -o "$tmp/zapp.deb" \
    "https://github.com/$REPO/releases/download/$tag/Zapp.TV_${version}_amd64.deb"
bsdtar -xOf "$tmp/zapp.deb" 'data.tar*' | bsdtar -xf - -C "$tmp" usr/bin/app usr/share/icons/hicolor/128x128/apps/app.png

# Escreve ao lado e troca com mv: funciona com o app aberto (sobrescrever o
# executável em uso dá "Text file busy"). A versão nova vale ao reabrir.
install -Dm755 "$tmp/usr/bin/app" "$BIN.new"
mv -f "$BIN.new" "$BIN"
echo "$version" > "$BIN.version"
install -Dm644 "$tmp/usr/share/icons/hicolor/128x128/apps/app.png" "$ICON"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Zapp TV
Comment=IPTV player
Exec=$BIN
Icon=zapp-tv
Terminal=false
Categories=AudioVideo;Video;Player;TV;
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Zapp TV $version instalado: $BIN (também no menu de aplicativos)."
