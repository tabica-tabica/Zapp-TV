// Detecção dinâmica de categorias "ruído" — testada contra listas de
// categoria FAKE (não os nomes fixos de uma conta específica), pra provar que
// o mecanismo funciona com QUALQUER nomenclatura de provedor que bata nos
// padrões genéricos, não só a conta usada pra desenhar os padrões.

import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import {
    detectJunkCategories, detectQualityOnlyCategories, isQualityTaggedChannel,
    curatedHiddenPrefs, computeEffectiveVisibility, toggleOverride,
} from './curatedHiddenGroups';

beforeEach(() => {
    installFakeStorage();
});

describe('detectJunkCategories', () => {
    it('detecta categorias que batem nos padrões genéricos, ignorando as que não batem', () => {
        const categories = [
            { category_id: '1', category_name: 'Câmeras' },
            { category_id: '2', category_name: 'Rádios' },
            { category_id: '3', category_name: 'Shows' },
            { category_id: '4', category_name: 'Filmes | Ação' },
            { category_id: '5', category_name: 'Esportes' },
            { category_id: '6', category_name: 'Canais | Dormir e Relaxar' },
            { category_id: '7', category_name: 'Canais | Cine Bit' },
            { category_id: '8', category_name: 'Canais | CazeTV' },
            { category_id: '9', category_name: 'Canais | DAZN' },
            { category_id: '10', category_name: 'Canais | Religiosos' },
            { category_id: '11', category_name: 'Canais | Fórmula 1' },
            { category_id: '12', category_name: 'Canais | Brasileirão' },
            { category_id: '13', category_name: 'Canais | NBA League Pass' },
            { category_id: '14', category_name: 'Canais | UFC Fight Pass' },
            { category_id: '15', category_name: 'Canais | Estaduais' },
            { category_id: '16', category_name: 'Canais | Dual Audio' },
            { category_id: '17', category_name: 'Canais | Prime Video' },
        ];
        const detected = detectJunkCategories(categories);
        expect(detected.map(g => g.categoryId).sort()).toEqual(
            ['1', '10', '11', '12', '13', '14', '15', '16', '17', '2', '3', '6', '7', '8', '9']
        );
    });

    it('duas categorias diferentes batendo no MESMO padrão viram dois grupos separados', () => {
        const categories = [
            { category_id: '10', category_name: 'Canais | 24h Infantil' },
            { category_id: '11', category_name: 'Canais | 24h Variados' },
        ];
        const detected = detectJunkCategories(categories);
        expect(detected).toHaveLength(2);
        expect(detected.map(g => g.categoryId).sort()).toEqual(['10', '11']);
        expect(detected.every(g => g.patternKey === '24h')).toBe(true);
    });

    it('ignora maiúsculas/minúsculas e acento no nome da categoria', () => {
        const categories = [{ category_id: '1', category_name: 'CAMERAS AO VIVO' }];
        expect(detectJunkCategories(categories)).toHaveLength(1);
    });

    it('funciona com nomenclatura de OUTRO provedor, nunca vista antes', () => {
        const categories = [
            { category_id: 'x1', category_name: 'BR - Radios Comunitarias' },
            { category_id: 'x2', category_name: 'PT | Aulas de Yoga' },
            { category_id: 'x3', category_name: 'Notícias Internacionais' },
        ];
        const detected = detectJunkCategories(categories);
        expect(detected.map(g => g.categoryId).sort()).toEqual(['x1', 'x2']);
    });

    it('nenhuma categoria bate quando o provedor não tem nada parecido', () => {
        const categories = [
            { category_id: '1', category_name: 'Globo' },
            { category_id: '2', category_name: 'ESPN' },
        ];
        expect(detectJunkCategories(categories)).toEqual([]);
    });
});

describe('computeEffectiveVisibility / toggleOverride', () => {
    it('sem exceção, segue o padrão do grupo', () => {
        const overrides = new Map<number, boolean>();
        expect(computeEffectiveVisibility(1, false, overrides)).toBe(false);
        expect(computeEffectiveVisibility(1, true, overrides)).toBe(true);
    });

    it('oculta 1 canal específico de um grupo VISÍVEL (hide parcial)', () => {
        let overrides = new Map<number, boolean>();
        overrides = toggleOverride(overrides, 42, true); // grupo visível, canal 42 vira exceção
        expect(computeEffectiveVisibility(42, true, overrides)).toBe(false);
        expect(computeEffectiveVisibility(99, true, overrides)).toBe(true); // resto do grupo intacto
    });

    it('revela 1 canal específico de um grupo OCULTO (unhide parcial)', () => {
        let overrides = new Map<number, boolean>();
        overrides = toggleOverride(overrides, 42, false);
        expect(computeEffectiveVisibility(42, false, overrides)).toBe(true);
        expect(computeEffectiveVisibility(99, false, overrides)).toBe(false);
    });

    it('alternar de volta ao padrão do grupo REMOVE a exceção (sem inchar o armazenamento)', () => {
        let overrides = new Map<number, boolean>();
        overrides = toggleOverride(overrides, 42, true); // diverge: false
        expect(overrides.has(42)).toBe(true);
        overrides = toggleOverride(overrides, 42, true); // converge de volta: true === default
        expect(overrides.has(42)).toBe(false);
    });
});

describe('detectQualityOnlyCategories / isQualityTaggedChannel', () => {
    it('detecta "Esportes" e "Variedades", ignora categorias sem relação', () => {
        const categories = [
            { category_id: '1', category_name: 'Canais | Esportes' },
            { category_id: '2', category_name: 'Canais | Globo' },
            { category_id: '3', category_name: 'Canais | Variedades' },
        ];
        const detected = detectQualityOnlyCategories(categories);
        expect(detected.map(g => g.categoryId).sort()).toEqual(['1', '3']);
    });

    it('reconhece 4K/UHD/FHD/HD, mas NÃO SD (pedido explícito: só essas 3+1)', () => {
        expect(isQualityTaggedChannel('Combate FHD')).toBe(true);
        expect(isQualityTaggedChannel('Esporte Interativo HD')).toBe(true);
        expect(isQualityTaggedChannel('GE TV [4K]')).toBe(true);
        expect(isQualityTaggedChannel('Something UHD')).toBe(true);
        expect(isQualityTaggedChannel('Canal do Poker')).toBe(false);
        expect(isQualityTaggedChannel('Canal SD')).toBe(false);
    });

    it('não confunde com palavra que só CONTÉM a tag ("Hallo!" não vira "HD")', () => {
        expect(isQualityTaggedChannel('Hallo! Anime')).toBe(false);
    });
});

describe('curatedHiddenPrefs.isVisible', () => {
    const groupsByCategory = new Map([
        ['10', { categoryId: '10', categoryName: 'Câmeras', patternKey: 'cameras' }],
    ]);
    const noQualityOnly = new Map();

    it('canal de categoria fora de qualquer grupo detectado é sempre visível', () => {
        const empty = new Set<string>();
        expect(curatedHiddenPrefs.isVisible('Globo', '20', 1, groupsByCategory, empty, noQualityOnly, new Map())).toBe(true);
    });

    it('canal de categoria detectada fica oculto até o grupo ser desocultado', () => {
        const noneUnhidden = new Set<string>();
        expect(curatedHiddenPrefs.isVisible('Câmeras 1', '10', 1, groupsByCategory, noneUnhidden, noQualityOnly, new Map())).toBe(false);

        const groupUnhidden = new Set(['10']);
        expect(curatedHiddenPrefs.isVisible('Câmeras 1', '10', 1, groupsByCategory, groupUnhidden, noQualityOnly, new Map())).toBe(true);
    });

    it('exceção individual força visível mesmo com o grupo oculto', () => {
        const noneUnhidden = new Set<string>();
        const overrides = new Map([[42, true]]);
        expect(curatedHiddenPrefs.isVisible('X', '10', 42, groupsByCategory, noneUnhidden, noQualityOnly, overrides)).toBe(true);
        expect(curatedHiddenPrefs.isVisible('X', '10', 99, groupsByCategory, noneUnhidden, noQualityOnly, overrides)).toBe(false);
    });

    it('exceção individual força oculto mesmo com o grupo visível', () => {
        const groupUnhidden = new Set(['10']);
        const overrides = new Map([[42, false]]);
        expect(curatedHiddenPrefs.isVisible('X', '10', 42, groupsByCategory, groupUnhidden, noQualityOnly, overrides)).toBe(false);
        expect(curatedHiddenPrefs.isVisible('X', '10', 99, groupsByCategory, groupUnhidden, noQualityOnly, overrides)).toBe(true);
    });

    // Achado real: "Esportes" pede ocultação PARCIAL — o padrão não é um
    // boolean único pro grupo, é por canal (olha se o NOME tem 4K/HD/FHD).
    describe('categoria "só com tag de qualidade" (partial hide por nome)', () => {
        const qualityOnlyByCategory = new Map([
            ['20', { categoryId: '20', categoryName: 'Esportes', patternKey: 'esporte' }],
        ]);
        const noUnhiddenGroups = new Set<string>();

        it('canal COM tag de qualidade fica visível por padrão', () => {
            expect(curatedHiddenPrefs.isVisible(
                'Combate FHD', '20', 1, groupsByCategory, noUnhiddenGroups, qualityOnlyByCategory, new Map()
            )).toBe(true);
        });

        it('canal SEM tag de qualidade fica oculto por padrão', () => {
            expect(curatedHiddenPrefs.isVisible(
                'Canal do Poker', '20', 2, groupsByCategory, noUnhiddenGroups, qualityOnlyByCategory, new Map()
            )).toBe(false);
        });

        it('exceção individual ainda funciona nos dois sentidos dentro da categoria', () => {
            const overrides = new Map([[2, true], [1, false]]);
            expect(curatedHiddenPrefs.isVisible(
                'Canal do Poker', '20', 2, groupsByCategory, noUnhiddenGroups, qualityOnlyByCategory, overrides
            )).toBe(true); // revelado manualmente, mesmo sem tag
            expect(curatedHiddenPrefs.isVisible(
                'Combate FHD', '20', 1, groupsByCategory, noUnhiddenGroups, qualityOnlyByCategory, overrides
            )).toBe(false); // ocultado manualmente, mesmo com tag
        });
    });
});

describe('curatedHiddenPrefs persistência (por playlist)', () => {
    it('grupos desocultados e exceções começam vazios (tudo oculto por padrão)', () => {
        expect(curatedHiddenPrefs.getUnhiddenGroups().size).toBe(0);
        expect(curatedHiddenPrefs.getChannelOverrides().size).toBe(0);
    });

    it('setUnhiddenGroups/setChannelOverrides persistem e são lidos de volta', () => {
        curatedHiddenPrefs.setUnhiddenGroups(new Set(['10', '20']));
        curatedHiddenPrefs.setChannelOverrides(new Map([[42, true], [99, false]]));

        expect(curatedHiddenPrefs.getUnhiddenGroups()).toEqual(new Set(['10', '20']));
        expect(curatedHiddenPrefs.getChannelOverrides()).toEqual(new Map([[42, true], [99, false]]));
    });
});
