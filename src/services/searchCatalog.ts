// Catálogo unificado pra busca global (Fase 4b): canais + filmes + séries
// com cache em memória (a busca abre e fecha toda hora; refetch seria brutal
// numa TV). Ranking simples com normalização de acentos.

import { api } from './api';
import { kidsFilter, isAdultCategoryName } from './kidsFilter';
import { contentFlags } from './contentFlags';
import { parentalService } from './parentalService';
import type { LiveStream, VODStream, Series, Category } from '../types';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SearchCatalogData {
    channels: LiveStream[];
    movies: VODStream[];
    series: Series[];
}

let cache: { at: number; kids: boolean; includeTV: boolean; includeVOD: boolean; adultGate: boolean; data: SearchCatalogData } | null = null;
let inflight: Promise<SearchCatalogData> | null = null;

export function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

export async function loadSearchCatalog(): Promise<SearchCatalogData> {
    const kids = kidsFilter.isKidsActive();
    // "Incluir canais de TV"/"Incluir VOD" desmarcados no login: nem busca
    // esse tipo — sem isto a busca global devolvia canal/filme/série que o
    // usuário disse explicitamente que não queria nessa playlist.
    const includeTV = contentFlags.includeTV();
    const includeVOD = contentFlags.includeVOD();
    const adultGate = parentalService.getGates().adultCategories;
    if (cache && cache.kids === kids && cache.includeTV === includeTV
        && cache.includeVOD === includeVOD && cache.adultGate === adultGate
        && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.data;
    }
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const [channels, movies, series, liveCats, vodCats, seriesCats] = await Promise.all([
                includeTV ? api.getLiveStreams() : Promise.resolve([]),
                includeVOD ? api.getVODStreams() : Promise.resolve([]),
                includeVOD ? api.getSeries() : Promise.resolve([]),
                includeTV ? api.getLiveCategories() : Promise.resolve([]),
                includeVOD ? api.getVodCategories() : Promise.resolve([]),
                includeVOD ? api.getSeriesCategories() : Promise.resolve([]),
            ]);
            let gatedChannels = kidsFilter.apply(channels, liveCats, 'live').items;
            let gatedMovies = kidsFilter.apply(movies, vodCats, 'vod').items;
            let gatedSeries = kidsFilter.apply(series, seriesCats, 'vod').items;
            // Fora do perfil Kids, a busca global ainda não pode devolver
            // categoria travada por PIN — a busca não tem "selecionar a
            // categoria" pra provar o PIN, então some incondicionalmente.
            if (!kids && adultGate) {
                const lockedIds = (cats: Category[]) =>
                    new Set(cats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                const lockedLive = lockedIds(liveCats);
                const lockedVod = lockedIds(vodCats);
                const lockedSeries = lockedIds(seriesCats);
                gatedChannels = gatedChannels.filter(c => !lockedLive.has(c.category_id));
                gatedMovies = gatedMovies.filter(m => !lockedVod.has(m.category_id));
                gatedSeries = gatedSeries.filter(s => !lockedSeries.has(s.category_id));
            }
            const data: SearchCatalogData = {
                channels: gatedChannels,
                movies: gatedMovies,
                series: gatedSeries,
            };
            cache = { at: Date.now(), kids, includeTV, includeVOD, adultGate, data };
            return data;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Score: começa com o termo = 3 · palavra começa = 2 · contém = 1 · nada = 0 */
function scoreName(normalizedName: string, query: string): number {
    if (!normalizedName.includes(query)) return 0;
    if (normalizedName.startsWith(query)) return 3;
    if (normalizedName.includes(' ' + query)) return 2;
    return 1;
}

export function searchIn<T extends { name: string }>(items: T[], query: string, limit: number): T[] {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 2) return [];
    const scored: Array<{ item: T; score: number }> = [];
    for (const item of items) {
        const score = scoreName(normalizeText(item.name || ''), normalizedQuery);
        if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(entry => entry.item);
}

export function clearSearchCatalogCache(): void {
    cache = null;
}
