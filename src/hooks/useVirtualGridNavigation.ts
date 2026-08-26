// Navegação D-pad para grades virtualizadas (react-window).
//
// Movies/LiveTV/Series/MyList/Favorites reimplementavam, cada uma do zero, o
// mesmo `focusedIndex` + matemática de linha/coluna + `cols` hardcoded +
// scroll manual via `querySelector('.x-card.tv-focused')`. Esse scroll manual
// não funciona mais com virtualização: um item fora da janela renderizada nem
// tem nó no DOM pra buscar. Este hook centraliza a matemática (que já era
// orientada a índice, não a DOM) e troca o scroll manual pela API imperativa
// do react-window (`gridRef.scrollToCell`).
//
// O hook NÃO decide qual "área" de foco a página está (categorias, abas,
// menu de contexto, painel de preview) — cada página continua dona da sua
// própria máquina de estados pra isso e só entra/sai da grade via
// onExitUp/onExitLeft/onExitRight.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GridImperativeAPI } from 'react-window';

export type GridDirection = 'up' | 'down' | 'left' | 'right';

export interface UseVirtualGridNavigationOptions {
    /** Total de itens na grade (não só os visíveis — react-window cuida da janela). */
    itemCount: number;
    /** Colunas por linha. Fonte única de verdade — também vira a prop `columnCount` do Grid. */
    columns: number;
    /** Enquanto false, handleNavigate/handlePageSkip são no-op e o índice não rola sozinho. */
    enabled?: boolean;
    initialIndex?: number;
    /** Seta pra cima na primeira linha. */
    onExitUp?: () => void;
    /** Seta pra esquerda na primeira coluna. */
    onExitLeft?: () => void;
    /**
     * Seta pra direita na última coluna. Diferente de onExitUp/onExitLeft,
     * quem decide se REALMENTE sai é quem chama: devolva `true` pra sair
     * (o hook não move o índice) ou `false`/nada pra continuar fluindo pro
     * próximo item (que empurra o foco pra primeira coluna da linha de
     * baixo). Existe pra cobrir o caso do Movies, onde a saída pra barra
     * alfabética só acontece se a barra tiver mais de uma letra — sem essa
     * condição, "direita" simplesmente flui como em qualquer outra página.
     */
    onExitRight?: () => boolean;
    onSelect?: (index: number) => void;
    /** Distância do CH+/CH- (page skip). Default: 3 linhas. */
    pageSize?: number;
}

export function useVirtualGridNavigation({
    itemCount,
    columns,
    enabled = true,
    initialIndex = 0,
    onExitUp,
    onExitLeft,
    onExitRight,
    onSelect,
    pageSize,
}: UseVirtualGridNavigationOptions) {
    const [focusedIndex, setFocusedIndexState] = useState(initialIndex);
    const gridRef = useRef<GridImperativeAPI>(null);

    // Filtro/categoria mudou e a grade encolheu: puxa o foco de volta pro
    // último item válido em vez de deixá-lo apontar pro vazio. Ajuste feito
    // durante o render (não num efeito) — é o padrão recomendado pro React
    // pra "resetar/corrigir estado quando uma prop muda", sem o passe extra
    // de commit que um useEffect com setState causaria.
    const [prevItemCount, setPrevItemCount] = useState(itemCount);
    if (itemCount !== prevItemCount) {
        setPrevItemCount(itemCount);
        if (itemCount > 0 && focusedIndex > itemCount - 1) {
            setFocusedIndexState(itemCount - 1);
        }
    }

    const moveTo = useCallback((index: number) => {
        if (itemCount === 0) return;
        setFocusedIndexState(Math.max(0, Math.min(index, itemCount - 1)));
    }, [itemCount]);

    useEffect(() => {
        if (!enabled || !gridRef.current || columns === 0 || itemCount === 0) return;
        const rowIndex = Math.floor(focusedIndex / columns);
        const columnIndex = focusedIndex % columns;
        gridRef.current.scrollToCell({ rowIndex, columnIndex, rowAlign: 'smart', columnAlign: 'smart' });
    }, [focusedIndex, enabled, columns, itemCount]);

    const handleNavigate = useCallback((direction: GridDirection) => {
        if (!enabled || itemCount === 0 || columns === 0) return;
        const current = focusedIndex;
        const row = Math.floor(current / columns);
        const col = current % columns;

        switch (direction) {
            case 'up':
                if (row === 0) { onExitUp?.(); return; }
                moveTo(current - columns);
                return;
            case 'down':
                // Sem saída em nenhuma página hoje: sempre flui, e satura no
                // último item em vez de travar quando a última linha é curta.
                moveTo(current + columns);
                return;
            case 'left':
                if (col === 0) { onExitLeft?.(); return; }
                moveTo(current - 1);
                return;
            case 'right': {
                const isLastColumn = col === columns - 1;
                const saiu = isLastColumn ? (onExitRight?.() ?? false) : false;
                if (saiu) return;
                moveTo(current + 1);
                return;
            }
        }
    }, [enabled, itemCount, columns, focusedIndex, moveTo, onExitUp, onExitLeft, onExitRight]);

    const handlePageSkip = useCallback((direction: 'up' | 'down') => {
        if (!enabled || itemCount === 0) return;
        const distance = pageSize ?? columns * 3;
        moveTo(focusedIndex + (direction === 'up' ? -distance : distance));
    }, [enabled, itemCount, pageSize, columns, focusedIndex, moveTo]);

    const handleSelect = useCallback(() => {
        if (itemCount === 0) return;
        onSelect?.(focusedIndex);
    }, [itemCount, focusedIndex, onSelect]);

    return {
        focusedIndex,
        setFocusedIndex: moveTo,
        gridRef,
        handleNavigate,
        handlePageSkip,
        handleSelect,
    };
}
