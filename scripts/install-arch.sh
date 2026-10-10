#!/usr/bin/env bash
# Instala o Zapp TV desktop (Tauri) no Arch Linux, nativo, só pro usuário
# atual (~/.local) — sem AppImage: o empacotador de AppImage do Tauri quebra
# no Arch desde o gdk-pixbuf 2.44 (loaders viraram glycin), e o binário
# nativo usa o WebKitGTK do sistema, que já está lá.
#
# Uso: scripts/install-arch.sh            compila e instala
#      scripts/install-arch.sh --uninstall remove

set -euo pipefail
cd "$(dirname "$0")/.."

BIN="$HOME/.local/bin/zapp-tv"
ICON="$HOME/.local/share/icons/hicolor/512x512/apps/zapp-tv.png"
DESKTOP="$HOME/.local/share/applications/zapp-tv.desktop"

if [ "${1:-}" = "--uninstall" ]; then
    # .version e o ícone 128px vêm do install-arch-bin.sh (binário do release)
    rm -f "$BIN" "$BIN.version" "$ICON" "$DESKTOP" "$HOME/.local/share/icons/hicolor/128x128/apps/zapp-tv.png"
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    echo "Zapp TV removido."
    exit 0
fi

# Build: rust/node. Runtime: WebKitGTK + GStreamer — o player do WebKitGTK é
# o GStreamer; sem bad/libav o HLS (H.264/AAC) não toca e o vídeo fica preto.
# sudo só quando falta algo: sem terminal (ex.: `!` do Claude Code) o sudo
# não consegue pedir senha, e com tudo instalado ele nem é chamado.
missing=$(pacman -T rust nodejs npm webkit2gtk-4.1 \
    gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav || true)
if [ -n "$missing" ]; then
    echo "Instalando dependências: $missing"
    # shellcheck disable=SC2086
    sudo pacman -S --needed $missing
fi

[ -d node_modules ] || npm ci
npx tauri build --no-bundle

install -Dm755 src-tauri/target/release/app "$BIN"
install -Dm644 src-tauri/icons/icon.png "$ICON"
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

echo "Zapp TV instalado: $BIN (também no menu de aplicativos)."
