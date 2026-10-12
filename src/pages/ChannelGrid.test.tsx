// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { ChannelGrid, type ChannelGridHandle } from './ChannelGrid';
import type { LiveStream } from '../types';

// jsdom não tem tamanho: o Grid real não montaria célula nenhuma. Este monta todas.
vi.mock('react-window', () => ({
    Grid: ({ cellComponent, cellProps, columnCount, rowCount }: {
        cellComponent: ComponentType<Record<string, unknown>>; cellProps: object; columnCount: number; rowCount: number;
    }) => Array.from({ length: rowCount * columnCount }, (_, i) => createElement(cellComponent, {
        ...cellProps, key: i, rowIndex: Math.floor(i / columnCount), columnIndex: i % columnCount, style: {}, ariaAttributes: {},
    })),
}));
vi.mock('../services/channelVariants', () => ({ channelDisplayName: (n: string) => n }));

const canais = Array.from({ length: 6 }, (_, i) => ({ stream_id: i + 1, name: `Canal ${i + 1}` }) as LiveStream);
const nada = () => {};
const vazio = new Set<number>();
const quebrado = () => true;

describe('ChannelGrid', () => {
    it('seta no controle move o foco SEM re-renderizar a página dona da grade', () => {
        let rendersDoPai = 0;
        const grade: { current: ChannelGridHandle | null } = { current: null };
        const onOpen = vi.fn();
        function Pagina() {
            rendersDoPai++;
            return (
                <ChannelGrid
                    ref={(h) => { grade.current = h; }}
                    items={canais} columns={3} columnWidth={220} active
                    isBroken={quebrado} onImageError={nada} onSelect={nada} onOpen={onOpen}
                    onExitUp={nada} onExitLeft={nada} selectedId={undefined} favoriteIds={vazio}
                />
            );
        }
        const { container } = render(<Pagina />);
        const focado = () => container.querySelector('.tv-focused')?.textContent;
        const antes = rendersDoPai;
        expect(focado()).toContain('Canal 1');

        act(() => grade.current!.navigate('right'));
        act(() => grade.current!.navigate('down'));
        expect(focado()).toContain('Canal 5');
        expect(grade.current!.focusedIndex()).toBe(4);
        expect(rendersDoPai).toBe(antes);

        act(() => grade.current!.select());
        expect(onOpen).toHaveBeenCalledWith(canais[4]);
    });
});
