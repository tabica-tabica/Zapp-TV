// Detecção de conteúdo adulto pelo NOME (categoria ou item). Módulo PURO:
// sem storage, sem rede — usado pelo filtro Kids, pelo cadeado parental e pelo
// gênero "Adulto" do catálogo (catalogGenres, que também é puro).

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

const HENTAI = /\bhentai\b/i;

export function isHentaiName(name: string): boolean {
    return HENTAI.test(name);
}

/** Tira os títulos de categoria hentai OU com "hentai" no nome. */
export function semHentai<T extends { category_id: string; name?: string }>(
    itens: T[],
    categorias: Array<{ category_id: string; category_name: string }>,
): T[] {
    const ocultas = new Set(categorias.filter(c => isHentaiName(c.category_name || '')).map(c => c.category_id));
    return itens.filter(item => !ocultas.has(item.category_id) && !isHentaiName(item.name || ''));
}
