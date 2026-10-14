import { describe, it, expect } from 'vitest';
import { tamanhoMiniatura } from './logoPequeno';

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
