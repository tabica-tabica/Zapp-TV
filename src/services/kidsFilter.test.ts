// Detecção de categoria adulta pro perfil Kids — mesma calibração de
// tools/m3u-transformer/adult.ts (achados reais contra .agents/tv_channels.m3u),
// cópia independente porque CLI e app são pacotes isolados sem import compartilhado.

import { describe, it, expect } from 'vitest';
import { isAdultCategoryName } from './kidsFilter';

describe('isAdultCategoryName', () => {
    it('detecta marcas conhecidas de conteúdo adulto', () => {
        expect(isAdultCategoryName('Hentai')).toBe(true);
        expect(isAdultCategoryName('Canais XXX')).toBe(true);
        expect(isAdultCategoryName('Brazzers Collection')).toBe(true);
        expect(isAdultCategoryName('Brasileirinhas Especial')).toBe(true);
        expect(isAdultCategoryName('Filmes Adultos')).toBe(true);
        expect(isAdultCategoryName('[XX] ADULTO 47')).toBe(true);
    });

    // Achados reais (não sintéticos): rodar contra a lista de calibração revelou
    // que "porn"/"adult"/"adulta" soltos casavam com conteúdo mainstream de verdade.
    it('não casa "Pornochanchada" (documentário legítimo, falso positivo real evitado)', () => {
        expect(isAdultCategoryName('O País da Pornochanchada')).toBe(false);
    });

    it('não casa "Adult Swim", "The Adults" ou "Vida Adulta" (mainstream, sem "o" final)', () => {
        expect(isAdultCategoryName('Adult Swim')).toBe(false);
        expect(isAdultCategoryName('The Adults')).toBe(false);
        expect(isAdultCategoryName('Vida Adulta')).toBe(false);
    });

    it('não casa números soltos como "2018"', () => {
        expect(isAdultCategoryName('Lançamentos 2018')).toBe(false);
    });

    it('não casa palavras comuns como "Sexta" ou "Essex"', () => {
        expect(isAdultCategoryName('Filmes de Sexta')).toBe(false);
        expect(isAdultCategoryName('Essex')).toBe(false);
    });
});
