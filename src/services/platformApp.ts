// Dispatcher fino entre as plataformas de TV. Cada tela continua chamando
// só isto — não tizenApp/webosApp diretamente — e ganha suporte a uma
// plataforma nova sem precisar saber que ela existe.

import * as tizenApp from './tizenApp';
import * as webosApp from './webosApp';
import * as tauriApp from './tauriApp';

function alvo(): 'tizen' | 'webos' | 'tauri' | null {
    if (typeof __BUILD_TARGET__ !== 'string') return null;
    if (__BUILD_TARGET__ === 'tizen') return 'tizen';
    if (__BUILD_TARGET__ === 'webos') return 'webos';
    if (__BUILD_TARGET__ === 'tauri') return 'tauri';
    return null;
}

/** Rodando num build de TV (Tizen ou webOS) — não no navegador nem no desktop. */
export function naTV(): boolean {
    return alvo() === 'tizen' || alvo() === 'webos';
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
    return false;
}

export function podeAbrirExterno(): boolean {
    const plataforma = alvo();
    if (plataforma === 'tizen') return tizenApp.podeAbrirExterno();
    if (plataforma === 'webos') return webosApp.podeAbrirExterno();
    if (plataforma === 'tauri') return tauriApp.podeAbrirExterno();
    return false;
}

export function abrirExterno(url: string): boolean {
    const plataforma = alvo();
    if (plataforma === 'tizen') return tizenApp.abrirExterno(url);
    if (plataforma === 'webos') return webosApp.abrirExterno(url);
    if (plataforma === 'tauri') return tauriApp.abrirExterno(url);
    return false;
}
