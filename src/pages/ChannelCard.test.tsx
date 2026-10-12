// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChannelCard } from './ChannelCard';
import type { LiveStream } from '../types';

const nome = vi.hoisted(() => vi.fn((n: string) => n));
vi.mock('../services/channelVariants', () => ({ channelDisplayName: nome }));

describe('ChannelCard memo', () => {
    // react-window 2 manda um style NOVO (mesmo valor) a cada render da grade
    it('não redesenha com style novo de mesmo valor; redesenha quando o foco muda', () => {
        const stream = { stream_id: 1, name: 'Canal' } as LiveStream;
        const base = { stream, selected: false, isFavorite: false, broken: true, onImageError: () => {}, onSelect: () => {} };
        const { rerender } = render(<ChannelCard {...base} focused={false} style={{ height: 84, transform: 'translate(0px, 0px)' }} />);
        const antes = nome.mock.calls.length;
        rerender(<ChannelCard {...base} focused={false} style={{ height: 84, transform: 'translate(0px, 0px)' }} />);
        expect(nome.mock.calls.length).toBe(antes);
        rerender(<ChannelCard {...base} focused style={{ height: 84, transform: 'translate(0px, 0px)' }} />);
        expect(nome.mock.calls.length).toBeGreaterThan(antes);
        rerender(<ChannelCard {...base} focused style={{ height: 84, transform: 'translate(0px, 84px)' }} />);
        expect(nome.mock.calls.length).toBeGreaterThan(antes + 1);
    });
});
