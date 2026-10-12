// As três decisões do player. Antes viviam dentro de handlers do HLS.js e só
// dava pra exercitá-las com uma TV, um provedor e uma queda de rede na hora
// certa — o que na prática significava não exercitá-las nunca.

import { describe, it, expect } from 'vitest';
import {
    classifyStreamError, isTerminalCause, reconnectDelayMs, chooseCappedLevel,
    MAX_RECONNECT_ATTEMPTS, liveFeedStalled, LIVE_STALL_MS, LIVE_START_TIMEOUT_MS,
    liveBufferDying, LIVE_BUFFER_LOW_S, LIVE_BUFFER_DRY_MS,
} from './playerDecisions';

describe('classifyStreamError', () => {
    it.each([404, 403])('%d é o provedor dizendo que o canal não existe aqui', (status) => {
        expect(classifyStreamError('network', status)).toBe('notfound');
        expect(isTerminalCause(classifyStreamError('network', status))).toBe(true);
    });

    it.each([500, 502, 0, undefined])('%s é rede instável — vale tentar de novo', (status) => {
        expect(classifyStreamError('network', status)).toBe('network');
        expect(isTerminalCause('network')).toBe(false);
    });

    it('erro de mídia e o resto ficam separados', () => {
        expect(classifyStreamError('media')).toBe('media');
        expect(classifyStreamError('other')).toBe('fatal');
    });

    // 404 num erro de MÍDIA não é "canal não existe": o fragmento chegou.
    it('o status só decide em erro de rede', () => {
        expect(classifyStreamError('media', 404)).toBe('media');
        expect(classifyStreamError('other', 404)).toBe('fatal');
    });
});

describe('reconnectDelayMs', () => {
    it('dobra a cada tentativa', () => {
        expect([1, 2, 3, 4].map(reconnectDelayMs)).toEqual([2000, 4000, 8000, 16000]);
    });

    // Sem o teto, a 6ª tentativa esperaria 64s numa tela que só diz
    // "Reconectando…" — parece travado.
    it('trava em 16s por mais que a tentativa suba', () => {
        expect(reconnectDelayMs(9)).toBe(16000);
        expect(reconnectDelayMs(99)).toBe(16000);
    });

    it('não devolve valor absurdo pra entrada estranha', () => {
        expect(reconnectDelayMs(0)).toBe(2000);
        expect(reconnectDelayMs(-5)).toBe(2000);
    });

    // O ciclo inteiro tem que caber num tempo que o usuário tolera antes do
    // failover pra próxima variante do canal.
    it('o ciclo completo cabe em 30s', () => {
        const total = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, i) => reconnectDelayMs(i + 1))
            .reduce((a, b) => a + b, 0);
        expect(total).toBe(30000);
    });
});

describe('chooseCappedLevel', () => {
    const niveis = [
        { index: 0, height: 360 },
        { index: 1, height: 720 },
        { index: 2, height: 1080 },
    ];

    it('pega o melhor que cabe no teto', () => {
        expect(chooseCappedLevel(niveis, 720)).toBe(1);
        expect(chooseCappedLevel(niveis, 1080)).toBe(2);
        expect(chooseCappedLevel(niveis, 900)).toBe(1);
    });

    it('teto zero (Automático) não trava nada', () => {
        expect(chooseCappedLevel(niveis, 0)).toBeNull();
    });

    it('quando nada cabe, fica com a menor declarada', () => {
        expect(chooseCappedLevel(niveis, 240)).toBe(0);
    });

    // BUG REAL (R5): height 0 quer dizer "o manifesto não declarou RESOLUTION",
    // muito comum em Xtream. Tratado como número, ele "cabia" em qualquer teto
    // e travava o canal inteiro na pior variante do provedor.
    it('height 0 é ausência de dado, não qualidade mínima', () => {
        const semDeclaracao = [
            { index: 0, height: 0 },
            { index: 1, height: 0 },
            { index: 2, height: 0 },
        ];
        expect(chooseCappedLevel(semDeclaracao, 720)).toBeNull();
    });

    it('ignora os não declarados quando há pelo menos um declarado', () => {
        const misto = [
            { index: 0, height: 0 },
            { index: 1, height: 480 },
            { index: 2, height: 1080 },
        ];
        expect(chooseCappedLevel(misto, 720)).toBe(1);
        // e nunca escolhe o índice 0 só porque 0 <= cap
        expect(chooseCappedLevel(misto, 100)).toBe(1);
    });

    it('lista vazia não trava nada', () => {
        expect(chooseCappedLevel([], 720)).toBeNull();
    });
});

describe('classifyStreamError: limite de conexões', () => {
    it('reconhece a mensagem do painel no corpo', () => {
        const body = '{"type":2,"message":"Maximum number of connections reached"}';
        expect(classifyStreamError('network', 500, { body })).toBe('connlimit');
        expect(isTerminalCause('connlimit')).toBe(false);
    });

    it.each([403, 500, 503])('%d logo depois de outro stream é a conexão velha ainda contando', (status) => {
        expect(classifyStreamError('network', status, { recentStreamMs: 2000 })).toBe('connlimit');
    });

    it('403 sem stream recente continua sendo canal inexistente', () => {
        expect(classifyStreamError('network', 403, { recentStreamMs: 120000 })).toBe('notfound');
        expect(classifyStreamError('network', 403)).toBe('notfound');
    });

    it('404 nunca é limite de conexão', () => {
        expect(classifyStreamError('network', 404, { recentStreamMs: 1000 })).toBe('notfound');
    });
});

describe('liveFeedStalled', () => {
    const base = { now: 100000, startedAt: 100000, lastFrameAt: 0, lastBufferGrowthAt: 0 };

    it('stream que nunca subiu: espera o tempo de partida', () => {
        expect(liveFeedStalled({ ...base, now: base.startedAt + LIVE_START_TIMEOUT_MS - 1 })).toBe(false);
        expect(liveFeedStalled({ ...base, now: base.startedAt + LIVE_START_TIMEOUT_MS })).toBe(true);
    });

    it('tocando e entregando: não troca', () => {
        expect(liveFeedStalled({ ...base, now: 200000, lastFrameAt: 199000, lastBufferGrowthAt: 195000 })).toBe(false);
    });

    it('buffer ainda crescendo segura a troca mesmo com o quadro parado', () => {
        expect(liveFeedStalled({ ...base, now: 200000, lastFrameAt: 180000, lastBufferGrowthAt: 199000 })).toBe(false);
    });

    it('sem quadro e sem buffer por LIVE_STALL_MS: troca', () => {
        const last = 200000 - LIVE_STALL_MS;
        expect(liveFeedStalled({ ...base, now: 200000, lastFrameAt: last, lastBufferGrowthAt: last - 500 })).toBe(true);
    });
});

describe('liveBufferDying', () => {
    const agora = 200000;

    it('buffer cheio e parado é o hls.js esperando, não falha', () => {
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: agora - 30000, bufferAheadS: 25 })).toBe(false);
    });

    it('buffer baixo mas recebendo: segue', () => {
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: agora - 1000, bufferAheadS: 3 })).toBe(false);
    });

    it('baixo E sem nada novo há LIVE_BUFFER_DRY_MS: avisa antes de congelar', () => {
        const seco = agora - LIVE_BUFFER_DRY_MS;
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: seco + 1, bufferAheadS: LIVE_BUFFER_LOW_S - 1 })).toBe(false);
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: seco, bufferAheadS: LIVE_BUFFER_LOW_S - 1 })).toBe(true);
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: seco, bufferAheadS: LIVE_BUFFER_LOW_S })).toBe(false);
    });

    it('fonte que nunca subiu fica com o liveFeedStalled', () => {
        expect(liveBufferDying({ now: agora, lastBufferGrowthAt: 0, bufferAheadS: 0 })).toBe(false);
    });
});
