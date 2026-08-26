// Preconnect ao provedor (item 82).
//
// O primeiro pedido ao painel do provedor paga DNS + TCP + TLS antes de
// qualquer byte útil — numa TV com Wi-Fi fraco isso é meio segundo ou mais de
// tela parada no boot. Como as credenciais já estão no armazenamento antes de
// o React montar, dá pra abrir a conexão em paralelo com o download do bundle.

import { readJson } from './safeStorage';

interface StoredCredentials {
    url?: string;
}

function originOf(url: string): string | null {
    try {
        return new URL(url.includes('://') ? url : `http://${url}`).origin;
    } catch {
        return null;
    }
}

/** Chamar o MAIS CEDO possível — antes de montar o React. */
export function preconnectProvider(): void {
    try {
        const credentials = readJson<StoredCredentials | null>('neostream_credentials', null);
        const origin = credentials?.url ? originOf(credentials.url) : null;
        if (!origin) return;

        for (const rel of ['preconnect', 'dns-prefetch']) {
            const link = document.createElement('link');
            link.rel = rel;
            link.href = origin;
            // Sem crossOrigin: as chamadas ao player_api.php são same-origin
            // do ponto de vista de credenciais, e marcar cross-origin abriria
            // uma segunda conexão em vez de reaproveitar esta
            document.head.appendChild(link);
        }
    } catch {
        // Preconnect é otimização: falhar aqui não pode atrapalhar o boot
    }
}

/**
 * Carrega a fonte que --font-family (src/index.css) já pede desde sempre —
 * sem isto o app sempre rodou na fonte padrão do sistema, em silêncio. Nome e
 * pesos vêm de brand.config.mjs (__BRAND_FONT_FAMILY__/__BRAND_FONT_WEIGHTS__),
 * não hardcoded aqui.
 * Injeção via JS em vez de <link> nos HTML porque index.html/tizen/index.html/
 * webos/index.html são 3 arquivos estáticos sem template compartilhado; assim
 * a mudança vale pros três de uma vez só. Chamar junto de preconnectProvider().
 */
export function loadBrandFont(): void {
    try {
        const preconnect1 = document.createElement('link');
        preconnect1.rel = 'preconnect';
        preconnect1.href = 'https://fonts.googleapis.com';
        const preconnect2 = document.createElement('link');
        preconnect2.rel = 'preconnect';
        preconnect2.href = 'https://fonts.gstatic.com';
        preconnect2.crossOrigin = 'anonymous';
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        const family = encodeURIComponent(__BRAND_FONT_FAMILY__);
        stylesheet.href = `https://fonts.googleapis.com/css2?family=${family}:wght@${__BRAND_FONT_WEIGHTS__}&display=swap`;
        document.head.append(preconnect1, preconnect2, stylesheet);
    } catch {
        // Fonte é progressive enhancement: falhar aqui cai no fallback do sistema, não trava o boot
    }
}
