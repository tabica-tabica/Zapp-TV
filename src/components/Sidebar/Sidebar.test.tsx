// @vitest-environment jsdom
//
// "Sair" apaga a playlist e a conta do aparelho: um OK só não pode deslogar
// (visto na TV em 14/10/2026 — um ↓ a mais no menu caiu no Sair).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/FocusContext', () => ({ useFocusZone: () => ({ setFocusZone: () => {} }) }));
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../services/reloadPlaylist', () => ({ reloadActivePlaylist: () => {} }));
// Definido pelo Vite no build
vi.hoisted(() => { const g = globalThis as Record<string, unknown>; g.__BRAND_ACCENT_HEX__ = g.__BRAND_ACCENT4_HEX__ = '#000'; });
vi.mock('../BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('../../services/contentFlags', () => ({ contentFlags: { includeTV: () => true, includeVOD: () => true } }));

import { Sidebar } from './Sidebar';

const tecla = (key: string) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

afterEach(cleanup);

function montar() {
    const onLogout = vi.fn();
    const r = render(<Sidebar activeItem="home" onItemSelect={() => {}} onLogout={onLogout} onProfileClick={() => {}} focused />);
    return { onLogout, ...r };
}

describe('Sidebar: Sair pede confirmação', () => {
    it('controle: 1º OK só arma (e avisa), o 2º sai', () => {
        const { onLogout, getByText } = montar();
        for (let i = 0; i < 12; i++) tecla('ArrowDown'); // vai até o fim: Sair
        tecla('Enter');
        expect(onLogout).not.toHaveBeenCalled();
        expect(getByText('sidebar_logout_confirm')).toBeTruthy();
        tecla('Enter');
        expect(onLogout).toHaveBeenCalledTimes(1);
    });

    it('mover o foco desarma: OK depois de voltar pede de novo', () => {
        const { onLogout } = montar();
        for (let i = 0; i < 12; i++) tecla('ArrowDown');
        tecla('Enter');
        tecla('ArrowUp');
        tecla('ArrowDown');
        tecla('Enter');
        expect(onLogout).not.toHaveBeenCalled();
    });

    it('mouse: dois cliques', () => {
        const { onLogout, container } = montar();
        const botao = container.querySelector('.logout-btn')!;
        fireEvent.click(botao);
        expect(onLogout).not.toHaveBeenCalled();
        fireEvent.click(botao);
        expect(onLogout).toHaveBeenCalledTimes(1);
    });
});
