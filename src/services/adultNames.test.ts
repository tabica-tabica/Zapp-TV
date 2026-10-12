import { describe, it, expect } from 'vitest';
import { isHentaiName, semHentai } from './adultNames';

describe('semHentai', () => {
    const categorias = [
        { category_id: '1', category_name: 'Filmes Adultos' },
        { category_id: '2', category_name: 'Hentai [adultos]' },
        { category_id: '3', category_name: 'Anime' },
    ];

    it('tira a categoria hentai inteira e o título com "hentai" no nome', () => {
        const itens = [
            { category_id: '1', name: '[XXX] Filme' },
            { category_id: '2', name: 'Título sem a palavra' },
            { category_id: '3', name: '[XXX] Hentai 12' },
            { category_id: '3', name: 'Naruto' },
        ];
        expect(semHentai(itens, categorias).map(i => i.name)).toEqual(['[XXX] Filme', 'Naruto']);
    });

    it('sem categorias (falhou o pedido) ainda cai pelo nome', () => {
        expect(semHentai([{ category_id: '2', name: 'Hentai 1' }, { category_id: '2', name: 'Outro' }], []))
            .toEqual([{ category_id: '2', name: 'Outro' }]);
    });

    it('palavra inteira: não casa dentro de outra', () => {
        expect(isHentaiName('Hentai [adultos]')).toBe(true);
        expect(isHentaiName('Shentaiwan')).toBe(false);
    });
});
