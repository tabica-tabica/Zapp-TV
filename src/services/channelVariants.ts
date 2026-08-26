/**
 * Agrupador de variantes FHD/HD/SD (port do NeoStream desktop): "ESPN FHD",
 * "ESPN HD" e "ESPN SD" viram UM card na TV ao vivo — a melhor qualidade
 * representa o grupo e as demais aparecem como botões de qualidade na ficha.
 * Tudo PURO: nada de rede/estado, só o nome dos canais.
 */

export interface VariantChannel {
    stream_id: number | string;
    name: string;
    stream_icon?: string;
}

const QUALITY_ORDER = ['4k', 'uhd', 'fhd', 'hd', 'sd'];

// Regexes pré-compiladas: com 10k canais isso roda dezenas de milhares de
// vezes por filtro — compilar dentro da função travava TVs antigas.
const QUALITY_REGEXES = QUALITY_ORDER.map(q => new RegExp(`(^|[^a-z0-9])${q}([^a-z0-9]|$)`));

/** Nota de qualidade pelo nome (menor = melhor); sem tag fica entre HD e SD. */
export function qualityRank(name: string): number {
    const lower = name.toLowerCase();
    for (let i = 0; i < QUALITY_REGEXES.length; i++) {
        if (QUALITY_REGEXES[i].test(lower)) return i;
    }
    return 3.5;
}

const TRAILING_RUN_RE = /(?:\s+(?:fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc))+\s*$/i;

/**
 * Sufixo solto (sem parênteses) no fim da string: "ESPN FHD", "Canal Brasil
 * FHD H265", "Discovery Theater H265" (qualidade e codec podem vir juntos OU
 * sozinhos, em qualquer ordem — a regra consome a sequência inteira de uma
 * vez). Codec sozinho ("H265"/"HEVC" sem "FHD"/"HD" por perto) também corta:
 * calibrado contra um catálogo de provedor real nesta sessão — dezenas de
 * famílias de canal (Discovery Theater, HGTV, History, Cinemax, Lifetime,
 * ESPN 2-6...) usam "H265" solto como o PRÓPRIO rótulo de qualidade, sempre
 * pareado com uma variante irmã sem o sufixo. A CLI (tools/m3u-transformer,
 * ver classify.ts) já tratava assim, sem guarda nenhuma — este arquivo
 * divergia por excesso de cautela e estava perdendo o agrupamento certo.
 */
function stripTrailingRun(name: string): string {
    const match = TRAILING_RUN_RE.exec(name);
    return match ? name.slice(0, match.index) : name;
}

/**
 * Tira as tags de qualidade/codec do nome. Três regras, nessa ordem:
 * (a) parêntese/colchete cujo conteúdo é SÓ a tag ("ESPN (FHD)");
 * (c) parêntese/colchete FINAL da string cujo conteúdo TERMINA na tag depois
 *     de outro texto + separador ("GloboNews (Não especificado - FHD)") — o
 *     formato que o m3u-transformer gera. Âncora em `$` e captura preguiçosa
 *     de propósito: só mexe no último parêntese da string, então um nome como
 *     "Rede TV (SP)" (sem tag de qualidade) fica intocado;
 * (b) sufixo solto sem parênteses no fim — ver stripTrailingRun acima.
 */
// "[L]" (Legendado) e "(A)"/"(B)" (servidor espelhado — mesmo conteúdo em 2
// links, redundância de provedor) entram SÓ na 1ª regra (parêntese/colchete
// cujo conteúdo é SÓ a tag) — nunca na 2ª nem na TRAILING_RUN_RE. Calibrado
// contra um catálogo real: as 49 entradas de "Canais | Legendados" usam
// sempre "<Nome> <FHD|HD> [L]", e dezenas de famílias (Paramount+, Disney+,
// MAX, Prime Video, DAZN, NBA League Pass, times de futebol...) usam sempre
// "<Nome> <N> (A)" / "<Nome> <N> <FHD|HD|SD> (B)" — em ambos os casos a tag
// de qualidade (quando existe) vem ANTES do colchete/parêntese, nunca dentro
// dele, então basta remover "[L]"/"(A)"/"(B)" pra sobrar "<Nome> <N>
// <FHD|HD|SD>", que a TRAILING_RUN_RE (só tags de qualidade) já sabia cortar.
// 53 grupos novos verificados contra o catálogo real ao ligar "a"/"b" — zero
// falso-positivo (nenhum canal DIFERENTE colidiu; "Canal Goat 01"/"02"/"03"
// continuam grupos separados, só o (A)/(B) de cada NÚMERO se junta).
// "<Marca> HD <N>" (tag ANTES do número) — achado real em "Canais |
// Disney+": o servidor espelhado "A" numera "Disney+ HD 2"/"Disney+ HD 3"
// enquanto o servidor "B" numera "Disney+ 2"/"Disney+ 3 HD" (número ANTES da
// tag) — mesmo canal, ordem de palavra diferente entre os dois espelhos. Sem
// isso, os dois lados nunca batem a mesma raiz. Só entra quando a tag vem
// IMEDIATAMENTE antes de um número (não mexe em "Discovery Theater HD"
// sozinho, nem em qualquer outro caso da TRAILING_RUN_RE) — testado contra o
// catálogo real inteiro: 6 merges novos, todos "Disney+ N", zero colisão.
const MID_TAG_BEFORE_NUMBER_RE = /\b(?:fhd|hd|sd|4k|uhd)\s+(?=\d)/i;

function stripQualityTag(name: string, lowercase: boolean): string {
    const stripped = stripTrailingRun(
        name
            .replace(/\s*[[(](fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc|l|a|b)[\])]/gi, '')
            .replace(/\s*[[(][^[\]()]*?[\s\-:/](fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc)\s*[\])]\s*$/gi, '')
    )
        .replace(MID_TAG_BEFORE_NUMBER_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
    return lowercase ? stripped.toLowerCase() : stripped;
}

// Achado real: "TNT Séries FHD" (com acento) e "TNT Series H265" (sem
// acento) são o MESMO canal, só que um provedor grafou diferente — sem tirar
// o acento da CHAVE de agrupamento, "séries" ≠ "series" e os dois nunca
// batiam a mesma raiz (6 variantes de TNT Séries, incluindo as legendadas,
// ficavam espalhadas em cards soltos). Mesma técnica de normalizeSearch.ts
// (NFD + remove marca combinante), só na CHAVE — channelDisplayName (abaixo)
// preserva o acento original pra exibição, não mexe nisso.
function foldAccents(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Nome sem as tags de qualidade/codec, sem acento — é a chave que junta as variantes. */
export function variantBaseName(name: string): string {
    const base = stripQualityTag(name, true);
    // Nome que É só a tag ("FHD") não vira grupo de tudo — fica sozinho.
    return foldAccents(base || name.trim().toLowerCase());
}

/** Nome pra EXIBIÇÃO (preserva caixa) — sempre sem a tag, tenha o canal variante ou não. */
export function channelDisplayName(name: string): string {
    const base = stripQualityTag(name, false);
    return base || name.trim();
}

/**
 * true pro marcador "[L]" (Legendado) — convenção comum de provedor IPTV pra
 * sinalizar a versão com áudio original + legenda de um canal que também
 * existe dublado, lado a lado com a tag de qualidade ("HBO FHD [L]").
 * Também aceita a palavra solta "legendado"/"legendada" (grafia alternativa
 * de outro provedor, sem colchete). Roda sobre o nome CRU, não o já podado.
 */
export function isSubtitledVariant(name: string): boolean {
    return /\[l\]/i.test(name) || /\blegendad[oa]\b/i.test(name);
}

/**
 * "A"/"B" solto entre parênteses/colchetes — servidor espelhado (mesmo
 * conteúdo em 2 links, redundância de provedor: "Paramount+ 1 (A)" e
 * "Paramount+ 1 FHD (B)" são o MESMO canal, links diferentes). Retorna a
 * letra em maiúsculo, ou null se o nome não tem esse marcador.
 */
export function mirrorTag(name: string): string | null {
    const match = /[[(]([ab])[\])]/i.exec(name);
    return match ? match[1].toUpperCase() : null;
}

/** Rótulo curto da qualidade pro botão da ficha ("4K", "FHD", "HD", "SD"),
 *  com "Legendado" acrescentado quando a variante é a versão legendada, e
 *  o servidor espelhado (quando houver) junto — "FHD · B" diferencia de
 *  "FHD · A" no mesmo grupo; sem tag de qualidade nenhuma, o próprio
 *  servidor vira o rótulo ("Servidor A"). */
export function qualityLabel(name: string): string {
    const match = /(^|[^a-z0-9])(4k|uhd|fhd|hd|sd)([^a-z0-9]|$)/i.exec(name);
    const mirror = mirrorTag(name);

    let base: string;
    if (match) base = match[2].toUpperCase();
    else if (mirror) base = `Servidor ${mirror}`;
    else base = name.slice(0, 12);

    if (match && mirror) base += ` · ${mirror}`;
    if (isSubtitledVariant(name)) base += ' Legendado';
    return base;
}

/**
 * Agrupa preservando a ordem da lista (o grupo aparece onde a PRIMEIRA
 * variante apareceria); o representante é a melhor qualidade do grupo.
 * `variantsOf` só tem entradas pra grupos com 2+ variantes, chaveadas pelo
 * stream_id do representante.
 */
export function groupChannelVariants<T extends VariantChannel>(channels: T[]): { groups: T[]; variantsOf: Map<string, T[]> } {
    // Passada ÚNICA de variantBaseName por canal; Map preserva a ordem de
    // inserção, então iterar byBase.values() mantém a ordem da lista original.
    const byBase = new Map<string, T[]>();
    for (const channel of channels) {
        const base = variantBaseName(channel.name);
        const list = byBase.get(base);
        if (list) list.push(channel);
        else byBase.set(base, [channel]);
    }

    const groups: T[] = [];
    const variantsOf = new Map<string, T[]>();
    for (const list of byBase.values()) {
        if (list.length === 1) {
            groups.push(list[0]);
            continue;
        }
        // decorate-sort-undecorate: qualityRank 1x por item, não por comparação.
        // Legendado desempata DEPOIS da qualidade (nunca antes): dentro do
        // grupo "HBO"/"HBO FHD [L]"/"HBO HD", o representante (o que toca ao
        // clicar o card, sem abrir o menu) tem que continuar sendo a versão
        // dublada de melhor qualidade — legendado vira uma OPÇÃO no menu, não
        // o padrão silencioso, mesmo quando bate empate de qualidade com o
        // dublado. Só vira representante se o grupo inteiro for legendado.
        const sorted = list
            .map(channel => ({
                channel,
                subtitled: isSubtitledVariant(channel.name) ? 1 : 0,
                rank: qualityRank(channel.name),
            }))
            .sort((a, b) => a.subtitled - b.subtitled || a.rank - b.rank)
            .map(entry => entry.channel);
        // A melhor qualidade continua tocando por padrão e dá o stream_id do
        // grupo — mas o logo dela às vezes vem quebrado/placeholder (comum em
        // variantes FHD/H265 de provedor real). A variante de PIOR qualidade
        // do grupo (SD explícita, ou só a entrada sem tag nenhuma — caso comum
        // quando só a variante nova ganhou o sufixo FHD/H265) costuma ter o
        // logo/metadado original e confiável, então só ele empresta o ícone.
        const worstQualityVariant = sorted[sorted.length - 1];
        const representative = worstQualityVariant !== sorted[0]
            ? { ...sorted[0], stream_icon: worstQualityVariant.stream_icon }
            : sorted[0];
        groups.push(representative);
        variantsOf.set(String(representative.stream_id), sorted);
    }
    return { groups, variantsOf };
}
