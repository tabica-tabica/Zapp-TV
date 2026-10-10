// Filtro de conteúdo pro perfil Kids (parental lite): esconde categorias
// adultas por heurística de nome. Sem TMDB — funciona offline e cobre o caso
// real de listas IPTV (categorias "ADULTOS", "XXX", "+18" etc.).

import { profileService } from './profileService';
import type { Category } from '../types';

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
     * Aplica o gate do perfil ativo: se kids, remove categorias adultas e os
     * itens delas. Perfil normal passa reto (sem custo).
     */
    apply<T extends { category_id: string }>(
        items: T[],
        categories: Category[]
    ): { items: T[]; categories: Category[] } {
        if (!this.isKidsActive()) return { items, categories };
        const blocked = this.getBlockedCategoryIds(categories);
        if (blocked.size === 0) return { items, categories };
        return {
            items: items.filter(item => !blocked.has(item.category_id)),
            categories: categories.filter(category => !blocked.has(category.category_id)),
        };
    },
};
