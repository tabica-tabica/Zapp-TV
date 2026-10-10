// Saída/abertura externa no app desktop (Tauri, Windows/Linux).
//
// Espelha tizenApp.ts/webosApp.ts na forma, mas o mecanismo é diferente: o
// Tauri expõe `window.__TAURI__` no runtime da própria janela (injetado pelo
// binário nativo, sem precisar de import estático de @tauri-apps/api aqui —
// isso mantém os builds Tizen/webOS/web livres de qualquer referência ao
// Tauri, já que este arquivo só roda de verdade sob __BUILD_TARGET__ ===
// 'tauri', mas o bundler ainda inclui o arquivo nos outros alvos).

interface TauriWindowApi {
    close?: () => Promise<void>;
}

interface TauriOpenerApi {
    openUrl?: (url: string) => Promise<void>;
}

interface TauriGlobal {
    window?: { getCurrentWindow?: () => TauriWindowApi };
    opener?: TauriOpenerApi;
    http?: { fetch?: typeof fetch };
}

function tauriGlobal(): TauriGlobal | undefined {
    return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

export function podeAbrirExterno(): boolean {
    return !!tauriGlobal()?.opener?.openUrl;
}

/** Abre uma URL no navegador padrão do sistema (item 18: trailer no YouTube). */
export function abrirExterno(url: string): boolean {
    try {
        const opener = tauriGlobal()?.opener;
        if (typeof opener?.openUrl !== 'function') return false;
        void opener.openUrl(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Requisições pro provedor saem pelo Rust (tauri-plugin-http), não pelo
 * WebKitGTK: a página roda em tauri://localhost, então todo pedido ao painel
 * é cross-origin — e o 1º redirect do provedor vem sem
 * Access-Control-Allow-Origin ("Load failed" no login). No Rust não existe
 * CORS. Só URL http(s) de OUTRA origem; o resto segue no fetch nativo.
 * Vale pro hls.js também, que no Tauri roda em modo progressive (FetchLoader
 * em vez de XHR) — ver useHls.
 */
export function rotearFetchPeloTauri(): void {
    const httpFetch = tauriGlobal()?.http?.fetch;
    if (typeof httpFetch !== 'function') return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const externa = /^https?:/i.test(url) && !url.startsWith(window.location.origin);
        if (!externa) return nativeFetch(input, init);
        // O plugin só lê o signal do `init` — o hls.js manda um Request com o
        // signal dentro, e o abort de fragmento seria ignorado
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return httpFetch(input, { ...init, signal });
    };
}

/** Fecha a janela do app. Fora do Tauri (navegador comum) não faz nada. */
export function exitApp(): boolean {
    try {
        const janela = tauriGlobal()?.window?.getCurrentWindow?.();
        if (typeof janela?.close !== 'function') return false;
        void janela.close();
        return true;
    } catch {
        return false;
    }
}
