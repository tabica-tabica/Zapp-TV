import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import {
    insertMoment, nextMoment, prevMoment, firstMoment, formatMoment, secretList, MAX_MOMENTOS,
    limitarMiniaturas, type ItemSecreto,
} from './secretList';
import { KEYS_LISTAS, KEYS_PREFERENCIAS } from './storageKeys';
import { storage } from './storage';
import { listsService } from './listsService';

beforeEach(() => {
    installFakeStorage();
});

describe('momentos', () => {
    it('insere em segundos inteiros, em ordem', () => {
        expect(insertMoment([600, 120], 300.6)).toEqual([120, 301, 600]);
    });

    it('ignora um ponto a até 3s de outro', () => {
        expect(insertMoment([120], 122.4)).toEqual([120]);
        expect(insertMoment([120], 124)).toEqual([120, 124]);
    });

    it('respeita o teto', () => {
        const cheio = Array.from({ length: MAX_MOMENTOS }, (_, i) => i * 10);
        expect(insertMoment(cheio, 99999)).toHaveLength(MAX_MOMENTOS);
    });

    it('próximo e anterior, inclusive nas pontas', () => {
        const m = [100, 300, 600];
        expect(nextMoment(m, 0)).toBe(100);
        expect(nextMoment(m, 300)).toBe(600);
        expect(nextMoment(m, 600)).toBeNull();
        expect(prevMoment(m, 650)).toBe(600);
        expect(prevMoment(m, 100)).toBeNull();
        expect(firstMoment(m)).toBe(100);
        expect(firstMoment([])).toBeNull();
    });

    // Logo depois de pular pro 300 (relógio em 301), "anterior" tem que ir pro
    // 100 — não voltar pro 300 de onde acabou de sair
    it('anterior logo depois de um pulo vai pro de antes', () => {
        expect(prevMoment([100, 300, 600], 301)).toBe(100);
    });
});

describe('formatMoment', () => {
    it('minutos e horas', () => {
        expect(formatMoment(754)).toBe('12:34');
        expect(formatMoment(3754)).toBe('1:02:34');
        expect(formatMoment(5)).toBe('0:05');
    });
});

describe('secretList', () => {
    const filme = { id: '42', title: 'Filme A', container: 'mp4' };

    it('toggle põe e tira', () => {
        expect(secretList.toggle(filme)).toBe(true);
        expect(secretList.has('42')).toBe(true);
        expect(secretList.toggle(filme)).toBe(false);
        expect(secretList.has('42')).toBe(false);
    });

    it('momentos ficam no filme e persistem', () => {
        secretList.toggle(filme);
        secretList.addMoment('42', 600);
        secretList.addMoment('42', 120);
        expect(secretList.list()[0].moments).toEqual([120, 600]);
        secretList.removeMoment('42', 120);
        expect(secretList.list()[0].moments).toEqual([600]);
    });

    it('momento em filme fora da lista não cria nada', () => {
        expect(secretList.addMoment('99', 10)).toEqual([]);
        expect(secretList.list()).toEqual([]);
    });

    // Secreta: fora do grupo que o backup por QR e o snapshot exportam
    it('a chave está nas listas, não nas preferências', () => {
        expect(KEYS_LISTAS).toContain('neostream_secret_list');
        expect(KEYS_PREFERENCIAS as readonly string[]).not.toContain('neostream_secret_list');
    });
});

describe('miniaturas', () => {
    const img = 'data:image/jpeg;base64,AAAA';

    it('guarda a miniatura no segundo do momento e apaga junto', () => {
        secretList.toggle({ id: '7', title: 'X' });
        secretList.addMoment('7', 120.4, img);
        expect(secretList.list()[0].thumbs).toEqual({ '120': img });
        secretList.removeMoment('7', 120);
        expect(secretList.list()[0].thumbs).toEqual({});
    });

    it('momento ignorado (perto de outro) não troca a miniatura', () => {
        secretList.toggle({ id: '7', title: 'X' });
        secretList.addMoment('7', 120, img);
        secretList.addMoment('7', 121, 'data:image/jpeg;base64,BBBB');
        expect(secretList.list()[0].thumbs).toEqual({ '120': img });
    });

    it('teto global corta pelos filmes mais antigos (fim da lista)', () => {
        const item = (id: string, n: number): ItemSecreto => ({
            id, title: id, addedAt: 0, moments: [],
            thumbs: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), img])),
        });
        const itens = limitarMiniaturas([item('novo', 3), item('velho', 3)], 4);
        expect(Object.keys(itens[0].thumbs ?? {})).toHaveLength(3);
        expect(Object.keys(itens[1].thumbs ?? {})).toHaveLength(1);
    });

    it('descarta o que não é imagem', () => {
        localStorage.setItem('neostream_secret_list', JSON.stringify([
            { id: '1', title: 'A', moments: [5], thumbs: { '5': 'javascript:alert(1)' } },
        ]));
        expect(secretList.list()[0].thumbs).toEqual({});
    });
});

describe('mover pra lista secreta', () => {
    it('tira da Minha Lista e das listas nomeadas', () => {
        const filme = { id: '42', type: 'movie' as const, title: 'Filme A' };
        storage.toggleWatchLater(filme);
        const lista = listsService.create('Clássicos');
        expect(lista).not.toBeNull();
        listsService.toggleItem(lista!.id, filme);
        expect(storage.isInWatchLater('42', 'movie')).toBe(true);

        expect(secretList.mover({ id: '42', title: 'Filme A' })).toBe(true);
        expect(secretList.has('42')).toBe(true);
        expect(storage.isInWatchLater('42', 'movie')).toBe(false);
        expect(listsService.has(lista!.id, '42', 'movie')).toBe(false);
    });

    it('mover de novo não duplica nem apaga os momentos', () => {
        secretList.mover({ id: '42', title: 'Filme A' });
        secretList.addMoment('42', 60);
        secretList.mover({ id: '42', title: 'Filme A' });
        expect(secretList.list()).toHaveLength(1);
        expect(secretList.list()[0].moments).toEqual([60]);
    });
});
