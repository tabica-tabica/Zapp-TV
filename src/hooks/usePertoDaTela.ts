// true quando o elemento chega perto da tela (e fica true): pra só pedir a
// imagem do card que o usuário vai ver. O `loading="lazy"` do <img> não
// serve: o Chromium 53 da LG ignora o atributo e baixava TODOS os pôsteres
// da Home de uma vez. IntersectionObserver existe desde o Chromium 51.
//
// Um observer só pra página inteira (um por card custaria caro na TV).

import { useEffect, useState, type RefObject } from 'react';

const avisos = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function observar(el: Element, aviso: () => void): () => void {
    if (!observer) {
        observer = new IntersectionObserver(entradas => {
            for (const entrada of entradas) {
                if (!entrada.isIntersecting) continue;
                avisos.get(entrada.target)?.();
                avisos.delete(entrada.target);
                observer?.unobserve(entrada.target);
            }
            // 300px de antecedência: o pôster já vem vindo antes de aparecer
        }, { rootMargin: '300px' });
    }
    avisos.set(el, aviso);
    observer.observe(el);
    return () => {
        avisos.delete(el);
        observer?.unobserve(el);
    };
}

export function usePertoDaTela(ref: RefObject<Element | null>): boolean {
    const semObserver = typeof IntersectionObserver === 'undefined';
    const [perto, setPerto] = useState(semObserver);
    useEffect(() => {
        if (perto || !ref.current) return;
        return observar(ref.current, () => setPerto(true));
    }, [perto, ref]);
    return perto;
}
