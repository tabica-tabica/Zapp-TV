// Agrupamento, ordenação e deduplicação — spec §3 e §7.

import type { Audio, M3UEntry, Quality } from './types.ts';

const QUALITY_ORDER: Record<Quality, number> = { '4K': 0, FHD: 1, HD: 2, SD: 3 };
const AUDIO_ORDER: Record<Audio, number> = {
    Dublado: 0,
    Legendado: 1,
    Original: 2,
    'Dual Áudio': 3,
    'Não especificado': 4,
};

export interface GroupResult {
    entries: M3UEntry[];
    duplicatesRemoved: number;
    groupCount: number;
}

/** Chave de agrupamento: mesmo tipo + mesma raiz (case/espaço insensível). */
function rootKey(entry: M3UEntry): string {
    return `${entry.contentType}::${entry.rootTitle.toLowerCase()}`;
}

export function groupAndSort(input: M3UEntry[]): GroupResult {
    // 1. Deduplicação por URL exata (spec §7) — a PRIMEIRA ocorrência vence.
    const seenUrls = new Set<string>();
    const deduped: M3UEntry[] = [];
    let duplicatesRemoved = 0;
    for (const entry of input) {
        if (seenUrls.has(entry.raw.url)) {
            duplicatesRemoved++;
            continue;
        }
        seenUrls.add(entry.raw.url);
        deduped.push(entry);
    }

    // 2. Agrupa por raiz, preservando a ordem de PRIMEIRA aparição de cada
    // raiz — reorganiza só o necessário (variações ficam adjacentes umas às
    // outras) sem embaralhar o resto da lista alfabética/temáticamente.
    const groups = new Map<string, M3UEntry[]>();
    const groupOrder: string[] = [];
    for (const entry of deduped) {
        const key = rootKey(entry);
        const bucket = groups.get(key);
        if (bucket) {
            bucket.push(entry);
        } else {
            groups.set(key, [entry]);
            groupOrder.push(key);
        }
    }

    // 2.5. Grupos adultos vão pro início — dentro de cada partição, a ordem de
    // primeira aparição é preservada (não embaralha o resto).
    const adultKeys: string[] = [];
    const otherKeys: string[] = [];
    for (const key of groupOrder) {
        (groups.get(key)![0].isAdult ? adultKeys : otherKeys).push(key);
    }
    const orderedKeys = [...adultKeys, ...otherKeys];

    // 3. Dentro de cada grupo: qualidade (4K > FHD > HD > SD), depois áudio
    // (Dublado > Legendado > Original > Dual > Não especificado) — spec §3.
    const entries: M3UEntry[] = [];
    for (const key of orderedKeys) {
        const bucket = groups.get(key)!;
        bucket.sort((a, b) => {
            const q = QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality];
            if (q !== 0) return q;
            return AUDIO_ORDER[a.audio] - AUDIO_ORDER[b.audio];
        });
        entries.push(...bucket);
    }

    return { entries, duplicatesRemoved, groupCount: groups.size };
}
