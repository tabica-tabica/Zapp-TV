// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { FileiraPreguicosa } from './FileiraPreguicosa';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const itens = Array.from({ length: 15 }, (_, i) => `Filme ${i}`);
const montar = (focado: number) => render(
    <FileiraPreguicosa itens={itens} focado={focado}>{(item) => <span key={item} className="c">{item}</span>}</FileiraPreguicosa>,
);
// Fileira de 528px: cabem 3 cards (176px cada)
const larguraDaFileira = (px: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);

describe('FileiraPreguicosa', () => {
    it('monta só o que cabe + 2 de folga, não as 15', () => {
        larguraDaFileira(528);
        expect(montar(-1).container.querySelectorAll('.c')).toHaveLength(5);
    });

    it('foco do controle andando pra direita monta os próximos (o focado sempre existe no DOM)', () => {
        larguraDaFileira(528);
        expect(montar(9).container.querySelectorAll('.c')).toHaveLength(12);
        cleanup();
        expect(montar(14).container.querySelectorAll('.c')).toHaveLength(15);
    });

    it('rolagem do mouse monta até onde a vista chegou', () => {
        larguraDaFileira(528);
        const { container } = montar(-1);
        const fileira = container.querySelector('.content-row')!;
        Object.defineProperty(fileira, 'scrollLeft', { value: 528, configurable: true });
        fireEvent.scroll(fileira);
        // vista até 1056px = 6 cards + 2 de folga
        expect(container.querySelectorAll('.c')).toHaveLength(8);
    });
});
