// Mede a largura do container e devolve quantas colunas cabem, dado um
// tamanho-alvo de card. Fonte única de verdade pro `columns` que hoje está
// hardcoded (e duplicado no CSS) em Movies/LiveTV/Series/MyList/Favorites —
// substitui o `cols = 6` fixo por algo que reage ao tamanho real da tela.
//
// O hook é DONO do ref (devolve um callback ref, não recebe um RefObject).
// Motivo: um RefObject comum (`useRef`) não dispara re-render nem reroda
// efeito quando `.current` muda — só quando as DEPS do efeito mudam. Em
// páginas com carregamento assíncrono (Series/LiveTV/Movies), o container só
// existe no DOM depois que os dados chegam; um efeito com `useRef` como dep
// mede `null` na primeira vez e nunca mais roda, porque a identidade do
// RefObject não muda. Um callback ref soluciona isso: cada anexação de nó
// vira uma chamada nova, que vira estado novo, que dispara o efeito de novo.

import { useCallback, useLayoutEffect, useState } from 'react';

/** Largura reservada pra barra de rolagem vertical da grade. */
const RESERVA_BARRA = 14;

interface UseMeasuredColumnsOptions {
    /** Largura-alvo VISÍVEL do card (sem o gap), em px. */
    cardWidth: number;
    /** Espaço entre cards, em px. */
    gap: number;
    minColumns?: number;
    maxColumns?: number;
}

export function useMeasuredColumns<T extends HTMLElement = HTMLDivElement>(
    { cardWidth, gap, minColumns = 2, maxColumns = 10 }: UseMeasuredColumnsOptions
) {
    const [node, setNode] = useState<T | null>(null);
    const [columns, setColumns] = useState(minColumns);
    const [containerWidth, setContainerWidth] = useState(0);

    const containerRef = useCallback((el: T | null) => {
        setNode(el);
    }, []);

    useLayoutEffect(() => {
        if (!node) return;

        const medir = (medida: number) => {
            // A grade rola por dentro: a barra vertical dela come largura do
            // container. Sem reservar, a última coluna ia por baixo da barra e
            // encostava na borda (WebKitGTK do desktop: barra ~12px).
            const largura = Math.max(0, medida - RESERVA_BARRA);
            setContainerWidth(largura);
            const porLargura = Math.floor(largura / (cardWidth + gap));
            setColumns(Math.max(minColumns, Math.min(maxColumns, porLargura || minColumns)));
        };

        medir(node.clientWidth);

        const observer = new ResizeObserver(entries => {
            const largura = entries[0]?.contentRect.width;
            if (largura) medir(largura);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [node, cardWidth, gap, minColumns, maxColumns]);

    // `columnWidth` é o PITCH da coluna (o que o react-window espera) — a
    // célula inteira, gap incluído. O card visível fica `pitch - gap`
    // (CatalogCard/SeriesCard cuidam disso via CSS). A última coluna sobra um
    // resto de pixel não usado na borda direita — cosmético, não afeta a nav.
    const columnWidth = containerWidth > 0
        ? Math.floor(containerWidth / columns)
        : cardWidth + gap;

    return { containerRef, columns, columnWidth };
}
