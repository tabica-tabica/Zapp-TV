// Saída do aplicativo no LG webOS.
//
// Diferente do Tizen: webOS não tem um "sair" no sentido de matar o
// processo. O modelo de app da LG é suspend-first — a tecla Voltar na tela
// raiz devolve o controle à plataforma via `webOS.platformBack()`, e é a
// PLATAFORMA quem decide suspender o app (não o app quem se mata). Só existe
// um jeito mais forte, `PalmSystem.close()` (a ponte de baixo nível, sempre
// presente, injetada pelo runtime sem precisar de biblioteca nenhuma) — mais
// parecido com o `.exit()` do Tizen. `exitApp()` aqui tenta o caminho
// recomendado pela LG primeiro e só cai pro mais forte se a lib não carregou.
//
// webOSTV.js precisa ser vendorizado (igual o resto do bundle: o pacote roda
// sem origem HTTP) — carregado à parte, não como módulo ES. Sem ele carregado,
// tanto webOSGlobal() quanto exitApp() caem no PalmSystem cru ou em no-op.

interface WebOSGlobal {
    platformBack?: () => void;
}

interface PalmSystemGlobal {
    close?: () => void;
}

function webosGlobal(): WebOSGlobal | undefined {
    return (window as unknown as { webOS?: WebOSGlobal }).webOS;
}

function palmSystemGlobal(): PalmSystemGlobal | undefined {
    return (window as unknown as { PalmSystem?: PalmSystemGlobal }).PalmSystem;
}

/**
 * A TV consegue abrir uma URL num app externo?
 *
 * webOS não tem um equivalente direto ao `ApplicationControl` do Tizen.
 * Best-effort por enquanto: `window.open` funciona em alguns modelos/versões
 * de webOS pra disparar o navegador/launcher do sistema, mas isso não foi
 * verificado num aparelho real — sinalizado aqui, não bloqueando a feature
 * numa suposição não confirmável fora de uma TV de verdade.
 */
export function podeAbrirExterno(): boolean {
    return true;
}

/** Abre uma URL fora do app (item 18: o trailer no YouTube). Ver podeAbrirExterno(). */
export function abrirExterno(url: string): boolean {
    try {
        const janela = window.open(url, '_blank');
        return !!janela;
    } catch {
        return false;
    }
}

/** Fecha (ou suspende) o app na TV. Fora do webOS (navegador) não faz nada. */
export function exitApp(): boolean {
    try {
        const webos = webosGlobal();
        if (typeof webos?.platformBack === 'function') {
            webos.platformBack();
            return true;
        }
        const palm = palmSystemGlobal();
        if (typeof palm?.close === 'function') {
            palm.close();
            return true;
        }
        return false;
    } catch {
        // Modelo sem nenhuma das duas pontes: melhor não fazer nada do que cair
        return false;
    }
}
