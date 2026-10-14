import qrcode from 'qrcode-generator';

/** Desenha o QR como UM path só: um rect por módulo derrubaria a TV. */
export function qrPath(qr: ReturnType<typeof qrcode>, count: number): string {
    const parts: string[] = [];
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
        }
    }
    return parts.join('');
}

/** QR pronto pra desenhar num <svg>: lado em módulos e o path. */
export function desenharQr(texto: string): { count: number; path: string } {
    const qr = qrcode(0, 'L');
    qr.addData(texto);
    qr.make();
    const count = qr.getModuleCount();
    return { count, path: qrPath(qr, count) };
}

/** Mesmo teto do backup por QR (backupService): legível da distância da sala. */
export const MAX_BYTES_QR = 2200;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Divide os itens em páginas de QR: cada página é um texto que se importa
 * sozinho (`pagina` monta o JSON). Um item que nem sozinho cabe vai mesmo
 * assim, numa página só dele.
 */
export function paginasQr<T>(itens: readonly T[], pagina: (i: T[]) => string, max = MAX_BYTES_QR): string[] {
    const paginas: string[] = [];
    let atual: T[] = [];
    for (const item of itens) {
        if (atual.length > 0 && bytes(pagina([...atual, item])) > max) {
            paginas.push(pagina(atual));
            atual = [];
        }
        atual.push(item);
    }
    if (atual.length > 0) paginas.push(pagina(atual));
    return paginas;
}
