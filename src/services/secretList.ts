// Lista secreta de filmes adultos com MOMENTOS salvos (pontos do filme).
//
// Secreta quer dizer mais que "fora da Minha Lista":
// - a chave fica no grupo de LISTAS (storageKeys.ts): o backup por QR e o
//   snapshot de configuração levam só o grupo de preferências, então ela não
//   sai do aparelho; "zerar dados" ainda apaga;
// - quem toca da lista (SecretPlayer) não grava progresso nem estatística de
//   uso — nada vaza pro Continuar Assistindo nem pro "Seu uso".
//
// Por perfil (scopedKey), igual às listas nomeadas.

import { scopedKey } from './profileScope';
import { readJson, writeJson } from './safeStorage';

const KEY = () => scopedKey('neostream_secret_list');

export const MAX_ITENS_SECRETOS = 200;
export const MAX_MOMENTOS = 50;
/** Dois momentos a menos disso são o mesmo momento (e o "anterior" pula ele). */
export const TOLERANCIA_MOMENTO_S = 3;
/**
 * Teto GLOBAL de miniaturas (cada uma ~3 KB em JPEG 160px): a quota do
 * aparelho é ~5 MB pra tudo. Passou disso, as dos filmes mais antigos da
 * lista caem primeiro — o momento continua, só sem a imagem.
 */
export const MAX_MINIATURAS = 300;

export interface ItemSecreto {
    /** stream_id do filme */
    id: string;
    title: string;
    poster?: string;
    container?: string;
    addedAt: number;
    /** segundos, em ordem crescente */
    moments: number[];
    /** Miniatura (data:image/jpeg) por segundo do momento, quando deu pra capturar */
    thumbs?: Record<string, string>;
}

// ---- Momentos: funções puras ----

/** Insere em segundos inteiros, mantendo a ordem; perto demais de outro = ignora. */
export function insertMoment(list: readonly number[], t: number): number[] {
    const s = Math.max(0, Math.round(t));
    if (list.some(m => Math.abs(m - s) <= TOLERANCIA_MOMENTO_S)) return [...list];
    if (list.length >= MAX_MOMENTOS) return [...list];
    return [...list, s].sort((a, b) => a - b);
}

/** Próximo momento depois de `t` (null se não há). */
export function nextMoment(list: readonly number[], t: number): number | null {
    return list.find(m => m > t + 0.5) ?? null;
}

/**
 * Momento anterior a `t`. A tolerância faz o "anterior" logo depois de um pulo
 * ir pro de antes — e não voltar pro mesmo de onde acabou de sair.
 */
export function prevMoment(list: readonly number[], t: number): number | null {
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] < t - TOLERANCIA_MOMENTO_S) return list[i];
    }
    return null;
}

export function firstMoment(list: readonly number[]): number | null {
    return list.length > 0 ? list[0] : null;
}

/** 754 → "12:34"; 3754 → "1:02:34" (chips da lista). */
export function formatMoment(segundos: number): string {
    const s = Math.max(0, Math.floor(segundos));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---- Armazenamento ----

function ler(): ItemSecreto[] {
    const bruto = readJson<unknown>(KEY(), []);
    if (!Array.isArray(bruto)) return [];
    return (bruto as Array<Partial<ItemSecreto>>)
        .filter(item => item && item.id != null)
        .map(item => ({
            id: String(item.id),
            title: item.title || 'Sem título',
            poster: item.poster,
            container: item.container,
            addedAt: Number(item.addedAt) || 0,
            moments: Array.isArray(item.moments)
                ? item.moments.map(Number).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
                : [],
            thumbs: item.thumbs && typeof item.thumbs === 'object'
                ? Object.fromEntries(Object.entries(item.thumbs)
                    .filter(([, v]) => typeof v === 'string' && v.startsWith('data:image/')))
                : undefined,
        }));
}

/** Corta miniaturas além do teto global, começando pelo fim da lista (mais antigos). */
export function limitarMiniaturas(itens: ItemSecreto[], max = MAX_MINIATURAS): ItemSecreto[] {
    let total = itens.reduce((n, item) => n + Object.keys(item.thumbs ?? {}).length, 0);
    for (let i = itens.length - 1; i >= 0 && total > max; i--) {
        const thumbs = itens[i].thumbs;
        if (!thumbs) continue;
        for (const chave of Object.keys(thumbs)) {
            if (total <= max) break;
            delete thumbs[chave];
            total--;
        }
    }
    return itens;
}

function gravar(itens: ItemSecreto[]): void {
    writeJson(KEY(), limitarMiniaturas(itens));
}

export type ItemSecretoInput = Pick<ItemSecreto, 'id' | 'title' | 'poster' | 'container'>;

export const secretList = {
    list(): ItemSecreto[] {
        return ler();
    },

    has(id: string): boolean {
        return ler().some(item => item.id === id);
    },

    /** Põe ou tira; devolve true se o filme ficou na lista. */
    toggle(input: ItemSecretoInput): boolean {
        const itens = ler();
        const i = itens.findIndex(item => item.id === input.id);
        if (i >= 0) {
            itens.splice(i, 1);
            gravar(itens);
            return false;
        }
        if (itens.length >= MAX_ITENS_SECRETOS) return false;
        itens.unshift({ ...input, addedAt: Date.now(), moments: [] });
        gravar(itens);
        return true;
    },

    remove(id: string): void {
        gravar(ler().filter(item => item.id !== id));
    },

    /** Salva um momento (com miniatura, se houver); devolve a lista nova. */
    addMoment(id: string, t: number, thumb?: string): number[] {
        const itens = ler();
        const item = itens.find(x => x.id === id);
        if (!item) return [];
        const antes = item.moments.length;
        item.moments = insertMoment(item.moments, t);
        if (thumb && item.moments.length > antes) {
            item.thumbs = { ...item.thumbs, [String(Math.max(0, Math.round(t)))]: thumb };
        }
        gravar(itens);
        return item.moments;
    },

    removeMoment(id: string, t: number): number[] {
        const itens = ler();
        const item = itens.find(x => x.id === id);
        if (!item) return [];
        item.moments = item.moments.filter(m => m !== t);
        if (item.thumbs) delete item.thumbs[String(t)];
        gravar(itens);
        return item.moments;
    },
};
