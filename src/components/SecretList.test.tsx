// @vitest-environment jsdom
//
// Controle remoto na lista secreta: ↑↓/→← movem o foco e o item focado rola
// pra dentro da tela (a lista rola por dentro; sem isso o foco sumia).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Definido pelo Vite no build; aqui precisa existir ANTES do import do componente
vi.hoisted(() => { (globalThis as Record<string, unknown>).__BUILD_TARGET__ = 'web'; });
// Só o pôster: o módulo do TMDB lê cache do storage ao carregar
vi.mock('../services/tmdb', () => ({ posterThumb: (url: string) => url }));

import { installFakeStorage } from '../testing/fakeStorage';
import { secretList } from '../services/secretList';
import { SecretList } from './SecretList';

const tecla = (key: string) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

beforeEach(() => {
    installFakeStorage();
    for (const id of ['1', '2', '3']) secretList.mover({ id, title: `Filme ${id}` });
    secretList.addMoment('2', 60);
    secretList.addMoment('2', 120);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('SecretList: navegação pelo controle', () => {
    it('↓ e → movem o foco, e o focado rola pra vista', () => {
        const rolar = vi.fn();
        Element.prototype.scrollIntoView = rolar;
        const { container } = render(<SecretList onClose={() => {}} onPlay={() => {}} />);
        const focado = () => container.querySelector('.tv-focused');

        // mover() põe no TOPO: a ordem na tela é 3, 2, 1
        expect(focado()?.textContent).toContain('Filme 3');

        tecla('ArrowDown');
        expect(focado()?.textContent).toContain('Filme 2');
        expect(rolar.mock.contexts.at(-1)).toBe(focado());

        tecla('ArrowRight');
        expect(focado()?.textContent).toContain('1:00');
        expect(rolar.mock.contexts.at(-1)).toBe(focado());

        tecla('ArrowRight');
        expect(focado()?.textContent).toContain('2:00');
    });

    it('OK toca o momento focado', () => {
        Element.prototype.scrollIntoView = vi.fn();
        const onPlay = vi.fn();
        render(<SecretList onClose={() => {}} onPlay={onPlay} />);
        tecla('ArrowDown');
        tecla('ArrowRight');
        tecla('Enter');
        expect(onPlay).toHaveBeenCalledWith(expect.any(Array), 1, 60);
    });
});
