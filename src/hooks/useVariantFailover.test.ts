// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { LiveStream } from '../types';

const canais = [
    { stream_id: 1, name: 'ESPN HD' },
    { stream_id: 2, name: 'ESPN 4K' },
    { stream_id: 3, name: 'ESPN FHD' },
    { stream_id: 9, name: 'Outro HD' },
] as LiveStream[];

vi.mock('../services/api', () => ({ api: { getLiveStreams: () => Promise.resolve(canais) } }));

import { useVariantFailover } from './useVariantFailover';
import { installFakeStorage } from '../testing/fakeStorage';

beforeEach(() => { installFakeStorage(); });

describe('useVariantFailover', () => {
    it('HD (padrão) caiu com 4K no ar: vai pra 4K, depois FHD, e dá a volta sem repetir a que falhou', async () => {
        const play = vi.fn();
        const { result, rerender } = renderHook(({ c }) => useVariantFailover(c, play), { initialProps: { c: canais[0] } });
        await waitFor(() => expect(result.current.onStreamFailed).toBeDefined());
        act(() => result.current.onStreamFailed!());
        expect(play).toHaveBeenLastCalledWith(canais[1]);

        rerender({ c: canais[1] });
        act(() => result.current.onStreamFailed!());
        expect(play).toHaveBeenLastCalledWith(canais[2]);

        // FHD caiu também: HD e 4K já falharam → nada sobrando
        rerender({ c: canais[2] });
        expect(result.current.onStreamFailed).toBeUndefined();
    });

    it('começando na FHD, a HD (antes dela na lista) também entra na roda', async () => {
        const play = vi.fn();
        const { result } = renderHook(() => useVariantFailover(canais[2], play));
        await waitFor(() => expect(result.current.onStreamFailed).toBeDefined());
        act(() => result.current.onStreamFailed!());
        expect(play).toHaveBeenCalledWith(canais[0]);
    });

    it('limite de conexões: não troca (seria mais uma conexão)', async () => {
        const play = vi.fn();
        const { result } = renderHook(() => useVariantFailover(canais[0], play));
        await waitFor(() => expect(result.current.onStreamFailed).toBeDefined());
        act(() => result.current.onStreamFailed!(true));
        expect(play).not.toHaveBeenCalled();
    });
});
