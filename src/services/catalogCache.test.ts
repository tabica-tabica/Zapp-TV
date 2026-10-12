import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { readCatalog, writeCatalog, dropCatalog, clearCatalogCache } from './catalogCache';

const id = <T,>(x: T) => x;

beforeEach(() => {
    installFakeStorage();
    clearCatalogCache();
});

describe('catalogCache em memória', () => {
    // A TV ao Vivo relia ~0,5 MB de JSON a cada visita (duas vezes)
    it('depois da 1ª leitura não lê o catálogo do localStorage de novo', () => {
        writeCatalog('live', [{ a: 1 }], id);
        clearCatalogCache(); // só pra começar sem memória (apaga o guardado também)
        writeCatalog('live', [{ a: 2 }], id);
        const getItem = vi.spyOn(localStorage, 'getItem');
        const lidasDoCatalogo = () => getItem.mock.calls.filter(([k]) => String(k).includes('catalog_cache')).length;
        expect(readCatalog('live')).toEqual([{ a: 2 }]);
        expect(readCatalog('live')).toEqual([{ a: 2 }]);
        writeCatalog('live', [{ a: 3 }], id); // recente: nem regrava
        expect(lidasDoCatalogo()).toBe(0);
        getItem.mockRestore();
    });

    it('descartar apaga a memória junto', () => {
        writeCatalog('live', [{ a: 1 }], id);
        dropCatalog('live');
        expect(readCatalog('live')).toBeNull();
    });
});
