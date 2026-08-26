// Testes de fumaça, sem framework — node:test + node:assert (zero deps).
// Rodar: node --experimental-strip-types --test __tests__/*.test.ts
//
// Cobrem exatamente os casos calibrados contra a lista real (ver os
// comentários "calibrado"/"lista real" em classify.ts): marcação por
// colchete, DUAL AUDIO com espaço, ruído de codec, e o falso positivo de
// "Original" que a spec original teria produzido.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, normalizeContent } from '../parse.ts';
import { classifyEntry, buildRootTitle } from '../classify.ts';
import { groupAndSort } from '../group.ts';
import { finalName, renderM3U } from '../render.ts';
import type { M3UEntry, TransformOptions } from '../types.ts';

const OPTIONS: TransformOptions = { defaultGroupVod: 'Filmes', defaultGroupLive: 'Canais' };

function classify(entries: M3UEntry[]): M3UEntry[] {
    return entries.map(e => classifyEntry(e, OPTIONS));
}

test('parseM3U: extrai atributos, título e URL', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="c1" tvg-logo="http://x/c1.png" group-title="Canais",Canal 1 FHD',
        'http://servidor.com/canal1_1080/index.ts',
    ].join('\n');
    const [entry] = parseM3U(m3u);
    assert.equal(entry.attributes.tvgId, 'c1');
    assert.equal(entry.attributes.tvgLogo, 'http://x/c1.png');
    assert.equal(entry.attributes.groupTitle, 'Canais');
    assert.equal(entry.title, 'Canal 1 FHD');
    assert.equal(entry.raw.url, 'http://servidor.com/canal1_1080/index.ts');
});

test('parseM3U: #EXTINF sem atributos (spec §7)', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,Nome Simples\nhttp://x.com/a.mp4\n';
    const [entry] = parseM3U(m3u);
    assert.equal(entry.title, 'Nome Simples');
    assert.deepEqual(entry.attributes, {});
});

test('parseM3U: título com vírgula não quebra o parsing', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Filmes",Titulo, Com Virgula\nhttp://x.com/a.mp4\n';
    const [entry] = parseM3U(m3u);
    assert.equal(entry.title, 'Titulo, Com Virgula');
});

test('normalizeContent: remove BOM e normaliza CRLF', () => {
    const withBom = '﻿#EXTM3U\r\n#EXTINF:-1,X\r\nhttp://x.com/a.ts\r\n';
    const normalized = normalizeContent(withBom);
    assert.ok(!normalized.startsWith('﻿'));
    assert.ok(!normalized.includes('\r'));
});

test('parseM3U: ignora linhas em branco e comentários desconhecidos', () => {
    const m3u = [
        '#EXTM3U',
        '',
        '#EXTVLCOPT:something',
        '#EXTINF:-1,Item',
        'http://x.com/a.mp4',
        '',
    ].join('\n');
    const entries = parseM3U(m3u);
    assert.equal(entries.length, 1);
});

test('classify: .ts vira live, .mp4/.mkv/.avi viram vod', () => {
    const [live, mp4, mkv, avi] = classify(
        parseM3U(
            [
                '#EXTM3U',
                '#EXTINF:-1,Canal',
                'http://x.com/a.ts',
                '#EXTINF:-1,Filme',
                'http://x.com/b.mp4',
                '#EXTINF:-1,Serie',
                'http://x.com/c.mkv',
                '#EXTINF:-1,Outro',
                'http://x.com/d.avi',
            ].join('\n')
        )
    );
    assert.equal(live.contentType, 'live');
    assert.equal(mp4.contentType, 'vod');
    assert.equal(mkv.contentType, 'vod');
    assert.equal(avi.contentType, 'vod');
});

test('classify: group-title com categoria "Filmes"/"Series" força vod mesmo com .ts', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Filmes | Ação",Filme Ao Vivo\nhttp://x.com/a.ts\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.contentType, 'vod');
});

// Achado real ao rodar contra .agents/tv_channels.m3u: 84 canais (A&E, AMC,
// AXN...) ficam sob group-title="Canais | Filmes e Series" — um GRUPO DE
// CANAIS AO VIVO, não uma pasta de VOD. E "AMC Series HD" é o nome de um
// canal ao vivo de verdade, não uma dica de conteúdo gravado. Ambos tinham
// virado "vod" incorretamente antes da categoria ficar ancorada no prefixo.
test('classify: "Filmes"/"Series" dentro do group-title (nao como categoria) NAO força vod', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Canais | Filmes e Series",A&E\nhttp://x.com/a.ts\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.contentType, 'live');
});

test('classify: "Series" no TÍTULO do canal (nao no group-title) NAO força vod', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Canais | Filmes e Series",AMC Series HD\nhttp://x.com/a.ts\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.contentType, 'live');
});

test('classify: qualidade — 4K, FHD nao colide com HD, SD por default', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Canal 4K',
        'http://x.com/a.ts',
        '#EXTINF:-1,Canal FHD',
        'http://x.com/b.ts',
        '#EXTINF:-1,Canal HD',
        'http://x.com/c.ts',
        '#EXTINF:-1,Canal Sem Pista',
        'http://x.com/d.ts',
    ].join('\n');
    const [c4k, fhd, hd, none] = classify(parseM3U(m3u));
    assert.equal(c4k.quality, '4K');
    assert.equal(fhd.quality, 'FHD');
    assert.equal(hd.quality, 'HD');
    assert.equal(none.quality, 'SD');
});

test('classify: [4K] em colchete e [L] como legendado (calibrado na lista real)', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,CNN Brasil [4K]',
        'http://x.com/a.ts',
        '#EXTINF:-1,AMC FHD [L]',
        'http://x.com/b.ts',
    ].join('\n');
    const [k4, leg] = classify(parseM3U(m3u));
    assert.equal(k4.quality, '4K');
    assert.equal(leg.audio, 'Legendado');
});

test('classify: DUAL AUDIO com espaço (calibrado na lista real)', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,Globo Santos HD DUAL AUDIO\nhttp://x.com/a.ts\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.audio, 'Dual Áudio');
});

test('classify: "Original" livre NAO marca áudio (falso positivo real evitado)', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Pecado Original (2001)',
        'http://x.com/a.mp4',
        '#EXTINF:-1,Um Filme Original (2023)',
        'http://x.com/b.mp4',
        '#EXTINF:-1,Show [Original]',
        'http://x.com/c.mp4',
    ].join('\n');
    const [pecado, umFilme, bracket] = classify(parseM3U(m3u));
    assert.equal(pecado.audio, 'Não especificado');
    assert.equal(umFilme.audio, 'Não especificado');
    assert.equal(bracket.audio, 'Original');
});

test('classify: episódio "S16E360" nao é lido como qualidade 360p', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,Naruto Shippuden S16E360\nhttp://x.com/a.mp4\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.quality, 'SD'); // default — "E360" não deve casar \b360\b
    assert.equal(entry.rootTitle, 'Naruto Shippuden S16E360');
});

test('buildRootTitle: remove qualidade/áudio/codec e limpa sobras', () => {
    assert.equal(buildRootTitle('RedeTV! FHD H265'), 'RedeTV!');
    assert.equal(buildRootTitle('Vingadores Ultimato Dublado 1080p'), 'Vingadores Ultimato');
    assert.equal(buildRootTitle('AMC FHD [L]'), 'AMC');
});

test('finalName: formato "Raiz (Áudio - Qualidade)"', () => {
    const [entry] = classify(parseM3U('#EXTM3U\n#EXTINF:-1,Vingadores Dublado 1080p\nhttp://x.com/a.mp4\n'));
    assert.equal(finalName(entry), 'Vingadores (Dublado - FHD)');
});

test('groupAndSort: deduplica por URL exata', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,A',
        'http://x.com/dup.mp4',
        '#EXTINF:-1,A de novo',
        'http://x.com/dup.mp4',
    ].join('\n');
    const { entries, duplicatesRemoved } = groupAndSort(classify(parseM3U(m3u)));
    assert.equal(entries.length, 1);
    assert.equal(duplicatesRemoved, 1);
});

test('groupAndSort: mesma raiz fica adjacente, ordenada por qualidade e depois áudio', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Vingadores Legendado HD',
        'http://x.com/1.mp4',
        '#EXTINF:-1,Outro Filme',
        'http://x.com/2.mp4',
        '#EXTINF:-1,Vingadores Dublado FHD',
        'http://x.com/3.mp4',
        '#EXTINF:-1,Vingadores Dublado HD',
        'http://x.com/4.mp4',
    ].join('\n');
    const { entries } = groupAndSort(classify(parseM3U(m3u)));
    const titles = entries.map(e => finalName(e));
    // Vingadores: FHD antes de HD; dentro do HD, Dublado antes de Legendado.
    assert.deepEqual(titles, [
        'Vingadores (Dublado - FHD)',
        'Vingadores (Dublado - HD)',
        'Vingadores (Legendado - HD)',
        'Outro Filme (Não especificado - SD)',
    ]);
});

test('groupAndSort: live e vod com a mesma raiz nao se misturam', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Amazon',
        'http://x.com/1.ts',
        '#EXTINF:-1,Amazon',
        'http://x.com/2.mp4',
    ].join('\n');
    const { entries, groupCount } = groupAndSort(classify(parseM3U(m3u)));
    assert.equal(groupCount, 2);
    assert.equal(entries[0].contentType, 'live');
    assert.equal(entries[1].contentType, 'vod');
});

test('renderM3U: aplica group-title default por tipo quando ausente', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,Canal Sem Grupo\nhttp://x.com/a.ts\n';
    const { entries } = groupAndSort(classify(parseM3U(m3u)));
    const out = renderM3U(entries, OPTIONS);
    assert.match(out, /group-title="Canais"/);
});

test('renderM3U: preserva group-title original quando presente', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Canais | Abertos",Canal\nhttp://x.com/a.ts\n';
    const { entries } = groupAndSort(classify(parseM3U(m3u)));
    const out = renderM3U(entries, OPTIONS);
    assert.match(out, /group-title="Canais \| Abertos"/);
});

test('classify: marcas conhecidas de conteúdo adulto casam isAdult', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Hentai 12',
        'http://x.com/1.mp4',
        '#EXTINF:-1,Canal XXX',
        'http://x.com/2.ts',
        '#EXTINF:-1,Brazzers Collection',
        'http://x.com/3.mp4',
        '#EXTINF:-1,Brasileirinhas Especial',
        'http://x.com/4.mp4',
    ].join('\n');
    const [hentai, xxx, brazzers, brasileirinhas] = classify(parseM3U(m3u));
    assert.equal(hentai.isAdult, true);
    assert.equal(xxx.isAdult, true);
    assert.equal(brazzers.isAdult, true);
    assert.equal(brasileirinhas.isAdult, true);
});

// Achado real (não sintético): a lista de calibração (.agents/tv_channels.m3u)
// tem "O País da Pornochanchada (2020)", documentário legítimo sobre cinema
// brasileiro — /porn/ solto casaria como substring de "Pornochanchada".
test('classify: "Pornochanchada" NAO casa isAdult (falso positivo real evitado)', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,O País da Pornochanchada (2020)\nhttp://x.com/a.mp4\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.isAdult, false);
});

// Achados reais (não sintéticos): rodar contra a lista de calibração revelou que
// "adult"/"adulta" soltos (sem o "o" final) casavam com conteúdo mainstream de
// verdade — nenhum tinha group-title relacionado a adulto.
test('classify: "Adult Swim", "The Adults" e "Vida Adulta" NAO casam isAdult (falso positivo real evitado)', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Adult Swim',
        'http://x.com/1.ts',
        '#EXTINF:-1,The Adults (2023)',
        'http://x.com/2.mp4',
        '#EXTINF:-1,Vida Adulta (2025)',
        'http://x.com/3.mp4',
    ].join('\n');
    const [swim, adults, vidaAdulta] = classify(parseM3U(m3u));
    assert.equal(swim.isAdult, false);
    assert.equal(adults.isAdult, false);
    assert.equal(vidaAdulta.isAdult, false);
});

test('classify: detecta conteúdo adulto pelo group-title mesmo com título limpo', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Canais | Adultos",Canal 47\nhttp://x.com/a.ts\n';
    const [entry] = classify(parseM3U(m3u));
    assert.equal(entry.isAdult, true);
});

test('renderM3U: conteúdo adulto sempre renderiza group-title "🔞 Adulto"', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Filmes Adultos",Hentai 3\nhttp://x.com/a.mp4\n';
    const { entries } = groupAndSort(classify(parseM3U(m3u)));
    const out = renderM3U(entries, OPTIONS);
    assert.match(out, /group-title="🔞 Adulto"/);
});

test('groupAndSort: grupos adultos vão pro início, preservando ordem de aparição', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,Filme Comum',
        'http://x.com/1.mp4',
        '#EXTINF:-1,Outro Filme Comum',
        'http://x.com/2.mp4',
        '#EXTINF:-1,Hentai 1',
        'http://x.com/3.mp4',
        '#EXTINF:-1,Canal XXX',
        'http://x.com/4.ts',
    ].join('\n');
    const { entries } = groupAndSort(classify(parseM3U(m3u)));
    assert.equal(entries[0].isAdult, true);
    assert.equal(entries[1].isAdult, true);
    assert.equal(entries[2].isAdult, false);
    assert.equal(entries[3].isAdult, false);
    // Ordem de aparição preservada DENTRO de cada partição
    assert.equal(entries[0].title, 'Hentai 1');
    assert.equal(entries[1].title, 'Canal XXX');
    assert.equal(entries[2].title, 'Filme Comum');
    assert.equal(entries[3].title, 'Outro Filme Comum');
});

test('round-trip: todo item de entrada única aparece na saída (sem perda)', () => {
    const m3u = [
        '#EXTM3U',
        '#EXTINF:-1,A Dublado FHD',
        'http://x.com/1.mp4',
        '#EXTINF:-1,B Legendado HD',
        'http://x.com/2.mp4',
        '#EXTINF:-1,C 4K',
        'http://x.com/3.ts',
    ].join('\n');
    const parsed = parseM3U(m3u);
    const { entries } = groupAndSort(classify(parsed));
    assert.equal(entries.length, parsed.length);
    const outputUrls = new Set(entries.map(e => e.raw.url));
    for (const entry of parsed) assert.ok(outputUrls.has(entry.raw.url));
});
