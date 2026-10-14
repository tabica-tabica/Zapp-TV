import { describe, it, expect } from 'vitest';
import { getEpisodeTitle } from './episodeTitle';

describe('getEpisodeTitle', () => {
    it('sem título depois do SxxEyy com hífen no fim vira "Episódio N"', () => {
        expect(getEpisodeTitle({ title: ' Reformas Incríveis - S01E01 - ', episode_num: 1 })).toBe('Episódio 1');
    });
    it('mantém o título que vem depois do SxxEyy', () => {
        expect(getEpisodeTitle({ title: 'Série - S01E02 - O Piloto', episode_num: 2 })).toBe('O Piloto');
    });
});
