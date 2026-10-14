// Detecção de conteúdo novo no catálogo (canais/filmes/séries) desde o
// último snapshot local — mesma ideia do baseline de "novos episódios" de
// séries seguidas (catalogExtras.ts, `newEpisodes`), generalizada pro
// catálogo inteiro: guarda só os ids vistos por playlist, e no próximo
// "Recarregar lista" compara o que o provedor tem agora contra esse baseline.
//
// O fetch acontece DEPOIS do reload (não antes) — o próprio
// `window.location.reload()` já zera o cache em memória de `api.ts` (TTL de
// 5 min por action), então o fetch daqui aquece esse cache e a página real
// (Home/LiveTV/Movies/Series) reaproveita o resultado segundos depois, sem
// round-trip de rede duplicado.

import { api } from './api';
import { playlistService } from './playlistService';
import { contentFlags } from './contentFlags';
import { kidsFilter, isAdultCategoryName } from './kidsFilter';
import { parentalService } from './parentalService';
import { readJson, writeJson } from './safeStorage';
import type { Category } from '../types';

export type NewContentType = 'live' | 'vod' | 'series';

export interface NewContentItem {
    id: number;
    name: string;
    type: NewContentType;
}

interface Snapshot {
    live: number[];
    vod: number[];
    series: number[];
}

interface GatedEntry {
    id: number;
    name: string;
    type: NewContentType;
}

const SNAPSHOT_PREFIX = 'neostream_content_snapshot_';
const NOTIFY_KEY = 'neostream_notify_new_content';
const PENDING_KEY = 'neostream_content_check_pending';

function snapshotKey(): string {
    return `${SNAPSHOT_PREFIX}${playlistService.getActiveId() || 'default'}`;
}

function readSnapshot(): Snapshot | null {
    return readJson<Snapshot | null>(snapshotKey(), null);
}

function writeSnapshot(snapshot: Snapshot): void {
    writeJson(snapshotKey(), snapshot);
}

/** Categorias travadas por PIN (perfil não-kids) — nunca contam como "novidade". */
function lockedCategoryIds(categories: Category[]): Set<string> {
    if (kidsFilter.isKidsActive() || !parentalService.getGates().adultCategories) return new Set();
    const ids = new Set<string>();
    for (const category of categories) {
        if (isAdultCategoryName(category.category_name || '')) ids.add(category.category_id);
    }
    return ids;
}

/**
 * Busca canais/filmes/séries visíveis pro perfil atual, com o MESMO gating
 * de `searchCatalog.ts` (contentFlags + kids + categoria travada por PIN) —
 * o diálogo de novidade nunca pode listar título que o perfil atual não
 * teria permissão de ver.
 */
async function fetchVisibleEntries(): Promise<{ live: GatedEntry[]; vod: GatedEntry[]; series: GatedEntry[] }> {
    const includeTV = contentFlags.includeTV();
    const includeVOD = contentFlags.includeVOD();

    const [liveStreams, vodStreams, seriesList, liveCats, vodCats, seriesCats] = await Promise.all([
        includeTV ? api.getLiveStreams() : Promise.resolve([]),
        includeVOD ? api.getVODStreams() : Promise.resolve([]),
        includeVOD ? api.getSeries() : Promise.resolve([]),
        includeTV ? api.getLiveCategories() : Promise.resolve([]),
        includeVOD ? api.getVodCategories() : Promise.resolve([]),
        includeVOD ? api.getSeriesCategories() : Promise.resolve([]),
    ]);

    const gatedLive = kidsFilter.apply(liveStreams, liveCats, 'live');
    const gatedVod = kidsFilter.apply(vodStreams, vodCats, 'vod');
    const gatedSeries = kidsFilter.apply(seriesList, seriesCats, 'vod');

    const lockedLive = lockedCategoryIds(gatedLive.categories);
    const lockedVod = lockedCategoryIds(gatedVod.categories);
    const lockedSeries = lockedCategoryIds(gatedSeries.categories);

    return {
        live: gatedLive.items
            .filter(item => !lockedLive.has(item.category_id))
            .map(item => ({ id: item.stream_id, name: item.name, type: 'live' as const })),
        vod: gatedVod.items
            .filter(item => !lockedVod.has(item.category_id))
            .map(item => ({ id: item.stream_id, name: item.name, type: 'vod' as const })),
        series: gatedSeries.items
            .filter(item => !lockedSeries.has(item.category_id))
            .map(item => ({ id: item.series_id, name: item.name, type: 'series' as const })),
    };
}

function diffAgainst(entries: GatedEntry[], knownIds: number[]): NewContentItem[] {
    const known = new Set(knownIds);
    return entries.filter(entry => !known.has(entry.id));
}

export const newContentService = {
    isNotifyEnabled(): boolean {
        return localStorage.getItem(NOTIFY_KEY) !== 'false';
    },

    setNotifyEnabled(value: boolean): void {
        try {
            if (value) localStorage.removeItem(NOTIFY_KEY);
            else localStorage.setItem(NOTIFY_KEY, 'false');
        } catch {
            // Quota cheia numa TV — o toggle na tela já mudou, só a
            // persistência falhou; próxima gravação bem-sucedida corrige
        }
    },

    /** Grava "checar no próximo boot" — só se a notificação estiver ligada. */
    markPendingCheck(): void {
        if (!this.isNotifyEnabled()) return;
        try {
            localStorage.setItem(PENDING_KEY, playlistService.getActiveId() || 'default');
        } catch {
            // Sem drama — só significa que o próximo boot não vai checar
        }
    },

    /** Consome a flag pendente (sempre limpa); só devolve true se valia pra
     *  playlist ativa E a notificação segue ligada. */
    consumePendingCheck(): boolean {
        let pending: string | null = null;
        try {
            pending = localStorage.getItem(PENDING_KEY);
            localStorage.removeItem(PENDING_KEY);
        } catch {
            return false;
        }
        if (!pending || !this.isNotifyEnabled()) return false;
        return pending === (playlistService.getActiveId() || 'default');
    },

    /** Primeira vez que a playlist ativa é vista: cria o baseline em silêncio. */
    async seedIfNeeded(): Promise<void> {
        if (readSnapshot()) return;
        try {
            await this.checkForNewContent();
        } catch {
            // Sem playlist ativa ainda ou provedor fora do ar — tenta de
            // novo na próxima chamada (nada fica marcado como "feito")
        }
    },

    /** Compara contra o baseline salvo, atualiza o baseline e devolve os
     *  itens novos (vazio se não havia baseline — primeira vez é seed). */
    async checkForNewContent(): Promise<NewContentItem[]> {
        const previous = readSnapshot();
        const { live, vod, series } = await fetchVisibleEntries();
        writeSnapshot({
            live: live.map(entry => entry.id),
            vod: vod.map(entry => entry.id),
            series: series.map(entry => entry.id),
        });
        if (!previous) return [];
        return [
            ...diffAgainst(live, previous.live),
            ...diffAgainst(vod, previous.vod),
            ...diffAgainst(series, previous.series),
        ];
    },
};
