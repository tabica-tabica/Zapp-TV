import { describe, it, expect } from 'vitest';
import { posterThumb } from './tmdb';

describe('posterThumb', () => {
    it('troca o tamanho do TMDB por w342', () => {
        expect(posterThumb('https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg'))
            .toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    });
    it('deixa URL de outro host e vazio intactos', () => {
        expect(posterThumb('https://i.imgur.com/t/p/x/abc.jpg')).toBe('https://i.imgur.com/t/p/x/abc.jpg');
        expect(posterThumb(undefined)).toBeUndefined();
        expect(posterThumb('')).toBe('');
    });
});
