import { describe, it, expect } from 'vitest';
import { logoFalhou, logoEmEspera } from './logoFalho';

describe('logoFalho', () => {
    it('logo que falhou não é pedida de novo por 30 min, depois volta', () => {
        logoFalhou('https://x/a.png', 0);
        expect(logoEmEspera('https://x/a.png', 29 * 60 * 1000)).toBe(true);
        expect(logoEmEspera('https://x/a.png', 31 * 60 * 1000)).toBe(false);
        expect(logoEmEspera('https://x/b.png', 0)).toBe(false);
    });
});
