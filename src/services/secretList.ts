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
import { storage } from './storage';
import { listsService } from './listsService';
import { paginasQr, MAX_BYTES_QR } from '../utils/qrPath';

/**
 * "Mover" pra lista secreta: o filme sai da Minha Lista, dos favoritos e das
 * listas nomeadas — onde quem abre o app veria o título.
 */
function tirarDasListasVisiveis(id: string, title: string): void {
    storage.removeWatchLater(id, 'movie');
    storage.removeFavorite(id, 'movie');
    for (const lista of listsService.list()) {
        if (listsService.has(lista.id, id, 'movie')) {
            listsService.toggleItem(lista.id, { id, type: 'movie', title });
        }
    }
}

const KEY = () => scopedKey('neostream_secret_list');

export const MAX_ITENS_SECRETOS = 300;
export const MAX_MOMENTOS = 50;
/** Dois momentos a menos disso são o mesmo momento (e o "anterior" pula ele). */
export const TOLERANCIA_MOMENTO_S = 3;
/**
 * Teto GLOBAL de miniaturas (cada uma ~3 KB em JPEG 160px): a quota do
 * aparelho é ~5 MB pra tudo. Passou disso, as dos filmes mais antigos da
 * lista caem primeiro — o momento continua, só sem a imagem.
 */
export const MAX_MINIATURAS = 400;

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

/** Valida o que veio do storage ou de um arquivo importado. */
function normalizar(bruto: unknown): ItemSecreto[] {
    if (!Array.isArray(bruto)) return [];
    return (bruto as Array<Partial<ItemSecreto>>)
        .filter(item => item && item.id != null)
        .map(item => ({
            id: String(item.id),
            title: typeof item.title === 'string' && item.title ? item.title : 'Sem título',
            poster: typeof item.poster === 'string' ? item.poster : undefined,
            container: typeof item.container === 'string' ? item.container : undefined,
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

function ler(): ItemSecreto[] {
    return normalizar(readJson<unknown>(KEY(), []));
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

// ---- Exportar / importar ----

export const FORMATO_SECRETO = 'neostream-secret-1';
/** QR: sem capa nem miniatura, item = [id, título, container, momentos] */
export const FORMATO_SECRETO_QR = 'neostream-secret-q1';

type ItemQr = [string, string, string, number[]];

/** Arquivo completo (com miniaturas), pra guardar no computador. */
export function exportarSecreta(): string {
    return JSON.stringify({ f: FORMATO_SECRETO, t: Date.now(), itens: ler() });
}

/**
 * Páginas de QR: cada uma é um JSON que se importa sozinho. Um item que nem
 * sozinho cabe (título enorme, 50 momentos) vai mesmo assim, numa página só dele.
 */
export function exportarSecretaQr(max = MAX_BYTES_QR): string[] {
    return paginasQr(
        ler().map((item): ItemQr => [item.id, item.title, item.container ?? '', item.moments]),
        i => JSON.stringify({ f: FORMATO_SECRETO_QR, i }),
        max,
    );
}

export interface ResultadoImportacao {
    ok: boolean;
    novos: number;
    momentos: number;
    error?: string;
}

/** Junta com o que já existe: filme novo entra, filme repetido soma os momentos. */
export function importarSecreta(json: string): ResultadoImportacao {
    let dados: { f?: unknown; itens?: unknown; i?: unknown };
    try {
        dados = JSON.parse(json);
    } catch {
        return { ok: false, novos: 0, momentos: 0, error: 'Não é um arquivo válido.' };
    }
    let vindos: ItemSecreto[];
    if (dados?.f === FORMATO_SECRETO) {
        vindos = normalizar(dados.itens);
    } else if (dados?.f === FORMATO_SECRETO_QR && Array.isArray(dados.i)) {
        vindos = normalizar((dados.i as unknown[]).filter(Array.isArray).map(q => {
            const [id, title, container, moments] = q as unknown[];
            return { id, title, container: container || undefined, moments } as Partial<ItemSecreto>;
        }));
    } else {
        return { ok: false, novos: 0, momentos: 0, error: 'Formato desconhecido.' };
    }

    const itens = ler();
    let novos = 0;
    let momentos = 0;
    for (const vindo of vindos) {
        const atual = itens.find(x => x.id === vindo.id);
        if (!atual) {
            if (itens.length >= MAX_ITENS_SECRETOS) continue;
            const moments = vindo.moments.reduce(insertMoment, [] as number[]);
            itens.push({ ...vindo, addedAt: vindo.addedAt || Date.now(), moments });
            tirarDasListasVisiveis(vindo.id, vindo.title);
            novos++;
            momentos += moments.length;
            continue;
        }
        for (const t of vindo.moments) {
            const antes = atual.moments.length;
            atual.moments = insertMoment(atual.moments, t);
            if (atual.moments.length === antes) continue;
            momentos++;
            const thumb = vindo.thumbs?.[String(t)];
            if (thumb) atual.thumbs = { ...atual.thumbs, [String(Math.round(t))]: thumb };
        }
        atual.poster ??= vindo.poster;
        atual.container ??= vindo.container;
    }
    gravar(itens);
    return { ok: true, novos, momentos };
}

export type ItemSecretoInput = Pick<ItemSecreto, 'id' | 'title' | 'poster' | 'container'>;

export const secretList = {
    list(): ItemSecreto[] {
        return ler();
    },

    has(id: string): boolean {
        return ler().some(item => item.id === id);
    },

    /** Põe (movendo, ver `mover`) ou tira; devolve true se o filme ficou na lista. */
    toggle(input: ItemSecretoInput): boolean {
        if (this.has(input.id)) {
            this.remove(input.id);
            return false;
        }
        return this.mover(input);
    },

    /**
     * Garante o filme na lista secreta e o TIRA das listas visíveis (Minha
     * Lista, favoritos, listas nomeadas). Devolve true se ele está na lista.
     */
    mover(input: ItemSecretoInput): boolean {
        const itens = ler();
        if (!itens.some(item => item.id === input.id)) {
            if (itens.length >= MAX_ITENS_SECRETOS) return false;
            itens.unshift({ ...input, addedAt: Date.now(), moments: [] });
            gravar(itens);
        }
        tirarDasListasVisiveis(input.id, input.title);
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
