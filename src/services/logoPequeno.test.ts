// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tamanhoMiniatura, reduzir } from './logoPequeno';

describe('tamanhoMiniatura', () => {
    it('reduz a logo gigante do provedor mantendo a proporção', () => {
        expect(tamanhoMiniatura(3500, 3495)).toEqual([128, 128]);
        expect(tamanhoMiniatura(1200, 696)).toEqual([128, 74]);
        expect(tamanhoMiniatura(696, 1200)).toEqual([74, 128]);
    });
    it('não amplia logo pequena nem quebra com tamanho zero', () => {
        expect(tamanhoMiniatura(64, 32)).toEqual([64, 32]);
        expect(tamanhoMiniatura(0, 0)).toEqual([0, 0]);
    });
});

// Host sem CORS: com crossOrigin a imagem falha; sem, carrega
class ImagemSemCors {
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 300;
    naturalHeight = 150;
    set src(url: string) {
        const quebrada = url.includes('quebrada');
        setTimeout(() => (this.crossOrigin || quebrada ? this.onerror?.() : this.onload?.()), 0);
    }
}

describe('reduzir (logo de host sem CORS)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('recusou com CORS: usa a URL original em vez de ficar sem logo (app desktop)', async () => {
        vi.stubGlobal('Image', ImagemSemCors);
        await expect(reduzir('http://logos/canal.png')).resolves.toBe('http://logos/canal.png');
    });

    it('não carrega nem sem CORS: falha (vira placeholder e espera 30 min)', async () => {
        vi.stubGlobal('Image', ImagemSemCors);
        await expect(reduzir('http://logos/quebrada.png')).resolves.toBeNull();
    });
});
