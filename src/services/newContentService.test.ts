// newContentService: baseline por playlist + diff no "Recarregar lista".
// api.ts é mockado (sem rede real); playlistService, kidsFilter e
// parentalService rodam de verdade sobre o localStorage falso — cobre a
// integração real do gating, não só a forma dos mocks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import type { LiveStream, VODStream, Series, Category } from '../types';

// vi.mock é hoisted pro topo do arquivo — os mocks referenciados na factory
// precisam nascer no MESMO hoist (vi.hoisted), senão o closure lê a const
// antes dela existir (TDZ).
const { live, vod, series, liveCats, vodCats, seriesCats } = vi.hoisted(() => ({
    live: vi.fn<() => Promise<LiveStream[]>>(),
    vod: vi.fn<() => Promise<VODStream[]>>(),
    series: vi.fn<() => Promise<Series[]>>(),
    liveCats: vi.fn<() => Promise<Category[]>>(),
    vodCats: vi.fn<() => Promise<Category[]>>(),
    seriesCats: vi.fn<() => Promise<Category[]>>(),
}));

vi.mock('./api', () => ({
    api: {
        getLiveStreams: () => live(),
        getVODStreams: () => vod(),
        getSeries: () => series(),
        getLiveCategories: () => liveCats(),
        getVodCategories: () => vodCats(),
        getSeriesCategories: () => seriesCats(),
    },
}));

const channel = (id: number, name = `Canal ${id}`, category_id = 'cat-live'): LiveStream => ({
    num: id, name, stream_id: id, stream_icon: '', category_id, epg_channel_id: '',
} as LiveStream);

const movie = (id: number, name = `Filme ${id}`, category_id = 'cat-vod'): VODStream => ({
    num: id, name, stream_id: id, category_id,
} as VODStream);

const show = (id: number, name = `Série ${id}`, category_id = 'cat-series'): Series => ({
    num: id, name, series_id: id, category_id,
} as Series);

const cat = (id: string, name: string): Category => ({ category_id: id, category_name: name, parent_id: 0 });

async function importFresh() {
    vi.resetModules();
    return import('./newContentService');
}

beforeEach(() => {
    installFakeStorage();
    live.mockReset().mockResolvedValue([]);
    vod.mockReset().mockResolvedValue([]);
    series.mockReset().mockResolvedValue([]);
    liveCats.mockReset().mockResolvedValue([]);
    vodCats.mockReset().mockResolvedValue([]);
    seriesCats.mockReset().mockResolvedValue([]);
});

describe('checkForNewContent', () => {
    it('primeira vez (sem baseline) semeia e não devolve diff', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1), channel(2)]);

        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([]);
    });

    it('segunda chamada detecta só os ids novos', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1), channel(2)]);
        await newContentService.checkForNewContent();

        live.mockResolvedValue([channel(1), channel(2), channel(3, 'Canal Novo')]);
        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([{ id: 3, name: 'Canal Novo', type: 'live' }]);
    });

    it('combina novidade de canais, filmes e séries', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1)]);
        vod.mockResolvedValue([movie(1)]);
        series.mockResolvedValue([show(1)]);
        await newContentService.checkForNewContent();

        live.mockResolvedValue([channel(1), channel(2)]);
        vod.mockResolvedValue([movie(1), movie(2)]);
        series.mockResolvedValue([show(1), show(2)]);
        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([
            { id: 2, name: 'Canal 2', type: 'live' },
            { id: 2, name: 'Filme 2', type: 'vod' },
            { id: 2, name: 'Série 2', type: 'series' },
        ]);
    });

    it('item removido do catálogo não aparece como novidade nem quebra o diff', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1), channel(2)]);
        await newContentService.checkForNewContent();

        live.mockResolvedValue([channel(2)]);
        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([]);
    });

    it('categoria travada por PIN (fora do perfil Kids) nunca aparece como novidade', async () => {
        const { newContentService } = await importFresh();
        liveCats.mockResolvedValue([cat('cat-live', 'Geral'), cat('cat-xxx', 'Canais XXX')]);
        live.mockResolvedValue([channel(1)]);
        await newContentService.checkForNewContent();

        live.mockResolvedValue([channel(1), channel(2, 'Canal Novo', 'cat-live'), channel(3, 'Canal Adulto', 'cat-xxx')]);
        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([{ id: 2, name: 'Canal Novo', type: 'live' }]);
    });

    it('tipo desligado por contentFlags não é buscado nem aparece no diff', async () => {
        localStorage.setItem('includeVOD', 'false');
        const { newContentService } = await importFresh();

        const result = await newContentService.checkForNewContent();

        expect(vod).not.toHaveBeenCalled();
        expect(series).not.toHaveBeenCalled();
        expect(result).toEqual([]);
    });
});

describe('seedIfNeeded', () => {
    it('não busca nem toca o baseline quando já existe', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1)]);
        await newContentService.checkForNewContent();
        live.mockClear();

        await newContentService.seedIfNeeded();

        expect(live).not.toHaveBeenCalled();
    });

    it('sem baseline, cria um e o diff seguinte detecta só o que veio depois', async () => {
        const { newContentService } = await importFresh();
        live.mockResolvedValue([channel(1)]);

        await newContentService.seedIfNeeded();

        live.mockResolvedValue([channel(1), channel(2)]);
        const result = await newContentService.checkForNewContent();

        expect(result).toEqual([{ id: 2, name: 'Canal 2', type: 'live' }]);
    });
});

describe('pending check flag', () => {
    it('markPendingCheck não grava nada se a notificação estiver desligada', async () => {
        const { newContentService } = await importFresh();
        newContentService.setNotifyEnabled(false);

        newContentService.markPendingCheck();

        expect(newContentService.consumePendingCheck()).toBe(false);
    });

    it('consumePendingCheck limpa a flag e só vale uma vez', async () => {
        const { newContentService } = await importFresh();
        newContentService.markPendingCheck();

        expect(newContentService.consumePendingCheck()).toBe(true);
        expect(newContentService.consumePendingCheck()).toBe(false);
    });

    it('desligar a notificação depois de marcar a flag invalida o consumo', async () => {
        const { newContentService } = await importFresh();
        newContentService.markPendingCheck();
        newContentService.setNotifyEnabled(false);

        expect(newContentService.consumePendingCheck()).toBe(false);
    });
});

describe('isNotifyEnabled / setNotifyEnabled', () => {
    it('ligado por padrão', async () => {
        const { newContentService } = await importFresh();
        expect(newContentService.isNotifyEnabled()).toBe(true);
    });

    it('setNotifyEnabled(false) persiste e setNotifyEnabled(true) volta ao padrão', async () => {
        const { newContentService } = await importFresh();
        newContentService.setNotifyEnabled(false);
        expect(newContentService.isNotifyEnabled()).toBe(false);
        newContentService.setNotifyEnabled(true);
        expect(newContentService.isNotifyEnabled()).toBe(true);
    });
});
