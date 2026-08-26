// Detecção de conteúdo adulto — calibrado contra a lista real
// (.agents/tv_channels.m3u, 425 mil linhas), mesmo corpus que calibrou classify.ts.
//
// \bporn\b (não /porn/i solto): a lista real tem "O País da Pornochanchada (2020...)",
// documentário legítimo sobre cinema brasileiro — "porn" solto casaria como substring
// de "Pornochanchada" sem fronteira de palavra. Achado real, não hipotético.
//
// \b é ASCII-only no JS: não trata acento como parte da palavra. "\badult\b" sozinho
// casaria dentro de "Adultério" (a fronteira falsa fica entre "t" e "é"). O lookahead
// negativo depois do grupo opcional evita isso sem precisar de um motor Unicode-aware.
//
// "adult"/"adulta" (bare, sem o "o" final) FICARAM DE FORA de propósito — achado real
// rodando contra a lista de calibração: "Adult Swim" (bloco de programação da Cartoon
// Network), "Adult Material"/"The Adults" (séries/filme legítimos) e "Vida Adulta"
// (filme/série real, sem group-title relacionado a adulto) todos casariam como falso
// positivo. A convenção real de categoria na lista é sempre a forma masculina
// "adulto"/"adultos" ("ADULTO 47", "Filmes Adultos") — nunca "adult" sozinho em inglês
// nem "adulta"/"adultas" no feminino.
//
// "playboy" e "erótico" ficaram, mesmo com falso positivo real conhecido e aceito:
// "Um Playboy em Apuros (1994)" usa "playboy" como substantivo comum (mulherengo), não
// como a marca; "Henry e June - Delírios Eróticos (1990)" é um drama biográfico
// mainstream (indicado ao Oscar de fotografia) que usa "eróticos" como descrição de
// gênero. A troca é deliberada: aqui (CLI) um falso positivo só arquiva o título na
// categoria errada — ainda assistível; mas a MESMA lista alimenta o bloqueio por PIN no
// app (ver src/services/kidsFilter.ts), onde um falso NEGATIVO deixaria conteúdo adulto
// de verdade passar batido pelo portão. Errar pro lado de mais recall vale a pena aqui.
const ADULT_PATTERNS: RegExp[] = [
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
    /\b18\+|\+18\b/,
    // Convenção real de 566 canais na lista de calibração: "[XX] Dorcel TV",
    // "[XX] Sexy Hot", "[XX] PentHouse Black" etc. — todos já caem também via
    // group-title "Canais | Adultos", mas o prefixo é sinal extra pra listas
    // que não seguem essa mesma convenção de categoria.
    /^\[x{2,3}\]/i,
];

export function isAdultContent(title: string, groupTitle?: string): boolean {
    const haystack = `${title} ${groupTitle || ''}`;
    return ADULT_PATTERNS.some(pattern => pattern.test(haystack));
}

export const ADULT_GROUP_TITLE = '🔞 Adulto';
