// Saída/abertura externa no app Android TV (android/: uma WebView nativa).
//
// A Activity expõe `window.ZappAndroid` (addJavascriptInterface): sair()
// fecha a Activity e abrir(url) manda a URL pro app do sistema (YouTube,
// navegador) por Intent. Fora do app Android o objeto não existe e tudo
// devolve false — mesmo contrato de tizenApp/webosApp/tauriApp.

interface PonteAndroid {
    sair?: () => void;
    abrir?: (url: string) => boolean;
}

function ponte(): PonteAndroid | undefined {
    return (window as unknown as { ZappAndroid?: PonteAndroid }).ZappAndroid;
}

export function exitApp(): boolean {
    const p = ponte();
    if (typeof p?.sair !== 'function') return false;
    p.sair();
    return true;
}

export function podeAbrirExterno(): boolean {
    return typeof ponte()?.abrir === 'function';
}

export function abrirExterno(url: string): boolean {
    const p = ponte();
    if (typeof p?.abrir !== 'function') return false;
    try {
        return !!p.abrir(url);
    } catch {
        return false;
    }
}
