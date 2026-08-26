// @vitest-environment jsdom
//
// O hook que decide se abrir uma categoria precisa de PIN. O caso que mais
// importa: sem PIN nenhum ainda, o primeiro toque numa categoria adulta
// provisiona "0000" e só DEPOIS abre o prompt — nunca antes de gravar.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { installFakeStorage } from '../testing/fakeStorage';
import { parentalService } from '../services/parentalService';
import { useAdultLock } from './useAdultLock';
import type { Category } from '../types';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const CATEGORIES: Category[] = [
    { category_id: '1', category_name: 'Filmes de Ação', parent_id: 0 },
    { category_id: '2', category_name: 'Filmes Adultos', parent_id: 0 },
];

beforeEach(() => {
    installFakeStorage();
});

describe('useAdultLock', () => {
    it('categoria não-adulta passa direto, sem prompt', () => {
        const { result } = renderHook(() => useAdultLock(CATEGORIES));
        let proceeded = false;
        act(() => result.current.guardSelect('1', () => { proceeded = true; }));

        expect(proceeded).toBe(true);
        expect(result.current.pendingCategoryId).toBeNull();
    });

    it('marca categorias adultas em lockedCategoryIds', () => {
        const { result } = renderHook(() => useAdultLock(CATEGORIES));
        expect(result.current.lockedCategoryIds.has('2')).toBe(true);
        expect(result.current.lockedCategoryIds.has('1')).toBe(false);
    });

    it('categoria adulta sem PIN provisiona "0000" e só então abre o prompt', async () => {
        expect(parentalService.isSet()).toBe(false);
        const { result } = renderHook(() => useAdultLock(CATEGORIES));

        let proceeded = false;
        act(() => result.current.guardSelect('2', () => { proceeded = true; }));

        await waitFor(() => expect(result.current.pendingCategoryId).toBe('2'));

        expect(proceeded).toBe(false);
        expect(parentalService.isSet()).toBe(true);
        expect(await parentalService.verify('0000')).toBe(true);
        expect(result.current.justProvisioned).toBe(true);
    });

    it('categoria adulta com PIN já definido abre o prompt na hora, sem provisionar de novo', async () => {
        await parentalService.set('1234');
        const { result } = renderHook(() => useAdultLock(CATEGORIES));

        act(() => result.current.guardSelect('2', () => {}));

        expect(result.current.pendingCategoryId).toBe('2');
        expect(result.current.justProvisioned).toBe(false);
        expect(await parentalService.verify('0000')).toBe(false); // não sobrescreveu o PIN do usuário
    });

    it('depois de unlocked, categorias adultas passam direto', () => {
        const { result } = renderHook(() => useAdultLock(CATEGORIES));
        act(() => result.current.setUnlocked(true));

        let proceeded = false;
        act(() => result.current.guardSelect('2', () => { proceeded = true; }));
        expect(proceeded).toBe(true);
    });
});
