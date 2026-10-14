// Descoberta na TV ao vivo (backlog itens 12, 13 e 17):
// - detecção de canais de rádio (player de áudio leve)
// - ordem manual dos favoritos (zapping do jeito do dono)

import type { LiveStream } from '../types';
import { scopedKey } from './profileScope';

// ---- Rádio (item 13) ----

// Fronteira de palavra é OBRIGATÓRIA: com substring, " am" casava
// "TV Amazonas", "Band Amapá", "Canal América" — canais de TV comuns
// viravam rádio e o vídeo ficava escondido atrás da tela de áudio.
// O nome é NORMALIZADO antes: sem isso, "américa" casava \bam\b porque
// o "é" acentuado conta como fronteira de palavra no regex ASCII.
const RADIO_NAME_RE = /\b(radio|fm|am)\b/;

function normalizeName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

/** Canal é de rádio? A CATEGORIA manda; o nome é fallback conservador. */
export function isRadioChannel(channel: LiveStream, categoryName?: string): boolean {
    const category = normalizeName(categoryName || '');
    if (category.includes('radio')) return true;
    // Sem categoria de rádio, só aceita nome com "radio" explícito ou sigla
    // FM/AM isolada — e nunca se o canal tem EPG (sinal de canal de TV).
    if (channel.epg_channel_id) return false;
    return RADIO_NAME_RE.test(normalizeName(channel.name || ''));
}

// ---- Ordem manual dos favoritos (item 17) ----

// Ordem dos favoritos segue o perfil (item 54)
const ORDER_KEY = () => scopedKey('neostream_fav_channel_order');

function readOrder(): number[] {
    try {
        const raw = localStorage.getItem(ORDER_KEY());
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as unknown[]).map(Number).filter(Number.isFinite) : [];
    } catch {
        return [];
    }
}

function writeOrder(order: number[]): void {
    try {
        localStorage.setItem(ORDER_KEY(), JSON.stringify(order));
    } catch {
        // quota
    }
}

export const favoriteOrder = {
    get(): number[] {
        return readOrder();
    },

    /**
     * Aplica a ordem salva; ids desconhecidos (favoritados depois) vão pro
     * fim na ordem original — nunca somem da lista.
     */
    apply<T extends { stream_id: number }>(channels: T[]): T[] {
        const order = readOrder();
        if (order.length === 0) return channels;
        const rank = new Map(order.map((id, index) => [id, index]));
        return [...channels].sort((a, b) => {
            const rankA = rank.get(a.stream_id);
            const rankB = rank.get(b.stream_id);
            if (rankA === undefined && rankB === undefined) return 0;
            if (rankA === undefined) return 1;
            if (rankB === undefined) return -1;
            return rankA - rankB;
        });
    },

    /** Move um canal uma posição pra cima/baixo dentro da lista dada. */
    move(currentIds: number[], streamId: number, direction: -1 | 1): number[] {
        const ids = [...currentIds];
        const index = ids.indexOf(streamId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= ids.length) return ids;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        writeOrder(ids);
        return ids;
    },

    reset(): void {
        try {
            localStorage.removeItem(ORDER_KEY());
        } catch {
            // sem drama
        }
    },
};
