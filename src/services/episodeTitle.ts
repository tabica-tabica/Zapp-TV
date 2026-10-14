import type { Episode } from '../types';

// Título do episódio sem o "Nome da Série - S01E01" que o provedor costuma
// pôr na frente; sem nada que sobre, "Episódio N".
export function getEpisodeTitle(ep: Pick<Episode, 'title' | 'episode_num'>): string {
    const epNum = Number(ep.episode_num);
    const rawTitle = ep.title || '';

    const cleanTitle = rawTitle
        // Hífen comum também no fim: " Série - S01E01 - " deixava um "-" como título (visto na TV, 14/10/2026)
        .replace(/^(.*?)[\s\-–—]*S\d+[\s:.]*E\d+[\s:.\-–—]*/i, '')
        .replace(/\s*(?:\[|\()?S\d+[\s.-]*E\d+(?:\]|\))?\s*/gi, '')
        .replace(/Episode\s*\d+/gi, '')
        .replace(/^\d+\.?\s*/, '')
        .trim();

    const genericPatterns = [
        /^ep\s*\d+$/i,
        /^\d+$/,
        /^episode$/i
    ];
    const isValidTitle = cleanTitle.length > 0 && !genericPatterns.some(p => p.test(cleanTitle));

    return isValidTitle ? cleanTitle : `Episódio ${epNum}`;
}
