import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import { liveHealth, pontuacaoDe, costumaCairDe, ultimoCanalNoAr, variantesNoAr } from './liveHealth';
import { storage } from './storage';

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

    it('lembra o resultado mais recente', () => {
        liveHealth.registrar(3, 'ok');
        liveHealth.registrar(3, 'falha');
        expect(liveHealth.ultimoFalhou(3)).toBe(true);
        liveHealth.registrar(3, 'ok');
        expect(liveHealth.ultimoFalhou(3)).toBe(false);
        expect(liveHealth.ultimoFalhou(99)).toBe(false);
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

describe('ultimoCanalNoAr', () => {
    const c = (stream_id: number, name: string) => ({ stream_id, name });
    const canais = [c(1, 'CNN Money'), c(2, 'CNN Money FHD'), c(3, 'CNN Money HD'), c(4, 'Outro')];

    it('a HD que caiu na última tentativa cede pra FHD, que vira o último canal', () => {
        storage.setLastChannel(3);
        liveHealth.registrar(3, 'ok');
        liveHealth.registrar(3, 'falha');
        expect(ultimoCanalNoAr(canais)?.stream_id).toBe(2);
        expect(storage.getLastChannel()).toBe(2);
    });

    // Visto na LG (12/10/2026): HD com ~15 acertos antigos cai; a simples (com
    // uma falha velha) é a que o failover acha. Sem o acerto da simples, a HD
    // segue ganhando pelo histórico — por isso o player conta acerto aos 10 s.
    it('CNN Internacional: a simples que o failover achou só vira padrão depois de contar acerto', () => {
        const cnn = [c(81017, 'CNN Internacional'), c(91565, 'CNN Internacional HD')];
        liveHealth.registrar(81017, 'falha');
        for (let i = 0; i < 15; i++) liveHealth.registrar(91565, 'ok');
        storage.setLastChannel(91565);
        liveHealth.registrar(91565, 'falha');
        expect(ultimoCanalNoAr(cnn)?.stream_id).toBe(91565);
        liveHealth.registrar(81017, 'ok');
        expect(ultimoCanalNoAr(cnn)?.stream_id).toBe(81017);
        expect(storage.getLastChannel()).toBe(81017);
    });

    it('variantesNoAr (fileira da Home): troca a HD que caiu e não repete o grupo', () => {
        liveHealth.registrar(3, 'ok');
        liveHealth.registrar(3, 'falha');
        // favoritos: a HD (caiu) e a FHD — mesmo grupo, vira uma só
        expect(variantesNoAr([canais[2], canais[1], canais[3]], canais).map(c => c.stream_id)).toEqual([2, 4]);
    });

    it('sem histórico fica o último assistido', () => {
        storage.setLastChannel(3);
        expect(ultimoCanalNoAr(canais)?.stream_id).toBe(3);
        expect(storage.getLastChannel()).toBe(3);
    });
});
