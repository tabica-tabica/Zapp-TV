// computeDefaultVisibleChannels — mesma pipeline de LiveTV.tsx, chamável
// isolada. Os testes aqui cobrem a COMPOSIÇÃO das peças (ordem certa,
// estado persistido lido corretamente); cada peça individual (padrões de
// categoria, agrupamento de variantes, dedup regional) já tem sua própria
// cobertura em curatedHiddenGroups.test.ts/channelVariants.test.ts/
// regionalVariants.test.ts — não repete aqui.

import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { computeDefaultVisibleChannels, type VisibilityCheckChannel } from './liveVisibility';
import { hiddenChannels, hiddenCategories } from './liveExtras';
import { curatedHiddenPrefs } from './curatedHiddenGroups';
import { regionalPrefs } from './regionalPrefs';

beforeEach(() => {
    installFakeStorage();
});

const CATEGORIES = [
    { category_id: '1', category_name: 'Canais | Diversos' },
    { category_id: '2', category_name: 'Canais | Adultos' },
    { category_id: '3', category_name: 'Canais | Shows' }, // bate no padrão "ruído" 'show'
    { category_id: '4', category_name: 'Canais | Esportes' }, // "só com tag de qualidade"
    { category_id: '5', category_name: 'Canais | Globo' }, // rede nacional (detectCategoryFamilies)
];

function chan(overrides: Partial<VisibilityCheckChannel> & { stream_id: number; name: string; category_id: string }): VisibilityCheckChannel {
    return overrides;
}

describe('computeDefaultVisibleChannels', () => {
    it('canal comum, categoria comum: visível por padrão', () => {
        const streams = [chan({ stream_id: 1, name: 'Globo Nacional', category_id: '1' })];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([1]);
    });

    it('ocultação manual de canal (hiddenChannels) exclui', () => {
        hiddenChannels.toggle(1);
        const streams = [
            chan({ stream_id: 1, name: 'Canal A', category_id: '1' }),
            chan({ stream_id: 2, name: 'Canal B', category_id: '1' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([2]);
    });

    it('ocultação manual de categoria (hiddenCategories) exclui todos os canais dela', () => {
        hiddenCategories.toggle('1');
        const streams = [
            chan({ stream_id: 1, name: 'Canal A', category_id: '1' }),
            chan({ stream_id: 2, name: 'Canal B', category_id: '5' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([2]);
    });

    it('categoria adulta é excluída incondicionalmente, sem checagem de PIN', () => {
        const streams = [
            chan({ stream_id: 1, name: 'Canal Adulto', category_id: '2' }),
            chan({ stream_id: 2, name: 'Canal Normal', category_id: '1' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([2]);
    });

    it('categoria "ruído" curada fica oculta até ser desocultada em bloco', () => {
        const streams = [chan({ stream_id: 1, name: '[SHOW] ACDC', category_id: '3' })];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES)).toEqual([]);

        curatedHiddenPrefs.setUnhiddenGroups(new Set(['3']));
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([1]);
    });

    it('exceção individual revela 1 canal de categoria "ruído" ainda oculta', () => {
        curatedHiddenPrefs.setChannelOverrides(new Map([[1, true]]));
        const streams = [
            chan({ stream_id: 1, name: '[SHOW] Revelado', category_id: '3' }),
            chan({ stream_id: 2, name: '[SHOW] Ainda oculto', category_id: '3' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([1]);
    });

    it('"só com tag de qualidade": canal sem tag fica oculto, com tag fica visível', () => {
        const streams = [
            chan({ stream_id: 1, name: 'Canal do Poker', category_id: '4' }),
            chan({ stream_id: 2, name: 'Combate FHD', category_id: '4' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([2]);
    });

    // Regressão do bug do GNT (ver docs/LIVE_TV_FILTERING_SPEC.md): o corte
    // "só com tag" tem que rodar DEPOIS do agrupamento de variantes, olhando
    // o REPRESENTANTE — senão a variante sem tag é descartada antes de virar
    // fallback do grupo, e o grupo inteiro nem aparece.
    it('agrupa variantes de qualidade ANTES do corte "só com tag" (canal sem tag some, mas o grupo sobrevive pela variante com tag)', () => {
        const streams = [
            chan({ stream_id: 1, name: 'GNT', category_id: '4' }),
            chan({ stream_id: 2, name: 'GNT FHD', category_id: '4' }),
        ];
        const result = computeDefaultVisibleChannels(streams, CATEGORIES);
        expect(result).toHaveLength(1);
        expect(result[0].stream_id).toBe(2); // representante = a variante com tag
    });

    it('dedup de afiliadas por nome: só a primeira variante detectada aparece', () => {
        const streams = [
            chan({ stream_id: 1, name: 'RedeTV!', category_id: '1' }),
            chan({ stream_id: 2, name: 'RedeTV! Guará', category_id: '1' }),
            chan({ stream_id: 3, name: 'RedeTV! Imperial', category_id: '1' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([1]);
    });

    it('dedup de afiliadas por nome respeita seleção salva em regionalPrefs', () => {
        const streams = [
            chan({ stream_id: 1, name: 'RedeTV!', category_id: '1' }),
            chan({ stream_id: 2, name: 'RedeTV! Guará', category_id: '1' }),
        ];
        regionalPrefs.setSelected('redetv!', new Set([2]));
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([2]);
    });

    it('dedup de rede nacional por categoria inteira (Globo): só a primeira praça aparece', () => {
        const streams = [
            chan({ stream_id: 1, name: 'EPTV Campinas', category_id: '5' }),
            chan({ stream_id: 2, name: 'Globo Rio', category_id: '5' }),
            chan({ stream_id: 3, name: 'Globo SP', category_id: '5' }),
        ];
        expect(computeDefaultVisibleChannels(streams, CATEGORIES).map(s => s.stream_id)).toEqual([1]);
    });

    it('catálogo vazio devolve lista vazia', () => {
        expect(computeDefaultVisibleChannels([], CATEGORIES)).toEqual([]);
    });
});
