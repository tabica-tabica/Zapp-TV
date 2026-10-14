import { describe, it, expect } from 'vitest';
import { isSportsCategory, isNewsCategory, isKidsCategory, isKidsBrandChannel, isJogosDeHojeChannel, canaisDoModo, modoDoCanal } from './channelGroups';

// Nomes reais do catálogo do painel (14/10/2026)
describe('grupos por categoria', () => {
    it('esporte: as 15 categorias de esporte do catálogo real', () => {
        for (const nome of [
            'Jogos de Hoje', 'Canais | Esportes', 'Canais | Premiere', 'Canais | ESPN', 'Canais | SporTV',
            'Canais | Prime Video', 'Canais | Disney+', 'Canais | MAX', 'Canais | Brasileirão', 'Canais | DAZN',
            'Canais | UFC Fight Pass', 'Canais | Paramount+', 'Canais | Estaduais', 'Canais | NBA League Pass',
            'Canais | Fórmula 1',
        ]) expect(isSportsCategory(nome), nome).toBe(true);
    });

    it('esporte: nenhuma das outras (MAX só com fronteira: Cinemax é filme)', () => {
        for (const nome of [
            'Canais | Abertos', 'Canais | Noticias', 'Canais | Globo', 'Canais | Filmes e Series', 'Canais | Telecine',
            'Canais | HBO', 'Canais | TNT', 'Canais | Variedades', 'Canais | Infantil', 'Canais | 24h Infantil',
            'Canais | Adultos', 'Shows', 'Câmeras', 'Cinemax',
        ]) expect(isSportsCategory(nome), nome).toBe(false);
    });

    it('notícias e infantil', () => {
        expect(isNewsCategory('Canais | Noticias')).toBe(true);
        expect(isNewsCategory('Canais | Variedades')).toBe(false);
        expect(isKidsCategory('Canais | Infantil')).toBe(true);
        expect(isKidsCategory('Canais | 24h Infantil')).toBe(true);
        expect(isKidsCategory('Canais | Abertos')).toBe(false);
    });

    it('Jogos de Hoje é o canal, não qualquer "jogos"', () => {
        expect(isJogosDeHojeChannel('Jogos de Hoje')).toBe(true);
        expect(isJogosDeHojeChannel('Jogos Mortais')).toBe(false);
    });
});

describe('isKidsBrandChannel (perfil Kids)', () => {
    it('marcas infantis conhecidas, em qualquer variante', () => {
        for (const nome of ['Cartoon Network FHD', 'Cartoonito', 'Discovery Kids HD', 'Gloob H265', 'Gloobinho',
            'Nick', 'Nick Jr. HD', 'TV Rá Tim Bum', 'Tooncast HD', 'Disney Channel HD', 'Disney Junior'])
            expect(isKidsBrandChannel(nome), nome).toBe(true);
    });

    it('fora: o que ninguém conferiu, maratona 24h e o Disney+ de esporte', () => {
        for (const nome of ['Box Kids', 'DumDum HD', 'Urban Kids HD', 'TV Loading', 'PlayKids HD', 'BabyFirst',
            '[24hs] Nick Classico', 'Disney+ 11 (B)', 'Nickelback ao vivo'])
            expect(isKidsBrandChannel(nome), nome).toBe(false);
    });
});

describe('modos da grade', () => {
    const adultas = new Set(['4']);
    const esporte = new Set(['814', '1009']);
    const canais = [
        { name: 'Globo HD', category_id: '197' },
        { name: 'Premiere 2 FHD', category_id: '814' },
        { name: 'Jogos de Hoje', category_id: '1009' },
        { name: 'Canal XXX', category_id: '4' },
        // Esporte com nome adulto: adulto ganha (nunca aparece sem PIN)
        { name: 'Sexy Sports', category_id: '814' },
    ];

    it('normal sem esporte nem adulto; Jogos com o "Jogos de Hoje" primeiro; adulto só adulto', () => {
        expect(canaisDoModo(canais, 'normal', adultas, esporte).map(c => c.name)).toEqual(['Globo HD']);
        expect(canaisDoModo(canais, 'jogos', adultas, esporte).map(c => c.name)).toEqual(['Jogos de Hoje', 'Premiere 2 FHD']);
        expect(canaisDoModo(canais, 'adulto', adultas, esporte).map(c => c.name)).toEqual(['Canal XXX', 'Sexy Sports']);
    });

    it('modoDoCanal decide pra onde o último canal assistido leva', () => {
        expect(modoDoCanal(canais[2], adultas, esporte)).toBe('jogos');
        expect(modoDoCanal(canais[0], adultas, esporte)).toBe('normal');
    });
});
