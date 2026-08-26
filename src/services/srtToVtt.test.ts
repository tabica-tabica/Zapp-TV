// Conversão SRT→VTT: primeiro teste de legenda no repo. Fixture real (números
// de sequência, timestamp com vírgula, texto multi-linha, \r\n de uma baixa
// real) — não tenta cobrir todo caso de SRT malformado, só o que o <track>
// nativo do navegador realmente precisa pra desenhar os cues.

import { describe, it, expect } from 'vitest';
import { srtToVtt } from './srtToVtt';

describe('srtToVtt', () => {
    it('converte timestamps, remove \\r e adiciona o cabeçalho WEBVTT', () => {
        const srt = [
            '1',
            '00:00:01,000 --> 00:00:03,500',
            'Olá, mundo.',
            '',
            '2',
            '00:00:04,250 --> 00:00:06,000',
            'Segunda linha',
            'com quebra.',
            '',
        ].join('\r\n');

        const expected = [
            'WEBVTT',
            '',
            '1',
            '00:00:01.000 --> 00:00:03.500',
            'Olá, mundo.',
            '',
            '2',
            '00:00:04.250 --> 00:00:06.000',
            'Segunda linha',
            'com quebra.',
        ].join('\n') + '\n';

        expect(srtToVtt(srt)).toBe(expected);
    });

    it('preserva tags de estilo (<i>, <b>) sem alteração', () => {
        const srt = '1\n00:00:00,500 --> 00:00:02,000\n<i>Legenda em itálico</i>\n';
        expect(srtToVtt(srt)).toBe('WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.000\n<i>Legenda em itálico</i>\n');
    });
});
