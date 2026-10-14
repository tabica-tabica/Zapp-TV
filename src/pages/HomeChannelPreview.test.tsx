// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { LiveStream } from '../types';
import { installFakeStorage } from '../testing/fakeStorage';

// A prévia de verdade precisa de hls.js/<video>: aqui só importa o onError
let falhar: ((causa?: string) => void) | undefined;
vi.mock('../components/LiveChannelPreview', () => ({
    LiveChannelPreview: (p: { onError?: (c?: string) => void }) => { falhar = p.onError; return <div data-testid="previa" />; },
}));
vi.mock('../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../services/epgService', () => ({ epgService: { getChannelEpg: () => Promise.resolve({}) } }));

import { HomeChannelPreview } from './HomeChannelPreview';

afterEach(cleanup);

const canal = { stream_id: 1, name: 'ESPN HD', stream_icon: '' } as LiveStream;

describe('HomeChannelPreview: prévia que não subiu', () => {
    it('a Home trocou de variante: segue na prévia, sem cair no logo', () => {
        installFakeStorage();
        const onFailed = vi.fn(() => true);
        const { queryByTestId } = render(<HomeChannelPreview channel={canal} focused={false} onWatch={() => {}} onFailed={onFailed} />);
        act(() => falhar?.('stall'));
        expect(onFailed).toHaveBeenCalledWith('stall');
        expect(queryByTestId('previa')).not.toBeNull();
    });

    it('sem variante pra trocar (ou limite de conexões): cai no logo', () => {
        installFakeStorage();
        const { queryByTestId } = render(<HomeChannelPreview channel={canal} focused={false} onWatch={() => {}} onFailed={() => false} />);
        act(() => falhar?.('connlimit'));
        expect(queryByTestId('previa')).toBeNull();
    });
});
