import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { liveHealth, pontuacaoDe, costumaCairDe } from './liveHealth';

const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => installFakeStorage());

describe('liveHealth (benchmark passivo das fontes ao vivo)', () => {
    it('sem histórico é neutro e não "costuma cair"', () => {
        expect(liveHealth.pontuacao(1)).toBe(0.5);
        expect(liveHealth.costumaCair(1)).toBe(false);
    });

    it('uma falha só não condena; falhas repetidas sem acerto, sim', () => {
        const t = 1_000_000;
        liveHealth.registrar(7, 'falha', t);
        expect(liveHealth.costumaCair(7, t)).toBe(false);
        liveHealth.registrar(7, 'falha', t);
        liveHealth.registrar(7, 'falha', t);
        expect(liveHealth.costumaCair(7, t)).toBe(true);
        expect(liveHealth.pontuacao(7, t)).toBeLessThan(0.34);
    });

    it('acertos seguram a nota mesmo com algumas quedas', () => {
        const t = 1_000_000;
        for (let i = 0; i < 6; i++) liveHealth.registrar(9, 'ok', t);
        liveHealth.registrar(9, 'falha', t);
        liveHealth.registrar(9, 'falha', t);
        expect(liveHealth.costumaCair(9, t)).toBe(false);
        expect(liveHealth.pontuacao(9, t)).toBeGreaterThan(0.6);
    });

    it('o passado perde peso: canal consertado volta a ser escolhível', () => {
        const r = { ok: 0, falha: 4, em: 0 };
        expect(costumaCairDe(r, 0)).toBe(true);
        // 3 meias-vidas depois, 4 falhas viram 0,5
        expect(costumaCairDe(r, 21 * DIA)).toBe(false);
        expect(pontuacaoDe(r, 21 * DIA)).toBeGreaterThan(pontuacaoDe(r, 0));
    });
});
