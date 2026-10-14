// @vitest-environment jsdom
//
// Volta do player pra prévia (TV ao Vivo): a prévia assume o <video> + hls.js
// TOCANDO que o player devolveu — sem recarregar nem abrir outra conexão — e
// consegue entregá-lo de novo se a pessoa reabrir o player.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import type Hls from 'hls.js';
import { LiveChannelPreview, type LiveChannelPreviewHandle } from './LiveChannelPreview';
import { LIVE_START_TIMEOUT_MS } from '../services/playerDecisions';
import { pipelineEstacionado } from '../services/pipelineEstacionado';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function pipelineTocando() {
    const video = document.createElement('video');
    video.setAttribute('src', 'blob:canal-no-ar');
    Object.defineProperty(video, 'readyState', { value: 4 });
    // jsdom não toca mídia: o <video> devolvido chega tocando
    Object.defineProperty(video, 'paused', { value: false });
    video.play = vi.fn(() => Promise.resolve());
    const hls = {
        on: vi.fn(), off: vi.fn(), destroy: vi.fn(), loadSource: vi.fn(), attachMedia: vi.fn(),
        levels: [], audioTracks: [], subtitleTracks: [], audioTrack: -1,
    } as unknown as Hls;
    return { video, hls };
}

describe('LiveChannelPreview: assumir o pipeline devolvido pelo player', () => {
    it('põe o MESMO <video> na tela, sem recarregar, e devolve no handOff', () => {
        const devolvido = pipelineTocando();
        const ref = createRef<LiveChannelPreviewHandle>();
        const { container } = render(
            <LiveChannelPreview ref={ref} src="http://painel/live/1.m3u8" adopt={devolvido} />,
        );

        // O <video> mora na camada (fora da página); na página só o slot
        expect(container.querySelector('video')).toBeNull();
        expect(container.querySelector('.live-channel-preview-slot')).not.toBeNull();
        expect(devolvido.video.parentElement?.className).toBe('camada-video-quadro');
        expect(devolvido.video.className).toBe('live-channel-preview-video');
        // Nada de loadSource/attachMedia: segue no stream que já estava tocando
        expect(devolvido.hls.loadSource).not.toHaveBeenCalled();
        expect(devolvido.hls.attachMedia).not.toHaveBeenCalled();
        expect(devolvido.video.getAttribute('src')).toBe('blob:canal-no-ar');

        // Reabrir o player: a prévia entrega o mesmo pipeline adiante
        const deNovo = ref.current?.handOff();
        expect(deNovo?.video).toBe(devolvido.video);
        expect(deNovo?.hls).toBe(devolvido.hls);
        expect(devolvido.hls.destroy).not.toHaveBeenCalled();
    });
});

describe('LiveChannelPreview: troca de página sem mover o <video>', () => {
    it('Home → TV ao Vivo: a página que entra assume o estacionado e o <video> nunca sai do documento', () => {
        const pipeline = pipelineTocando();
        const ref = createRef<LiveChannelPreviewHandle>();
        // 1ª página: prévia tocando (o <video> entra na camada uma vez, aqui)
        const home = render(<LiveChannelPreview ref={ref} src="http://painel/live/7.m3u8" adopt={pipeline} />);
        const quadro = pipeline.video.parentElement;

        // webOS: sair do documento derruba o pipeline — vigia QUALQUER remoção dele
        const removido = vi.fn();
        const vigia = new MutationObserver(ms => ms.forEach(m => m.removedNodes.forEach(n => {
            if (n === pipeline.video || n === quadro) removido();
        })));
        vigia.observe(document.body, { childList: true, subtree: true });

        // Página saindo: estaciona e desmonta
        const entregue = ref.current!.handOff()!;
        pipelineEstacionado.estacionar(7, entregue);
        home.unmount();

        // Página entrando: assume pelo canal
        const { container } = render(<LiveChannelPreview src="http://painel/live/7.m3u8" canalId={7} />);
        vigia.takeRecords().forEach(m => m.removedNodes.forEach(n => {
            if (n === pipeline.video || n === quadro) removido();
        }));
        vigia.disconnect();

        expect(removido).not.toHaveBeenCalled();
        expect(pipeline.video.parentElement).toBe(quadro);
        expect(pipeline.video.isConnected).toBe(true);
        expect(container.querySelector('.live-channel-preview-slot')).not.toBeNull();
        expect(pipeline.hls.destroy).not.toHaveBeenCalled();
        pipelineEstacionado.descartar();
    });
});

describe('LiveChannelPreview: stream pendurado', () => {
    it("não subiu em LIVE_START_TIMEOUT_MS sem erro nenhum: avisa 'stall' (a TV ao Vivo tenta outra variante)", () => {
        vi.useFakeTimers();
        const onError = vi.fn();
        // jsdom não toca: o <video> fica em readyState 0, como um stream que não sobe
        render(<LiveChannelPreview src="http://painel/live/2.m3u8" onError={onError} />);
        // Sem MSE nem HLS nativo no jsdom o useHls não carrega nada e não dá
        // erro — exatamente o stream pendurado
        vi.advanceTimersByTime(LIVE_START_TIMEOUT_MS - 1);
        expect(onError).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith('stall');
        // Um aviso só: o tempo seguir passando não repete
        vi.advanceTimersByTime(LIVE_START_TIMEOUT_MS);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('pipeline devolvido (já tocando) não entra no relógio de partida', () => {
        vi.useFakeTimers();
        const onError = vi.fn();
        render(<LiveChannelPreview src="http://painel/live/1.m3u8" adopt={pipelineTocando()} onError={onError} />);
        vi.advanceTimersByTime(LIVE_START_TIMEOUT_MS * 2);
        expect(onError).not.toHaveBeenCalled();
    });
});
