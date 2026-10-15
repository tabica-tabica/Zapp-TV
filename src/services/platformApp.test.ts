// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { aplicarMudo } from './platformApp';

afterEach(() => { vi.unstubAllGlobals(); });

describe('aplicarMudo (prévia ao vivo)', () => {
    it('desktop: mudo vira volume 0 com o vídeo "com som" (começar mudo trava o seek no WebKitGTK)', () => {
        vi.stubGlobal('__BUILD_TARGET__', 'tauri');
        const video = document.createElement('video');
        aplicarMudo(video, true);
        expect([video.muted, video.volume]).toEqual([false, 0]);
        aplicarMudo(video, false);
        expect([video.muted, video.volume]).toEqual([false, 1]);
    });

    it('TV e navegador: o mudo de sempre', () => {
        vi.stubGlobal('__BUILD_TARGET__', 'webos');
        const video = document.createElement('video');
        aplicarMudo(video, true);
        expect(video.muted).toBe(true);
    });
});
