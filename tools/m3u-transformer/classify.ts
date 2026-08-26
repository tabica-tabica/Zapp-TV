// Heurísticas de classificação — spec §2, calibradas contra uma lista real
// de ~213 mil itens (.agents/tv_channels.m3u). As notas "calibrado" abaixo
// marcam onde o comportamento diverge do texto literal da spec porque o
// dado real mostrou um risco concreto de falso positivo; é exatamente o
// ajuste que a observação de uso da spec pede.

import type { Audio, ContentType, M3UEntry, Quality, TransformOptions, TypeOverride } from './types.ts';
import { isAdultContent } from './adult.ts';

// ---- Tipo de conteúdo (spec §2.1) ----------------------------------------

/**
 * Só ".ts" é ao vivo por padrão. O restante (.mp4, .mkv, .avi, e qualquer
 * outra extensão) é VOD — a lista real tem .mkv (2665 itens) e .avi (3) além
 * do .mp4 previsto na spec; tratá-los como "não-ts logo VOD" é a
 * generalização natural, não uma adivinhação.
 */
const LIVE_EXTENSION = /\.ts(\?.*)?$/i;

/**
 * group-title que força VOD mesmo com URL .ts — spec §2.1 ("a menos que o
 * group-title ou nome indique filme/série/VOD").
 *
 * CALIBRADO: a spec original testava a palavra em qualquer lugar do
 * group-title OU do título. Os dois davam falso positivo na lista real:
 *   - group-title="Canais | Filmes e Series" é um GRUPO DE CANAIS AO VIVO
 *     (A&E, AMC, AXN...) só tematicamente sobre filmes/séries — "Filmes"
 *     aparece dentro da string sem ser a categoria.
 *   - títulos como "AMC Series HD" e "TNT Series" são nomes de canal AO
 *     VIVO de verdade; "Series" ali é marca, não indicação de VOD.
 * A lista real nomeia grupo como "{Categoria} | {Subcategoria}" de forma
 * consistente — só a CATEGORIA (antes do primeiro "|") é um sinal confiável.
 * Por isso: ancorado no início, só contra o group-title, nunca contra o
 * título. Ver __tests__/transform.test.ts para os casos que motivaram isto.
 */
const VOD_GROUP_CATEGORY = /^(filmes?|s[ée]ries?|vod)\b/i;

function groupCategoryPrefix(groupTitle: string): string {
    return groupTitle.split('|')[0]?.trim() ?? '';
}

export function classifyContentType(
    entry: Pick<M3UEntry, 'title' | 'raw' | 'attributes'>,
    overrides: TypeOverride[] = []
): ContentType {
    for (const override of overrides) {
        if (override.pattern.test(entry.raw.url) || override.pattern.test(entry.title)) {
            return override.type;
        }
    }

    const looksLive = LIVE_EXTENSION.test(entry.raw.url);
    if (!looksLive) return 'vod';

    const category = groupCategoryPrefix(entry.attributes.groupTitle ?? '');
    if (VOD_GROUP_CATEGORY.test(category)) return 'vod';
    return 'live';
}

// ---- Qualidade (spec §2.2) -----------------------------------------------

// Checados nesta ordem — a primeira que casar decide. FHD precisa vir antes
// de HD por causa da tabela, mas na prática nem colide: "\bhd\b" não entra
// em "FHD" porque não há fronteira de palavra entre F e H.
const QUALITY_PATTERNS: Array<{ quality: Quality; regex: RegExp }> = [
    { quality: '4K', regex: /\b4k\b|\[4k\]|\b2160p?\b|\buhd\b/i },
    { quality: 'FHD', regex: /\bfhd\b|\b1080p?\b|\bfull\s*-?\s*hd\b/i },
    { quality: 'HD', regex: /\bhd\b|\b720p?\b/i },
    { quality: 'SD', regex: /\bsd\b|\b480p?\b|\b360p?\b|\b240p?\b/i },
];

function detectQuality(text: string): Quality | null {
    for (const { quality, regex } of QUALITY_PATTERNS) {
        if (regex.test(text)) return quality;
    }
    return null;
}

// ---- Áudio (spec §2.3) ----------------------------------------------------

// "DUAL AUDIO" aparece com espaço entre as palavras na lista real — o `.?`
// da spec cobre isso, mas deixamos a classe de espaço/pontuação explícita.
const AUDIO_PATTERNS: Array<{ audio: Audio; regex: RegExp }> = [
    { audio: 'Dual Áudio', regex: /\bdual[\s._-]*[áa]udio\b/i },
    { audio: 'Dublado', regex: /\bdub(lado)?\b|\bnacional\b|\bpt[\s-]?br\b/i },
    // "[L]" é a marcação de legendado mais comum na lista real (8500+ itens) —
    // não estava na spec original, entrou pela calibração.
    { audio: 'Legendado', regex: /\bleg(endado)?\b|\[l\]|\bsub(titled)?\b/i },
    // "Original" NÃO usa o casamento livre que a spec sugere (bare "original",
    // "en", "ingles", "english"). A lista real tem títulos de filme LEGÍTIMOS
    // contendo a palavra ("Pecado Original", "Um Filme Original") — um match
    // livre etiquetaria o filme errado como áudio original. Restrito a
    // colchetes/parênteses explícitos, o único jeito de dizer isso sem
    // ambiguidade nesta lista.
    { audio: 'Original', regex: /\[original\]|\(original\)/i },
];

function detectAudio(text: string): Audio | null {
    for (const { audio, regex } of AUDIO_PATTERNS) {
        if (regex.test(text)) return audio;
    }
    return null;
}

// ---- Limpeza do título-raiz (spec §2.4) -----------------------------------

// Tudo que os detectores acima reconhecem, mais ruído de codec que a lista
// real usa (ex.: "RedeTV! FHD H265") — sem isso "RedeTV! FHD" e
// "RedeTV! FHD H265" viram raízes diferentes por acidente.
const STRIP_FOR_ROOT = new RegExp(
    [
        ...QUALITY_PATTERNS.map(p => p.regex.source),
        ...AUDIO_PATTERNS.map(p => p.regex.source),
        String.raw`\bh\.?265\b`,
        String.raw`\bh\.?264\b`,
        String.raw`\bhevc\b`,
        String.raw`\bx26[45]\b`,
    ].join('|'),
    'gi'
);

export function buildRootTitle(title: string): string {
    let root = title.replace(STRIP_FOR_ROOT, ' ');
    // Colchetes/parênteses que a remoção acima esvaziou.
    root = root.replace(/\(\s*\)|\[\s*\]/g, ' ');
    // Traços soltos que sobraram de "Nome - FHD" depois de tirar "FHD".
    root = root.replace(/\s-\s*$/g, ' ').replace(/^\s*-\s/g, ' ');
    root = root.replace(/\s+/g, ' ').trim();
    return root || title.trim();
}

// ---- Orquestração ----------------------------------------------------------

export function classifyEntry(entry: M3UEntry, options: TransformOptions): M3UEntry {
    const contentType = classifyContentType(entry, options.typeOverrides);

    // Título primeiro; só cai pra URL se o título não disser nada (spec §2.2).
    const quality = detectQuality(entry.title) ?? detectQuality(entry.raw.url) ?? 'SD';
    const audio = detectAudio(entry.title) ?? detectAudio(entry.raw.url) ?? 'Não especificado';
    const rootTitle = buildRootTitle(entry.title);
    const isAdult = isAdultContent(entry.title, entry.attributes.groupTitle);

    return { ...entry, contentType, rootTitle, audio, quality, isAdult };
}
