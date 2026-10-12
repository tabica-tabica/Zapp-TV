// Saúde das fontes ao vivo (benchmark PASSIVO): aprende só com o que a pessoa
// assiste — nunca testa canal por conta própria, porque cada teste abriria
// uma conexão e a conta de 1 conexão bloqueia com 2-3 (visto no painel).
//
// - ok: a fonte tocou 60s seguidos (VideoPlayer onLiveHealthy) ou a prévia
//   subiu (LiveChannelPreview) — sem isso a variante que o failover achou
//   nunca ganhava histórico e a quebrada seguia sendo a padrão
// - falha: a fonte morreu ou não subiu — MENOS quando o painel estava
//   recusando por limite de conexões: aí a culpa não é do canal
//
// O failover (proximaVariante) usa isto pra ir primeiro na fonte mais
// confiável e pular a que "costuma estar fora". Resultados antigos perdem peso
// (meia-vida de 7 dias): canal consertado volta a ser escolhido.

import { readJson, writeJson } from './safeStorage';
import { groupChannelVariants, melhorVariante, variantBaseName } from './channelVariants';
import { storage } from './storage';

const KEY = 'neostream_live_health';
const MEIA_VIDA_MS = 7 * 24 * 60 * 60 * 1000;
/** Teto de canais guardados (os menos recentes saem primeiro) */
const MAX_REGISTROS = 400;

export interface RegistroSaude {
    ok: number;
    falha: number;
    /** quando ok/falha foram decaídos pela última vez */
    em: number;
    /** resultado mais recente */
    ultimo?: 'ok' | 'falha';
}

function decair(r: RegistroSaude, agora: number): RegistroSaude {
    const fator = Math.pow(0.5, Math.max(0, agora - r.em) / MEIA_VIDA_MS);
    return { ...r, ok: r.ok * fator, falha: r.falha * fator, em: agora };
}

/** 0..1; sem histórico = 0,5 (neutro). Laplace: 1 resultado não decide nada. */
export function pontuacaoDe(r: RegistroSaude | undefined, agora: number): number {
    if (!r) return 0.5;
    const d = decair(r, agora);
    return (d.ok + 1) / (d.ok + d.falha + 2);
}

/** Caiu de verdade várias vezes e quase nunca segurou: pular no failover. */
export function costumaCairDe(r: RegistroSaude | undefined, agora: number): boolean {
    if (!r) return false;
    const d = decair(r, agora);
    return d.falha >= 2 && pontuacaoDe(r, agora) < 0.34;
}

function ler(): Record<string, RegistroSaude> {
    return readJson<Record<string, RegistroSaude>>(KEY, {});
}

export const liveHealth = {
    registrar(streamId: number, resultado: 'ok' | 'falha', agora = Date.now()): void {
        const todos = ler();
        const atual = decair(todos[streamId] ?? { ok: 0, falha: 0, em: agora }, agora);
        if (resultado === 'ok') atual.ok += 1; else atual.falha += 1;
        atual.ultimo = resultado;
        todos[streamId] = atual;
        const ids = Object.keys(todos);
        if (ids.length > MAX_REGISTROS) {
            ids.sort((a, b) => todos[a].em - todos[b].em)
                .slice(0, ids.length - MAX_REGISTROS)
                .forEach(id => { delete todos[id]; });
        }
        writeJson(KEY, todos);
    },
    pontuacao(streamId: number, agora = Date.now()): number {
        return pontuacaoDe(ler()[streamId], agora);
    },
    costumaCair(streamId: number, agora = Date.now()): boolean {
        return costumaCairDe(ler()[streamId], agora);
    },
    /** A tentativa mais recente falhou: fora agora, vale mais que a média */
    ultimoFalhou(streamId: number): boolean {
        return ler()[streamId]?.ultimo === 'falha';
    },
    /** Já tocou (ou caiu) alguma vez aqui — sem isso a nota é só o neutro 0,5 */
    temHistorico(streamId: number): boolean {
        return streamId in ler();
    },
};

/**
 * Último canal assistido, na variante que está no ar: a de melhor histórico
 * do grupo (ordem de qualidade do catálogo no empate). Se não for a gravada,
 * passa a ser — Home, TV ao Vivo e o stream estacionado entre elas abrem a
 * MESMA (uma conexão) e ninguém tenta de novo a que caiu.
 */
export function ultimoCanalNoAr<T extends { stream_id: number; name: string }>(canais: T[]): T | undefined {
    const id = storage.getLastChannel();
    const ultimo = id != null ? canais.find(c => c.stream_id === id) : undefined;
    if (!ultimo) return undefined;
    const base = variantBaseName(ultimo.name);
    const grupo = groupChannelVariants(canais.filter(c => variantBaseName(c.name) === base)).variantsOf.values().next().value ?? [ultimo];
    const escolhido = melhorVariante(grupo, ultimo, liveHealth);
    if (escolhido.stream_id !== ultimo.stream_id) storage.setLastChannel(escolhido.stream_id);
    return escolhido;
}
