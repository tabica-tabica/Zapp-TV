// Filtro de conteúdo pro perfil Kids (parental lite): esconde categorias
// adultas por heurística de nome. Sem TMDB — funciona offline e cobre o caso
// real de listas IPTV (categorias "ADULTOS", "XXX", "+18" etc.).

import { profileService } from './profileService';
import type { Category } from '../types';

// Cuidado com falsos positivos: /sex/ solto casaria "Sexta"/"Essex" e
// /\+?18\b/ casaria "2018" — padrões ancorados de propósito.
//
// /porn/i e /adult/i soltos (sem \b) eram um bug real: casariam "Pornochanchada"
// (documentário legítimo) e "Adult Swim"/"Vida Adulta" (conteúdo mainstream) como
// substring. Ancorados aqui do mesmo jeito que tools/m3u-transformer/adult.ts —
// mesmo achado, mesma calibração, duas cópias porque CLI e app são pacotes
// isolados sem import compartilhado. "adult" bare (sem o "o" final) e "adulta"
// (feminino) ficaram de fora: a convenção real de categoria é sempre a forma
// masculina "adulto"/"adultos".
const ADULT_PATTERNS = [
    /\bhentai\b/i,
    /\bxxx\b/i,
    /\bbrazzers\b/i,
    /\bbrasileirinhas\b/i,
    /\bpornhub\b/i,
    /\bxvideos\b/i,
    /\bxnxx\b/i,
    /\bredtube\b/i,
    /\bplayboy\b/i,
    /\bonlyfans\b/i,
    /\bbabestation\b/i,
    /\bmilf\b/i,
    /\bpornstar\b/i,
    /\bporn\b/i,
    /\berotic[oa]?s?\b/i,
    /\ber[óo]tic[oa]s?\b/i,
    /\badultos?\b(?![a-zà-ÿ])/i,
    /\b18\b|\+18|18\+/,
    /\bsex(o|y)?\b/i,
    /^\[x{2,3}\]/i,
];

export function isAdultCategoryName(name: string): boolean {
    return ADULT_PATTERNS.some(pattern => pattern.test(name));
}

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
