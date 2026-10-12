// @vitest-environment jsdom
//
// A ORDEM que importa: a página que sai estaciona na DESMONTAGEM (commit), e
// a que entra já RENDERIZOU antes disso. A Home lê via useSyncExternalStore
// + guarda no estado — este teste reproduz a troca de página no mesmo commit.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import type Hls from 'hls.js';
import { pipelineEstacionado } from './pipelineEstacionado';
import type { LivePipeline } from '../components/LiveChannelPreview';
import type { LiveStream } from '../types';

afterEach(() => {
    cleanup();
    pipelineEstacionado.descartar();
});

const canal = { stream_id: 42, name: 'Canal 42' } as LiveStream;
const pipeline: LivePipeline = {
    video: { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() } as unknown as HTMLVideoElement,
    hls: { destroy: vi.fn() } as unknown as Hls,
};

/** Como a TV ao Vivo: estaciona na desmontagem (layout cleanup) */
function PaginaQueSai() {
    useLayoutEffect(() => () => pipelineEstacionado.estacionar(canal.stream_id, pipeline, canal), []);
    return <div>tv ao vivo</div>;
}

/** Como a Home: lê o estacionado e guarda no estado (ajuste durante o render) */
function PaginaQueEntra({ aoVer }: { aoVer: (c: LiveStream, p: LivePipeline | null) => void }) {
    const estacionado = useSyncExternalStore(pipelineEstacionado.assinar, pipelineEstacionado.canalEstacionado);
    const [heroi, setHeroi] = useState<LiveStream | null>(null);
    if (estacionado && !heroi) setHeroi(estacionado);
    if (heroi) aoVer(heroi, pipelineEstacionado.retirar(heroi.stream_id));
    return <div>home</div>;
}

function App({ pagina, aoVer }: { pagina: 'live' | 'home'; aoVer: (c: LiveStream, p: LivePipeline | null) => void }) {
    return pagina === 'live' ? <PaginaQueSai /> : <PaginaQueEntra aoVer={aoVer} />;
}

describe('troca de página no mesmo commit (TV ao Vivo → Home)', () => {
    it('a Home vê o canal estacionado DEPOIS de já ter renderizado e assume o mesmo pipeline', () => {
        const aoVer = vi.fn();
        const { rerender } = render(<App pagina="live" aoVer={aoVer} />);
        act(() => { rerender(<App pagina="home" aoVer={aoVer} />); });
        expect(aoVer).toHaveBeenCalled();
        const [visto, assumido] = aoVer.mock.calls.at(-1)!;
        expect(visto.stream_id).toBe(42);
        expect(assumido).toBe(pipeline);
        expect(pipeline.hls.destroy).not.toHaveBeenCalled();
    });
});
