// Dispatcher fino entre as plataformas de TV. Cada tela continua chamando
// só isto — não tizenApp/webosApp diretamente — e ganha suporte a uma
// plataforma nova sem precisar saber que ela existe.

import * as tizenApp from './tizenApp';
import * as webosApp from './webosApp';
import * as tauriApp from './tauriApp';
import * as androidApp from './androidApp';

function alvo(): 'tizen' | 'webos' | 'tauri' | 'android' | null {
    if (typeof __BUILD_TARGET__ !== 'string') return null;
    if (__BUILD_TARGET__ === 'tizen') return 'tizen';
    if (__BUILD_TARGET__ === 'webos') return 'webos';
    if (__BUILD_TARGET__ === 'tauri') return 'tauri';
    if (__BUILD_TARGET__ === 'android') return 'android';
    return null;
}

/** Rodando num build de TV (Tizen, webOS ou Android TV) — não no navegador nem no desktop. */
export function naTV(): boolean {
    return alvo() === 'tizen' || alvo() === 'webos' || alvo() === 'android';
}

/** Rodando no build da LG (webOS). */
export function noWebOS(): boolean {
    return alvo() === 'webos';
}

/** Rodando no app desktop (Tauri) — nem TV, nem navegador comum. */
export function naDesktop(): boolean {
    return alvo() === 'tauri';
}

export function exitApp(): boolean {
    const plataforma = alvo();
    if (plataforma === 'tizen') return tizenApp.exitApp();
    if (plataforma === 'webos') return webosApp.exitApp();
    if (plataforma === 'tauri') return tauriApp.exitApp();
    if (plataforma === 'android') return androidApp.exitApp();
    return false;
}

export function podeAbrirExterno(): boolean {
    const plataforma = alvo();
    if (plataforma === 'tizen') return tizenApp.podeAbrirExterno();
    if (plataforma === 'webos') return webosApp.podeAbrirExterno();
    if (plataforma === 'tauri') return tauriApp.podeAbrirExterno();
    if (plataforma === 'android') return androidApp.podeAbrirExterno();
    return false;
}

export function abrirExterno(url: string): boolean {
    const plataforma = alvo();
    if (plataforma === 'tizen') return tizenApp.abrirExterno(url);
    if (plataforma === 'webos') return webosApp.abrirExterno(url);
    if (plataforma === 'tauri') return tauriApp.abrirExterno(url);
    if (plataforma === 'android') return androidApp.abrirExterno(url);
    return false;
}

/**
 * Mudo da prévia. No desktop (Tauri = WebKitGTK/GStreamer) um <video> que
 * COMEÇA mudo trava no seek inicial do hls.js: `seeking` pra sempre,
 * readyState 1, buffer cheio e nada toca — a prévia da Home (sempre muda)
 * nunca subia, e a da TV ao Vivo travava ao trocar de canal com o Mudo
 * ligado (visto 14/10/2026). Lá o mudo vira volume 0, com som "ligado".
 */
export function aplicarMudo(video: HTMLVideoElement, mudo: boolean): void {
    if (naDesktop()) {
        video.muted = false;
        video.volume = mudo ? 0 : 1;
        return;
    }
    video.muted = mudo;
}
