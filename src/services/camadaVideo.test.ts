// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { criarQuadro, montar, elevarQuadro } from './camadaVideo';

describe('elevarQuadro', () => {
    it('player em tela cheia: o quadro sobe pro z do vídeo (senão a sidebar fica por cima) e volta ao fechar (sem a classe de tela cheia)', () => {
        const q = criarQuadro();
        montar(q);
        q.video.classList.add('video-no-lugar');
        const desfazer = elevarQuadro(q.video);
        expect(q.el.style.zIndex).toBe('9998');
        desfazer();
        expect(q.el.style.zIndex).toBe('');
        // Fechou sem devolver: o <video> morto não pode ficar em tela cheia por cima da página
        expect(q.video.classList.contains('video-no-lugar')).toBe(false);
    });
});
