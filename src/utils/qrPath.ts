import type qrcode from 'qrcode-generator';

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
