import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Hls from 'hls.js';
import { pipelineEstacionado } from './pipelineEstacionado';
import type { LivePipeline } from '../components/LiveChannelPreview';

function pipeline(): LivePipeline {
    const video = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() } as unknown as HTMLVideoElement;
    return { video, hls: { destroy: vi.fn() } as unknown as Hls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    pipelineEstacionado.descartar();
    vi.useRealTimers();
});

describe('pipelineEstacionado (Home ⇄ TV ao Vivo sem conexão nova)', () => {
    it('a página que entra assume o MESMO pipeline do mesmo canal', () => {
        const p = pipeline();
        pipelineEstacionado.estacionar(7, p);
        expect(pipelineEstacionado.canal()).toBe(7);
        expect(pipelineEstacionado.retirar(8)).toBeNull();
        expect(pipelineEstacionado.retirar(7)).toBe(p);
        expect(pipelineEstacionado.canal()).toBeNull();
        vi.advanceTimersByTime(60000);
        expect(p.hls.destroy).not.toHaveBeenCalled();
    });

    it('ninguém pegou: destrói (não segura conexão à toa)', () => {
        const p = pipeline();
        pipelineEstacionado.estacionar(7, p);
        vi.advanceTimersByTime(8000);
        expect(p.hls.destroy).toHaveBeenCalledTimes(1);
        expect(pipelineEstacionado.retirar(7)).toBeNull();
    });

    it('StrictMode: a 2ª retirada logo em seguida recebe o mesmo; depois, nada', () => {
        const p = pipeline();
        pipelineEstacionado.estacionar(7, p);
        expect(pipelineEstacionado.retirar(7)).toBe(p);
        expect(pipelineEstacionado.retirar(7)).toBe(p);
        vi.advanceTimersByTime(2001);
        expect(pipelineEstacionado.retirar(7)).toBeNull();
    });

    it('estacionar outro mata o anterior que ninguém pegou', () => {
        const a = pipeline();
        const b = pipeline();
        pipelineEstacionado.estacionar(1, a);
        pipelineEstacionado.estacionar(2, b);
        expect(a.hls.destroy).toHaveBeenCalledTimes(1);
        expect(pipelineEstacionado.retirar(2)).toBe(b);
    });

    it('avisa quem assina: ao estacionar e quando o estacionamento acaba', () => {
        const ouvinte = vi.fn();
        const sair = pipelineEstacionado.assinar(ouvinte);
        const canal = { stream_id: 5 } as Parameters<typeof pipelineEstacionado.estacionar>[2];
        pipelineEstacionado.estacionar(5, pipeline(), canal);
        expect(ouvinte).toHaveBeenCalledTimes(1);
        expect(pipelineEstacionado.canalEstacionado()).toBe(canal);
        pipelineEstacionado.retirar(5);
        // Entregue: o canal segue visível na janela de reentrega, depois some
        expect(pipelineEstacionado.canalEstacionado()).toBe(canal);
        vi.advanceTimersByTime(2001);
        expect(pipelineEstacionado.canalEstacionado()).toBeNull();
        expect(ouvinte).toHaveBeenCalledTimes(2);
        sair();
    });
});
