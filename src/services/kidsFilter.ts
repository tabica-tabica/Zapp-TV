// Filtro de conteúdo pro perfil Kids. Sem TMDB — funciona offline, pelo
// nome. Antes só tirava categoria adulta e o resto passava (novela, jornal,
// filme de terror). Desde 14/10/2026 é lista FECHADA: ao vivo só canal de
// marca infantil conhecida (channelGroups.isKidsBrandChannel) e, em filmes e
// séries, só categoria infantil ("Infantil", "Kids", "Desenhos"). Animação
// solta fica de fora: tem animação adulta e anime.

import { profileService } from './profileService';
import { isKidsBrandChannel, isKidsCategory } from './channelGroups';
import { normalizeSearch } from './catalogExtras';
import type { Category } from '../types';

/** Categoria de filme/série que o perfil Kids vê. */
export function isKidsVodCategory(categoryName: string): boolean {
    return !isAdultCategoryName(categoryName) &&
        (isKidsCategory(categoryName) || normalizeSearch(categoryName).indexOf('desenho') >= 0);
}

export { isAdultCategoryName } from './adultNames';
import { isAdultCategoryName } from './adultNames';

export const kidsFilter = {
    isKidsActive(): boolean {
        return !!profileService.getActiveProfile()?.isKids;
    },

    /** Ids das categorias bloqueadas pra kids (sempre calculável; só APLICAR quando kids). */
    getBlockedCategoryIds(categories: Category[]): Set<string> {
        const blocked = new Set<string>();
        for (const category of categories) {
            if (isAdultCategoryName(category.category_name || '')) {
                blocked.add(category.category_id);
            }
        }
        return blocked;
    },

    /**
     * Aplica o gate do perfil ativo. Kids: ao vivo só canal de marca
     * infantil; filme/série só de categoria infantil; categoria sem nada
     * permitido some do menu. Perfil normal passa reto (sem custo).
     */
    apply<T extends { category_id: string; name?: string }>(
        items: T[],
        categories: Category[],
        kind: 'live' | 'vod',
    ): { items: T[]; categories: Category[] } {
        if (!this.isKidsActive()) return { items, categories };
        const blocked = this.getBlockedCategoryIds(categories);
        let permitidos: T[];
        if (kind === 'live') {
            permitidos = items.filter(item => !blocked.has(item.category_id) && isKidsBrandChannel(item.name || ''));
        } else {
            const infantis = new Set(categories.filter(c => isKidsVodCategory(c.category_name || '')).map(c => c.category_id));
            permitidos = items.filter(item => infantis.has(item.category_id));
        }
        const comItens = new Set(permitidos.map(item => item.category_id));
        return { items: permitidos, categories: categories.filter(category => comItens.has(category.category_id)) };
    },
};
