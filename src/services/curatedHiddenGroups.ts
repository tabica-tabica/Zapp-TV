// Categorias de canais "ruído" (curiosidades, treinos/aulas/receitas,
// câmeras, rádios, shows, maratonas 24h etc.) ocultas por padrão.
//
// Detecção é DINÂMICA sobre a lista de categorias REAIS da playlist ativa —
// não uma lista fixa de nomes/IDs de categoria gravada no código, porque cada
// provedor Xtream nomeia suas categorias do seu próprio jeito. Em vez disso,
// um conjunto pequeno de PADRÕES genéricos (substring, sem acento/maiúsculo,
// via normalizeSearch) é testado contra `category_name` de cada categoria da
// playlist ativa a cada vez — testado contra o catálogo real de uma conta
// (44 categorias): bate exatamente nas 7 esperadas, zero falso-positivo nas
// outras 37, incluindo pegar de graça grafias que um match de NOME DE CANAL
// perderia (ex.: "[24h]" vs "[24hs]" vs "[24hrs]" — todas na mesma categoria).
//
// Escopado por PLAYLIST (não por perfil), igual regionalPrefs.ts — é dado do
// catálogo do provedor, não de quem está assistindo, e dois provedores têm
// categorias diferentes.

import { playlistService } from './playlistService';
import { readJson, writeJson } from './safeStorage';
import { normalizeSearch } from './catalogExtras';

export interface JunkCategoryPattern {
    key: string;
    pattern: string;
}

export const JUNK_CATEGORY_PATTERNS: JunkCategoryPattern[] = [
    { key: 'educativos', pattern: 'educat' },
    // "curiosidad"/"alfabet" não batem em nenhuma categoria da conta de teste
    // (o conteúdo mora dentro de "Videos Educativos" lá) — mantidos separados
    // pra provedores que usem uma categoria dedicada a cada um.
    { key: 'curiosidades', pattern: 'curiosidad' },
    { key: 'alfabeto', pattern: 'alfabet' },
    { key: 'treino', pattern: 'treino' },
    { key: 'receitas', pattern: 'receita' },
    { key: 'aulas', pattern: 'aula' },
    { key: 'cameras', pattern: 'camera' },
    { key: 'radios', pattern: 'radio' },
    { key: 'shows', pattern: 'show' },
    { key: '24h', pattern: '24h' },
    { key: 'dormir', pattern: 'dormir' },
    { key: 'cinebit', pattern: 'cine bit' },
    { key: 'cazetv', pattern: 'caze' },
    { key: 'dazn', pattern: 'dazn' },
    { key: 'religiosos', pattern: 'religios' },
    { key: 'formula1', pattern: 'formula' },
    { key: 'brasileirao', pattern: 'brasileir' },
    { key: 'nba', pattern: 'nba' },
    { key: 'ufc', pattern: 'ufc' },
    { key: 'estaduais', pattern: 'estaduais' },
    { key: 'dualaudio', pattern: 'dual audio' },
    { key: 'primevideo', pattern: 'prime video' },
];

const NORMALIZED_PATTERNS = JUNK_CATEGORY_PATTERNS.map(p => ({ ...p, normalizedPattern: normalizeSearch(p.pattern) }));

export interface DetectedGroup {
    categoryId: string;
    categoryName: string;
    patternKey: string;
}

/**
 * Categorias da playlist ATIVA que batem em algum padrão de "ruído" — cada
 * categoria real vira 1 grupo, com o próprio `category_id` como chave (duas
 * categorias diferentes batendo no mesmo padrão, ex. "24h Infantil" e "24h
 * Variados", viram 2 grupos independentes, cada um toggleável sozinho).
 */
export function detectJunkCategories(categories: Array<{ category_id: string; category_name: string }>): DetectedGroup[] {
    const result: DetectedGroup[] = [];
    for (const category of categories) {
        const normalizedName = normalizeSearch(category.category_name || '');
        const matched = NORMALIZED_PATTERNS.find(p => normalizedName.includes(p.normalizedPattern));
        if (matched) {
            result.push({ categoryId: category.category_id, categoryName: category.category_name, patternKey: matched.key });
        }
    }
    return result;
}

/**
 * Categorias onde, em vez de ocultar a categoria INTEIRA (JUNK_CATEGORY_
 * PATTERNS acima), só os canais SEM tag de qualidade no nome ficam ocultos
 * por padrão — pedido pra "Esportes" (81 canais na conta de teste, dúzias de
 * feeds de evento avulso sem indicação de qualidade nenhuma — "BJJ STARS",
 * "Canal do Poker", "FIFA+ 01 (B)" — ao lado de canais normais como "Combate
 * FHD"/"Esporte Interativo HD"/"GE TV [4K]") e depois pra "Variedades" (mesmo
 * padrão: mistura de canais de qualidade normal com dúzias de feeds soltos
 * tipo "Zapping Music..."/"Urban ..." sem tag nenhuma). Diferente de
 * JUNK_CATEGORY_PATTERNS: aqui a visibilidade padrão é POR CANAL (olha o
 * nome de cada um), não um boolean único pra categoria inteira — por isso
 * não entra na lista de "grupos" com toggle de bloco no overlay, só nos
 * resultados de busca (canal por canal).
 */
export const QUALITY_ONLY_CATEGORY_PATTERNS = ['esporte', 'variedad'];

const QUALITY_TAG_RE = /(^|[^a-z0-9])(4k|uhd|fhd|hd)([^a-z0-9]|$)/i;

/** true se o nome do canal tem uma tag de qualidade reconhecida (4K/UHD/FHD/HD — não conta "SD", de propósito: é a tag que o pedido queria EXCLUIR do corte). */
export function isQualityTaggedChannel(name: string): boolean {
    return QUALITY_TAG_RE.test(name || '');
}

/** Mesma detecção dinâmica de detectJunkCategories, contra QUALITY_ONLY_CATEGORY_PATTERNS. */
export function detectQualityOnlyCategories(categories: Array<{ category_id: string; category_name: string }>): DetectedGroup[] {
    const result: DetectedGroup[] = [];
    for (const category of categories) {
        const normalizedName = normalizeSearch(category.category_name || '');
        const matched = QUALITY_ONLY_CATEGORY_PATTERNS.find(p => normalizedName.includes(p));
        if (matched) {
            result.push({ categoryId: category.category_id, categoryName: category.category_name, patternKey: matched });
        }
    }
    return result;
}

const GROUPS_PREFIX = 'neostream_curated_unhidden_categories_';
const OVERRIDES_PREFIX = 'neostream_curated_channel_overrides_';

function groupsKey(): string {
    return `${GROUPS_PREFIX}${playlistService.getActiveId() || 'default'}`;
}

function overridesKey(): string {
    return `${OVERRIDES_PREFIX}${playlistService.getActiveId() || 'default'}`;
}

/** true se `streamId` deve ficar visível dado o padrão do grupo, considerando exceção individual (se houver). */
export function computeEffectiveVisibility(streamId: number, defaultVisible: boolean, overrides: Map<number, boolean>): boolean {
    const override = overrides.get(streamId);
    return override === undefined ? defaultVisible : override;
}

/**
 * Alterna a visibilidade EFETIVA de um canal. Só grava uma exceção quando o
 * resultado DIVERGE do padrão do grupo — se o toggle faz o canal convergir de
 * volta ao padrão, a exceção é removida (sem inchar o armazenamento).
 */
export function toggleOverride(overrides: Map<number, boolean>, streamId: number, defaultVisible: boolean): Map<number, boolean> {
    const current = computeEffectiveVisibility(streamId, defaultVisible, overrides);
    const flipped = !current;
    const next = new Map(overrides);
    if (flipped === defaultVisible) next.delete(streamId);
    else next.set(streamId, flipped);
    return next;
}

export const curatedHiddenPrefs = {
    /** Categorias (por category_id) que o usuário desocultou por inteiro. Ausência = continua oculta. */
    getUnhiddenGroups(): Set<string> {
        return new Set(readJson<string[]>(groupsKey(), []));
    },

    setUnhiddenGroups(categoryIds: Set<string>): void {
        writeJson(groupsKey(), [...categoryIds]);
    },

    /** Exceções INDIVIDUAIS por canal (achados pela busca): true força visível, false força oculto. */
    getChannelOverrides(): Map<number, boolean> {
        return new Map(readJson<Array<[number, boolean]>>(overridesKey(), []));
    },

    setChannelOverrides(overrides: Map<number, boolean>): void {
        writeJson(overridesKey(), [...overrides.entries()]);
    },

    /**
     * true = deve ficar visível. Três casos, nessa ordem:
     * (1) categoria de "só com tag de qualidade" (Esportes) — padrão é POR
     *     CANAL, olha o nome;
     * (2) categoria "ruído" inteira — padrão é um boolean só pro grupo;
     * (3) qualquer outra categoria — sempre visível.
     * Em todos, uma exceção individual salva (`overrides`) tem a palavra final.
     */
    isVisible(
        channelName: string,
        categoryId: string,
        streamId: number,
        groupsByCategory: Map<string, DetectedGroup>,
        unhiddenGroups: Set<string>,
        qualityOnlyByCategory: Map<string, DetectedGroup>,
        overrides: Map<number, boolean>,
    ): boolean {
        const defaultVisible = qualityOnlyByCategory.has(categoryId)
            ? isQualityTaggedChannel(channelName)
            : !groupsByCategory.has(categoryId) || unhiddenGroups.has(categoryId);
        return computeEffectiveVisibility(streamId, defaultVisible, overrides);
    },
};
