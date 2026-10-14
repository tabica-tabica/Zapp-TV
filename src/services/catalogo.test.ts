// Camada pura de nomes e agrupamento do catálogo.
//
// Estes cinco módulos não tocam DOM, rede nem armazenamento, e é onde os bugs
// de catálogo apareceram de verdade nas rodadas anteriores. Cada bloco abaixo
// tem pelo menos um caso que JÁ QUEBROU em produção — estão marcados.

import { describe, it, expect } from 'vitest';
import { versionBaseName, groupVodVersions, versionLabel, tagsOf, rotulosDasVersoes } from './vodVariants';
import { isRadioChannel } from './liveDiscovery';
import { fuzzyMatches, normalizeSearch, isRecentlyAdded } from './catalogExtras';
import { isAdultCategoryName } from './kidsFilter';
import type { LiveStream, VODStream } from '../types';

const filme = (name: string, id = 1): VODStream => ({
    num: id, name, stream_type: 'movie', stream_id: id, stream_icon: '',
    container_extension: 'mp4', custom_sid: '', direct_source: '', added: '0',
    category_id: '1', rating: '0', rating_5based: 0, backdrop_path: [],
    youtube_trailer: '', episode_run_time: '', cover: '', plot: '', cast: '',
    director: '', genre: '', release_date: '', tmdb_id: '',
});

const canal = (name: string, extra: Partial<LiveStream> = {}): LiveStream => ({
    num: 1, name, stream_type: 'live', stream_id: 1, stream_icon: '',
    epg_channel_id: '', added: '0', category_id: '1', custom_sid: '',
    tv_archive: 0, direct_source: '', tv_archive_duration: 0, ...extra,
});

describe('versionBaseName', () => {
    it('agrupa dublado e legendado do mesmo filme', () => {
        expect(versionBaseName('Matrix [DUB]')).toBe(versionBaseName('Matrix [LEG]'));
    });

    it('agrupa as marcas de qualidade', () => {
        expect(versionBaseName('Duna 4K')).toBe(versionBaseName('Duna FHD'));
    });

    // BUG REAL (R3): o ano era removido junto com as marcas, e três filmes
    // diferentes viravam um card só.
    it('NÃO funde refilmagens: o ano faz parte da identidade', () => {
        const a = versionBaseName('Batman (1989)');
        const b = versionBaseName('Batman (2022)');
        const c = versionBaseName('Batman (1966)');
        expect(new Set([a, b, c]).size).toBe(3);
    });

    it('trata nome que vira vazio depois da poda', () => {
        expect(versionBaseName('[DUB]')).not.toBe('');
    });
});

describe('groupVodVersions', () => {
    it('devolve um card por obra e guarda as versões', () => {
        const { groups, versionsOf } = groupVodVersions([
            filme('Matrix [DUB]', 1),
            filme('Matrix [LEG]', 2),
            filme('Duna (2021)', 3),
        ]);
        expect(groups).toHaveLength(2);
        // Só quem TEM irmãos entra no mapa de versões
        const comVersoes = groups.filter(g => versionsOf.has(String(g.stream_id)));
        expect(comVersoes).toHaveLength(1);
        expect(versionsOf.get(String(comVersoes[0].stream_id))).toHaveLength(2);
    });

    it('não perde nenhum título', () => {
        const entrada = [filme('Matrix [DUB]', 1), filme('Matrix [LEG]', 2), filme('Duna', 3)];
        const { groups, versionsOf } = groupVodVersions(entrada);
        const total = groups.reduce(
            (n, g) => n + (versionsOf.get(String(g.stream_id))?.length ?? 1),
            0
        );
        expect(total).toBe(entrada.length);
    });
});

describe('legendado "[L]" do painel (14/10/2026)', () => {
    const nomes = ['007 Contra GoldenEye (1995)', '007 Contra GoldenEye (1995) [L]', '007 Contra GoldenEye (1995) [4K]'];

    it('agrupa com a dublada e a 4K, como as outras versões', () => {
        expect(new Set(nomes.map(versionBaseName)).size).toBe(1);
        expect(versionBaseName('MIB: Internacional [L] (2019)')).toBe(versionBaseName('MIB: Internacional (2019)'));
    });

    it('a dublada representa o card (abrir toca a de sempre); 4K ainda ganha', () => {
        const so = groupVodVersions([filme(nomes[1], 2), filme(nomes[0], 1)]);
        expect(so.groups.map(g => g.stream_id)).toEqual([1]);
        const com4k = groupVodVersions(nomes.map((n, i) => filme(n, i + 1)));
        expect(com4k.groups.map(g => g.stream_id)).toEqual([3]);
    });

    it('rótulos: LEG no [L], DUB na sem marca, 4K DUB na 4K', () => {
        expect(nomes.map(n => versionLabel(n, nomes))).toEqual(['DUB', 'LEG', '4K DUB']);
        // Sem legendado no grupo, nada de inventar DUB
        expect(versionLabel('Duna (2021) [4K]', ['Duna (2021)', 'Duna (2021) [4K]'])).toBe('4K');
    });

    it('versão repetida pelo painel ganha número no botão', () => {
        expect(rotulosDasVersoes(['A Gangue (2021)', 'A Gangue (2021) [L]', 'A Gangue [L] (2021)'])).toEqual(['DUB', 'LEG', 'LEG 2']);
    });

    it('séries: mesmo agrupamento, pela chave series_id', () => {
        const series = [
            { series_id: 10, name: 'A Coleção' },
            { series_id: 11, name: 'A Coleção [L]' },
            { series_id: 12, name: 'Dark' },
        ];
        const { groups, versionsOf } = groupVodVersions(series, s => s.series_id, true);
        expect(groups.map(s => s.series_id)).toEqual([10, 12]);
        expect(versionsOf.get('10')?.map(s => s.series_id)).toEqual([10, 11]);
    });

    it('séries: mesmo nome sem marca são obras diferentes (original e remake) e NÃO juntam', () => {
        const series = [
            { series_id: 1, name: 'Elas por Elas' },
            { series_id: 2, name: 'Elas por Elas' },
            { series_id: 3, name: 'Elas por Elas [L]' },
            { series_id: 4, name: 'Esmeralda' },
            { series_id: 5, name: 'Esmeralda' },
        ];
        const { groups, versionsOf } = groupVodVersions(series, s => s.series_id, true);
        expect(groups).toHaveLength(5);
        expect(versionsOf.size).toBe(0);
    });

    it('"L" solto no título não é legendado', () => {
        expect(versionBaseName('L.A. Confidential (1997)')).not.toBe(versionBaseName('A. Confidential (1997)'));
        expect(tagsOf('L.A. Confidential (1997)')).toEqual([]);
    });
});

describe('isRadioChannel', () => {
    // BUG REAL (R4): a checagem por substring (" am") casava com nomes de
    // canais de TV e escondia o vídeo atrás da tela de áudio.
    it.each([
        'TV Amazonas',
        'Band Amapá',
        'Canal América',
        'Prime Amazon',
    ])('não confunde canal de TV com rádio: %s', (nome) => {
        expect(isRadioChannel(canal(nome))).toBe(false);
    });

    it.each([
        'Jovem Pan FM',
        'Rádio Globo',
        'CBN AM',
        'Radio Mix',
    ])('detecta rádio de verdade: %s', (nome) => {
        expect(isRadioChannel(canal(nome))).toBe(true);
    });

    it('a categoria manda mais que o nome', () => {
        expect(isRadioChannel(canal('Qualquer Coisa'), 'RÁDIOS')).toBe(true);
    });

    it('canal com EPG nunca é rádio, por mais sugestivo que seja o nome', () => {
        expect(isRadioChannel(canal('FM TV', { epg_channel_id: 'fmtv.br' }))).toBe(false);
    });
});

describe('busca do catálogo', () => {
    it('normaliza acento e caixa', () => {
        expect(normalizeSearch('Coração À Noite')).toBe(normalizeSearch('coracao a noite'));
    });

    it('perdoa UM erro de digitação (distância 1)', () => {
        expect(fuzzyMatches('vingadres', 'vingadores')).toBe(true);
        expect(fuzzyMatches('matrx', 'matrix')).toBe(true);
    });

    it('não perdoa dois erros', () => {
        expect(fuzzyMatches('vngadrs', 'vingadores')).toBe(false);
    });
});

describe('isRecentlyAdded', () => {
    const agora = new Date(2026, 7, 21, 12, 0, 0).getTime();
    const diasAtras = (d: number) => String(Math.floor((agora - d * 86400000) / 1000));

    it('conta o que entrou nos últimos dias', () => {
        expect(isRecentlyAdded({ name: 'X', added: diasAtras(2) }, agora)).toBe(true);
    });

    it('não conta o que é antigo', () => {
        expect(isRecentlyAdded({ name: 'X', added: diasAtras(90) }, agora)).toBe(false);
    });

    it('data ausente não é novidade', () => {
        expect(isRecentlyAdded({ name: 'X', added: '' }, agora)).toBe(false);
    });
});

describe('isAdultCategoryName', () => {
    it.each(['ADULTOS', 'XXX', 'Canais +18', 'Adulto | Premium'])(
        'barra categoria adulta: %s', (nome) => {
            expect(isAdultCategoryName(nome)).toBe(true);
        });

    // O gate é ancorado de propósito: sem isso, "Documentários" e "Sextante"
    // seriam classificados como adultos por conterem trechos de palavra.
    it.each(['Documentários', 'Filmes', 'Infantil', 'Sexta-feira'])(
        'não barra categoria inocente: %s', (nome) => {
            expect(isAdultCategoryName(nome)).toBe(false);
        });
});
