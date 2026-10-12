// Grade de canais da TV ao Vivo, dona do próprio foco.
//
// O índice focado morava no LiveTV (1660 linhas): cada seta no controle
// re-renderizava a página inteira — prévia, barra, ficha — pra mudar 2 cards.
// Aqui o estado fica só na grade (memo); o LiveTV fala com ela pelo `ref`
// (navigate/select/focus) e só re-renderiza quando o foco SAI da grade.

import { memo, useImperativeHandle, useMemo, type Ref } from 'react';
import { Grid, type CellComponentProps } from 'react-window';
import { useVirtualGridNavigation, type GridDirection } from '../hooks/useVirtualGridNavigation';
import { ChannelCard } from './ChannelCard';
import type { LiveStream } from '../types';

export const CARD_WIDTH = 220;
export const CARD_GAP = 12;
// Card horizontal (logo + texto), não um pôster — altura fixa, não deriva de columnWidth.
const CARD_HEIGHT = 72;

export interface ChannelGridHandle {
    navigate: (direction: GridDirection) => void;
    select: () => void;
    focus: (index: number) => void;
    /** Lido na hora (tecla colorida, abrir o guia) — não causa render no pai. */
    focusedIndex: () => number;
}

interface ChannelCellProps {
    items: LiveStream[];
    columns: number;
    focusedIndex: number;
    gap: number;
    isBroken: (id: number) => boolean;
    onImageError: (id: number) => void;
    onSelect: (stream: LiveStream) => void;
    selectedId: number | undefined;
    favoriteIds: Set<number>;
}

function ChannelGridCell({
    rowIndex, columnIndex, style, items, columns, focusedIndex, gap, isBroken, onImageError, onSelect, selectedId, favoriteIds,
}: CellComponentProps<ChannelCellProps>) {
    const index = rowIndex * columns + columnIndex;
    const stream = items[index];
    if (!stream) return null;
    return (
        <ChannelCard
            stream={stream}
            focused={index === focusedIndex}
            selected={selectedId === stream.stream_id}
            isFavorite={favoriteIds.has(stream.stream_id)}
            broken={isBroken(stream.stream_id)}
            onImageError={onImageError}
            onSelect={onSelect}
            style={style}
            gap={gap}
        />
    );
}

interface ChannelGridProps {
    ref?: Ref<ChannelGridHandle>;
    items: LiveStream[];
    columns: number;
    columnWidth: number;
    /** Foco do controle está na grade (desenha o card focado e rola até ele). */
    active: boolean;
    isBroken: (id: number) => boolean;
    onImageError: (id: number) => void;
    /** Clique/toque num card. */
    onSelect: (stream: LiveStream) => void;
    /** OK do controle no card focado. */
    onOpen: (stream: LiveStream) => void;
    onExitUp: () => void;
    onExitLeft: () => void;
    selectedId: number | undefined;
    favoriteIds: Set<number>;
}

// Os callbacks precisam vir estáveis (useCallback) do LiveTV, senão o memo não segura nada.
export const ChannelGrid = memo(function ChannelGrid({
    ref, items, columns, columnWidth, active, isBroken, onImageError, onSelect, onOpen, onExitUp, onExitLeft, selectedId, favoriteIds,
}: ChannelGridProps) {
    const { focusedIndex, setFocusedIndex, gridRef, handleNavigate, handleSelect } = useVirtualGridNavigation({
        itemCount: items.length,
        columns,
        enabled: active,
        onExitUp,
        onExitLeft,
        onSelect: (index) => { const s = items[index]; if (s) onOpen(s); },
    });

    useImperativeHandle(ref, () => ({
        navigate: handleNavigate,
        select: handleSelect,
        focus: setFocusedIndex,
        focusedIndex: () => focusedIndex,
    }), [handleNavigate, handleSelect, setFocusedIndex, focusedIndex]);

    const cellProps = useMemo<ChannelCellProps>(() => ({
        items,
        columns,
        focusedIndex: active ? focusedIndex : -1,
        gap: CARD_GAP,
        isBroken,
        onImageError,
        onSelect,
        selectedId,
        favoriteIds,
    }), [items, columns, active, focusedIndex, isBroken, onImageError, onSelect, selectedId, favoriteIds]);

    return (
        <Grid
            className="channels-grid-viewport"
            gridRef={gridRef}
            cellComponent={ChannelGridCell}
            cellProps={cellProps}
            columnCount={columns}
            columnWidth={columnWidth}
            rowCount={Math.max(1, Math.ceil(items.length / columns))}
            rowHeight={CARD_HEIGHT + CARD_GAP}
            overscanCount={1}
            style={{ height: '100%', width: '100%' }}
        />
    );
});
