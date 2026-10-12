// @vitest-environment jsdom
//
// Pré-carga do SecretPlayer: o filme vizinho tem a URL final resolvida em
// segundo plano, e o ⏮/⏭ usa o cache em vez de esperar o redirect do painel.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { ItemSecreto } from '../services/secretList';

interface PropsDoPlayer {
    src: string;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    moments?: {
        onAlternarTira?: () => void;
        onFocar?: (m: { filmeId: string; t: number; doAtual: boolean; titulo: string }) => void;
    };
}
let player: PropsDoPlayer | null = null;
vi.mock('./VideoPlayer', () => ({
    VideoPlayer: (props: PropsDoPlayer) => { player = props; return null; },
}));
vi.mock('../services/api', () => ({
    api: { getVodStreamUrl: (id: number, ext: string) => `http://painel/movie/${id}.${ext}` },
}));

import { SecretPlayer } from './SecretPlayer';

const filme = (id: string, moments: number[] = []): ItemSecreto => ({ id, title: `Filme ${id}`, addedAt: 0, moments });

// Quantas vezes cada filme foi resolvido (o fetch passa pelo proxy do dev)
const pedidos: string[] = [];
const fetchFalso = vi.fn(async (alvo: string) => {
    const original = decodeURIComponent(alvo.split('url=')[1]);
    pedidos.push(original);
    return { ok: true, url: original.replace('painel', 'cdn'), body: { cancel: async () => {} } };
});

const passar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('SecretPlayer: pré-carga da URL dos vizinhos', () => {
    it('resolve o atual, depois os vizinhos; ⏭ usa o cache; vence em 90s', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', fetchFalso);

        render(<SecretPlayer itens={[filme('1'), filme('2'), filme('3')]} indiceInicial={1} onClose={() => {}} />);

        // Montado JÁ, com src vazio (HUD na tela) enquanto resolve
        expect(player?.src).toBe('');
        await passar(0);
        expect(player?.src).toBe('http://cdn/movie/2.mp4');
        expect(pedidos).toEqual(['http://painel/movie/2.mp4']);

        // 3s depois: anterior e próximo em segundo plano
        await passar(3000);
        expect(pedidos).toEqual([
            'http://painel/movie/2.mp4',
            'http://painel/movie/1.mp4',
            'http://painel/movie/3.mp4',
        ]);

        // ⏭: o próximo já está resolvido, nenhum pedido novo pra ele
        await act(async () => { player?.onNextEpisode?.(); });
        await passar(0);
        expect(player?.src).toBe('http://cdn/movie/3.mp4');
        expect(pedidos.filter(p => p.endsWith('/3.mp4'))).toHaveLength(1);

        // Passou da validade (90s): o 2 é resolvido de novo (token do painel vence)
        await passar(91_000);
        const antes = pedidos.filter(p => p.endsWith('/2.mp4')).length;
        await act(async () => { player?.onPreviousEpisode?.(); });
        await passar(0);
        expect(pedidos.filter(p => p.endsWith('/2.mp4')).length).toBe(antes + 1);
    });

    it('tira 🖼 ligada: pré-carrega os vizinhos NA SEQUÊNCIA e o filme da miniatura focada', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', fetchFalso);
        pedidos.length = 0;
        // Ids novos (o cache é do módulo). Sequência da tira = só quem tem momento:
        // 10, 13(atual), 16, 17 — o 11, 12, 14 e 15 não aparecem nela
        const itens = [
            filme('10', [30]), filme('11'), filme('12'), filme('13', [60]),
            filme('14'), filme('15'), filme('16', [90]), filme('17', [5]),
        ];
        render(<SecretPlayer itens={itens} indiceInicial={3} onClose={() => {}} />);
        await passar(0);

        await act(async () => { player?.moments?.onAlternarTira?.(); });
        await passar(3000);
        const resolvidos = () => new Set(pedidos.map(p => p.match(/movie\/(\d+)/)?.[1]));
        // ⏮/⏭ (12 e 14) + vizinhos na sequência (10 e 16); o 17 ainda não
        expect([...resolvidos()].sort()).toEqual(['10', '12', '13', '14', '16']);

        // Passear pela tira não dispara pedido; parar numa miniatura, sim
        const foco = (filmeId: string) => ({ filmeId, t: 5, doAtual: false, titulo: '' });
        await act(async () => { player?.moments?.onFocar?.(foco('17')); });
        await passar(200);
        await act(async () => { player?.moments?.onFocar?.(foco('16')); });
        await passar(200);
        expect(resolvidos().has('17')).toBe(false);
        await act(async () => { player?.moments?.onFocar?.(foco('17')); });
        await passar(700);
        expect(resolvidos().has('17')).toBe(true);
    });
});
