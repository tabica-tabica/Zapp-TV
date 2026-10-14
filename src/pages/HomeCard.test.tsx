// @vitest-environment jsdom
//
// A Home não mostra filme/série sem capa: a capa que existe mas não carrega
// avisa a página (onImageError), que tira o card das fileiras.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../services/tmdb', () => ({ posterThumb: (url: string) => url }));

import { HomeCard } from './HomeCard';

afterEach(cleanup);

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
