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

afterEach(cleanup);

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

        expect(container.querySelector('video')).toBe(devolvido.video);
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
