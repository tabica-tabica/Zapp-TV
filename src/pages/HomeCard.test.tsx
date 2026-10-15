// @vitest-environment jsdom
//
// A Home não mostra filme/série sem capa: a capa que existe mas não carrega
// avisa a página (onImageError), que tira o card das fileiras.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('../services/tmdb', () => ({ posterThumb: (url: string) => url }));

import { HomeCard } from './HomeCard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('HomeCard: capa que não carrega', () => {
    it('avisa a página com a URL da capa', () => {
        const onImageError = vi.fn();
        const { container } = render(
            <HomeCard item={{ id: 1 }} index={0} focused={false} title="Filme" image="http://img/x.jpg"
                onSelect={() => {}} onImageError={onImageError} />,
        );
        fireEvent.error(container.querySelector('img')!);
        expect(onImageError).toHaveBeenCalledWith('http://img/x.jpg');
    });
});

describe('HomeCard: pôster só perto da tela', () => {
    it('sem chegar perto não pede a imagem; chegou, pede (o lazy do <img> a LG ignora)', () => {
        let avisar: ((e: Array<{ isIntersecting: boolean; target: Element }>) => void) | undefined;
        vi.stubGlobal('IntersectionObserver', class {
            constructor(cb: typeof avisar) { avisar = cb; }
            observe() {}
            unobserve() {}
        });
        const { container } = render(
            <HomeCard item={{ id: 2 }} index={0} focused={false} title="Longe" image="http://img/longe.jpg" onSelect={() => {}} />,
        );
        expect(container.querySelector('img')).toBeNull();
        act(() => avisar?.([{ isIntersecting: true, target: container.querySelector('button')! }]));
        expect(container.querySelector('img')?.getAttribute('src')).toBe('http://img/longe.jpg');
    });
});
