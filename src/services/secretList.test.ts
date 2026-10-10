import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import {
    insertMoment, nextMoment, prevMoment, firstMoment, formatMoment, secretList, MAX_MOMENTOS,
} from './secretList';
import { KEYS_LISTAS, KEYS_PREFERENCIAS } from './storageKeys';

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
