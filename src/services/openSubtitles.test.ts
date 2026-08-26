// Cliente do OpenSubtitles.com — fetch mockado, sem chamada de rede real.
// Cobre o contrato defensivo que o resto do app depende de: nunca lança,
// sem chave configurada some antes de qualquer requisição.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { storage } from './storage';
import { searchSubtitles, resolveSubtitleTrack } from './openSubtitles';

function jsonResponse(body: unknown, ok = true): Response {
    return {
        ok,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

beforeEach(() => {
    installFakeStorage();
    vi.stubGlobal('fetch', vi.fn());
});

describe('searchSubtitles', () => {
    it('sem chave configurada, não chama fetch e devolve lista vazia', async () => {
        const results = await searchSubtitles({ title: 'Matrix', languages: 'pt' });
        expect(results).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('projeta e ordena por download_count desc', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
            data: [
                { attributes: { release: 'Menos baixada', language: 'pt', download_count: 5, files: [{ file_id: 1 }] } },
                { attributes: { release: 'Mais baixada', language: 'pt', download_count: 500, files: [{ file_id: 2 }] } },
            ],
        }));

        const results = await searchSubtitles({ title: 'Matrix', year: '1999', languages: 'pt' });

        expect(results).toEqual([
            { fileId: 2, release: 'Mais baixada', lang: 'pt', downloadCount: 500 },
            { fileId: 1, release: 'Menos baixada', lang: 'pt', downloadCount: 5 },
        ]);
    });

    it('resposta HTTP não-ok vira lista vazia, sem lançar', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false));

        await expect(searchSubtitles({ title: 'Matrix', languages: 'pt' })).resolves.toEqual([]);
    });

    it('erro de rede vira lista vazia, sem lançar', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockRejectedValueOnce(new Error('sem rede'));

        await expect(searchSubtitles({ title: 'Matrix', languages: 'pt' })).resolves.toEqual([]);
    });

    it('busca repetida dentro do TTL não chama fetch de novo', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
            data: [{ attributes: { release: 'X', language: 'pt', download_count: 1, files: [{ file_id: 9 }] } }],
        }));

        const query = { title: 'Matrix', languages: 'pt' };
        await searchSubtitles(query);
        const second = await searchSubtitles(query);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(second).toEqual([{ fileId: 9, release: 'X', lang: 'pt', downloadCount: 1 }]);
    });

    it('busca por episódio omite o ano mesmo quando fornecido', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: [] }));

        await searchSubtitles({ title: 'Série X', year: '2020', season: 2, episode: 5, languages: 'pt' });

        const calledUrl = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
        expect(calledUrl.searchParams.get('year')).toBeNull();
        expect(calledUrl.searchParams.get('season_number')).toBe('2');
        expect(calledUrl.searchParams.get('episode_number')).toBe('5');
    });
});

describe('resolveSubtitleTrack', () => {
    it('sem chave configurada devolve null sem chamar fetch', async () => {
        expect(await resolveSubtitleTrack(1)).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('encadeia download + fetch do arquivo + conversão SRT->VTT', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse({ link: 'https://cdn.example/x.srt', file_name: 'x.srt' }))
            .mockResolvedValueOnce({
                ok: true,
                text: async () => '1\n00:00:01,000 --> 00:00:02,000\nOlá\n',
            } as Response);

        const resolved = await resolveSubtitleTrack(42);

        expect(resolved).toEqual({
            vtt: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nOlá\n',
            fileName: 'x.srt',
        });
    });

    it('falha no /download devolve null sem chamar o fetch do arquivo', async () => {
        storage.saveOpenSubtitlesApiKey('chave-de-teste');
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false));

        expect(await resolveSubtitleTrack(42)).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
