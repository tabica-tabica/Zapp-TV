// @vitest-environment jsdom
//
// Matemática de linha/coluna e o contrato com o react-window (scrollToCell
// via gridRef). Não testa nenhuma página real — cada página migrada ganha
// seu próprio teste de integração; este cobre só a lógica compartilhada.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVirtualGridNavigation } from './useVirtualGridNavigation';
import type { GridImperativeAPI } from 'react-window';

afterEach(cleanup);

function gridApiMock() {
    return { scrollToCell: vi.fn(), scrollToColumn: vi.fn(), scrollToRow: vi.fn(), element: null } as unknown as GridImperativeAPI;
}

describe('navegação linha/coluna', () => {
    it('down move o índice uma linha inteira (columns) pra frente', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6 }));
        act(() => result.current.handleNavigate('down'));
        expect(result.current.focusedIndex).toBe(6);
    });

    it('up na primeira linha chama onExitUp e não move', () => {
        const onExitUp = vi.fn();
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, onExitUp }));
        act(() => result.current.handleNavigate('up'));
        expect(onExitUp).toHaveBeenCalledTimes(1);
        expect(result.current.focusedIndex).toBe(0);
    });

    it('left na primeira coluna chama onExitLeft e não move', () => {
        const onExitLeft = vi.fn();
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, initialIndex: 6, onExitLeft }));
        act(() => result.current.handleNavigate('left'));
        expect(onExitLeft).toHaveBeenCalledTimes(1);
        expect(result.current.focusedIndex).toBe(6);
    });

    it('right na última coluna chama onExitRight; se ele devolver true, o hook não move', () => {
        const onExitRight = vi.fn(() => true);
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, initialIndex: 5, onExitRight }));
        act(() => result.current.handleNavigate('right'));
        expect(onExitRight).toHaveBeenCalledTimes(1);
        expect(result.current.focusedIndex).toBe(5);
    });

    it('right na última coluna com onExitRight devolvendo false continua fluindo pra próxima linha', () => {
        // Caso do Movies: só sai pra barra alfabética se ela tiver mais de uma letra.
        const onExitRight = vi.fn(() => false);
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, initialIndex: 5, onExitRight }));
        act(() => result.current.handleNavigate('right'));
        expect(onExitRight).toHaveBeenCalledTimes(1);
        expect(result.current.focusedIndex).toBe(6);
    });

    it('right sem onExitRight flui pra próxima linha (comportamento padrão do MyList/LiveTV/Series)', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, initialIndex: 5 }));
        act(() => result.current.handleNavigate('right'));
        expect(result.current.focusedIndex).toBe(6);
    });

    it('right no último item de uma linha incompleta apenas satura (não é coluna final, não sai)', () => {
        // 25 itens, 6 colunas: última linha tem só o índice 24 (coluna 0).
        const onExitRight = vi.fn(() => true);
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 25, columns: 6, initialIndex: 24, onExitRight }));
        act(() => result.current.handleNavigate('right'));
        expect(onExitRight).not.toHaveBeenCalled();
        expect(result.current.focusedIndex).toBe(24);
    });

    it('down além do fim da lista satura no último item em vez de travar (linha final incompleta)', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 25, columns: 6, initialIndex: 20 }));
        act(() => result.current.handleNavigate('down'));
        expect(result.current.focusedIndex).toBe(24);
    });

    it('down na última linha já completa não move', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 25, columns: 6, initialIndex: 24 }));
        act(() => result.current.handleNavigate('down'));
        expect(result.current.focusedIndex).toBe(24);
    });

    it('enabled=false ignora toda navegação', () => {
        const onExitUp = vi.fn();
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, enabled: false, onExitUp }));
        act(() => result.current.handleNavigate('down'));
        act(() => result.current.handleNavigate('up'));
        expect(result.current.focusedIndex).toBe(0);
        expect(onExitUp).not.toHaveBeenCalled();
    });
});

describe('page skip', () => {
    it('pula pageSize itens (default columns*3)', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 60, columns: 6, initialIndex: 30 }));
        act(() => result.current.handlePageSkip('down'));
        expect(result.current.focusedIndex).toBe(48);
        act(() => result.current.handlePageSkip('up'));
        expect(result.current.focusedIndex).toBe(30);
    });

    it('respeita um pageSize customizado', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 60, columns: 6, initialIndex: 10, pageSize: 5 }));
        act(() => result.current.handlePageSkip('down'));
        expect(result.current.focusedIndex).toBe(15);
    });

    it('não ultrapassa os limites', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 10, columns: 6, initialIndex: 0 }));
        act(() => result.current.handlePageSkip('up'));
        expect(result.current.focusedIndex).toBe(0);
    });
});

describe('seleção', () => {
    it('handleSelect chama onSelect com o índice focado', () => {
        const onSelect = vi.fn();
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6, initialIndex: 7, onSelect }));
        act(() => result.current.handleSelect());
        expect(onSelect).toHaveBeenCalledWith(7);
    });
});

describe('encolhimento da lista (filtro/categoria muda)', () => {
    it('puxa o foco de volta pro último item válido quando itemCount cai', () => {
        const { result, rerender } = renderHook(
            ({ itemCount }) => useVirtualGridNavigation({ itemCount, columns: 6, initialIndex: 20 }),
            { initialProps: { itemCount: 30 } }
        );
        expect(result.current.focusedIndex).toBe(20);
        rerender({ itemCount: 10 });
        expect(result.current.focusedIndex).toBe(9);
    });
});

describe('integração com o react-window (gridRef)', () => {
    it('scrollToCell é chamado com a linha/coluna do índice focado ao navegar', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6 }));
        const api = gridApiMock();
        act(() => { (result.current.gridRef as { current: GridImperativeAPI | null }).current = api; });
        act(() => result.current.handleNavigate('down'));
        expect(api.scrollToCell).toHaveBeenCalledWith(
            expect.objectContaining({ rowIndex: 1, columnIndex: 0 })
        );
    });

    it('não quebra se o gridRef ainda não estiver montado', () => {
        const { result } = renderHook(() => useVirtualGridNavigation({ itemCount: 30, columns: 6 }));
        expect(() => act(() => result.current.handleNavigate('down'))).not.toThrow();
    });
});
