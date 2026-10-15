// Fileira da Home que só monta os cards que cabem na tela (+ folga) e vai
// montando o resto conforme o usuário anda pra direita (foco do controle ou
// rolagem do mouse). Antes cada fileira montava os 15 cards de uma vez — a
// Home inteira passava de 100 cards com ~6 visíveis por fileira.
//
// Monta sempre um PREFIXO da lista: o índice do card no DOM é o índice do
// item, e a rolagem até o foco (Home.tsx, children[indice]) continua valendo.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Largura do .content-card (160) + gap da fileira (16) — Home.css */
const PASSO_PX = 176;
/** Cards montados além dos que cabem: o próximo já existe quando o foco chega */
const FOLGA = 2;

function cardsParaMontar(larguraVisivel: number, focado: number, rolados: number, total: number): number {
    const cabem = Math.ceil(larguraVisivel / PASSO_PX);
    return Math.min(total, Math.max(cabem, focado + 1, rolados) + FOLGA);
}

interface FileiraPreguicosaProps<T> {
    itens: readonly T[];
    /** Índice focado nesta fileira, ou -1 */
    focado: number;
    children: (item: T, index: number) => ReactNode;
}

export function FileiraPreguicosa<T>({ itens, focado, children }: FileiraPreguicosaProps<T>) {
    const ref = useRef<HTMLDivElement>(null);
    // Antes de medir: o que cabe numa tela de 1920 (sem piscar fileira curta)
    const [largura, setLargura] = useState(1920);
    const [rolados, setRolados] = useState(0);

    useLayoutEffect(() => {
        const el = ref.current;
        if (el && el.clientWidth) setLargura(el.clientWidth);
    }, []);

    const quantos = cardsParaMontar(largura, focado, rolados, itens.length);

    return (
        <div
            ref={ref}
            className="content-row"
            onScroll={e => {
                // Mouse/trackpad rolando a fileira: monta até onde a vista chegou
                const el = e.currentTarget;
                const ate = Math.ceil((el.scrollLeft + el.clientWidth) / PASSO_PX);
                if (ate > rolados) setRolados(ate);
            }}
        >
            {itens.slice(0, quantos).map((item, index) => children(item, index))}
        </div>
    );
}
