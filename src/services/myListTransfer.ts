// Exportar/importar a Minha Lista (a lista padrão + as listas nomeadas),
// no mesmo esquema da lista secreta: no computador, arquivo .json; na TV,
// páginas de QR e o texto de cada página colado de volta.
//
// Importar JUNTA, nunca substitui: item novo entra, repetido fica como
// está; lista nomeada casa pelo NOME (o id é do aparelho de origem) e é
// criada se faltar, dentro dos tetos de listsService.

import { storage, type SavedContentItem } from './storage';
import { listsService, MAX_LISTAS, MAX_ITENS_POR_LISTA } from './listsService';
import { paginasQr, MAX_BYTES_QR } from '../utils/qrPath';

export const FORMATO_MINHA_LISTA = 'neostream-mylist-1';
/** QR: sem capa nem nota, item = [id, tipo, título, container, na lista padrão (1/0), nomes das listas] */
export const FORMATO_MINHA_LISTA_QR = 'neostream-mylist-q1';

type Tipo = SavedContentItem['type'];
type ItemQr = [string, string, string, string, number, string[]];

const TIPOS: readonly Tipo[] = ['movie', 'series', 'channel'];

/** Arquivo completo (com capa e nota), pra guardar no computador. */
export function exportarMinhaLista(): string {
    return JSON.stringify({
        f: FORMATO_MINHA_LISTA,
        t: Date.now(),
        itens: storage.getWatchLater(),
        listas: listsService.list().map(lista => ({ nome: lista.nome, itens: lista.itens })),
    });
}

/** Páginas de QR: cada item uma vez só, com os nomes das listas em que está. */
export function exportarMinhaListaQr(max = MAX_BYTES_QR): string[] {
    const porChave = new Map<string, ItemQr>();
    const entrada = (item: SavedContentItem): ItemQr => {
        const chave = `${item.type}:${item.id}`;
        let q = porChave.get(chave);
        if (!q) {
            q = [item.id, item.type, item.title, item.container ?? '', 0, []];
            porChave.set(chave, q);
        }
        return q;
    };
    for (const item of storage.getWatchLater()) entrada(item)[4] = 1;
    for (const lista of listsService.list()) {
        for (const item of lista.itens) entrada(item)[5].push(lista.nome);
    }
    return paginasQr([...porChave.values()], i => JSON.stringify({ f: FORMATO_MINHA_LISTA_QR, i }), max);
}

export interface ResultadoMinhaLista {
    ok: boolean;
    /** Títulos que entraram em algum lugar (cada um conta uma vez, mesmo em várias listas) */
    novos: number;
    /** Listas nomeadas criadas */
    listas: number;
    error?: string;
}

type ItemVindo = Omit<SavedContentItem, 'addedAt'>;

function item(bruto: unknown): ItemVindo | null {
    const x = bruto as Partial<SavedContentItem> | null;
    if (!x || x.id == null || !TIPOS.includes(x.type as Tipo)) return null;
    const texto = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    return {
        id: String(x.id),
        type: x.type as Tipo,
        title: texto(x.title) ?? 'Sem título',
        poster: texto(x.poster),
        rating: texto(x.rating),
        year: texto(x.year),
        container: texto(x.container),
    };
}

/** Junta o que veio com o que já existe (ver o topo do arquivo). */
export function importarMinhaLista(json: string): ResultadoMinhaLista {
    let dados: { f?: unknown; itens?: unknown; listas?: unknown; i?: unknown };
    try {
        dados = JSON.parse(json);
    } catch {
        return { ok: false, novos: 0, listas: 0, error: 'Não é um arquivo válido.' };
    }
    const padrao: ItemVindo[] = [];
    const porLista = new Map<string, ItemVindo[]>();
    const naLista = (nome: unknown, vindo: ItemVindo) => {
        if (typeof nome !== 'string' || !nome.trim()) return;
        const l = porLista.get(nome) ?? [];
        l.push(vindo);
        porLista.set(nome, l);
    };
    if (dados?.f === FORMATO_MINHA_LISTA) {
        if (Array.isArray(dados.itens)) for (const b of dados.itens) { const v = item(b); if (v) padrao.push(v); }
        if (Array.isArray(dados.listas)) {
            for (const l of dados.listas as Array<{ nome?: unknown; itens?: unknown }>) {
                if (!l || !Array.isArray(l.itens)) continue;
                for (const b of l.itens) { const v = item(b); if (v) naLista(l.nome, v); }
            }
        }
    } else if (dados?.f === FORMATO_MINHA_LISTA_QR && Array.isArray(dados.i)) {
        for (const q of (dados.i as unknown[]).filter(Array.isArray) as unknown[][]) {
            const [id, type, title, container, padraoFlag, nomes] = q;
            const v = item({ id, type, title, container });
            if (!v) continue;
            if (padraoFlag) padrao.push(v);
            if (Array.isArray(nomes)) for (const nome of nomes) naLista(nome, v);
        }
    } else {
        return { ok: false, novos: 0, listas: 0, error: 'Formato desconhecido.' };
    }

    const entraram = new Set<string>();
    for (const v of padrao) {
        if (storage.isInWatchLater(v.id, v.type)) continue;
        storage.addWatchLater(v);
        entraram.add(`${v.type}:${v.id}`);
    }
    let listas = 0;
    for (const [nome, itens] of porLista) {
        let lista = listsService.list().find(l => l.nome === nome) ?? null;
        if (!lista) {
            if (listsService.list().length >= MAX_LISTAS) continue;
            lista = listsService.create(nome);
            if (!lista) continue;
            listas++;
        }
        for (const v of itens) {
            const atual = listsService.get(lista.id);
            if (!atual || atual.itens.length >= MAX_ITENS_POR_LISTA) break;
            if (listsService.has(lista.id, v.id, v.type)) continue;
            listsService.toggleItem(lista.id, v);
            entraram.add(`${v.type}:${v.id}`);
        }
    }
    return { ok: true, novos: entraram.size, listas };
}
