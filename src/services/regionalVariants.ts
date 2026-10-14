/**
 * Detecção de "afiliadas"/praças regionais do mesmo canal (ex.: "RedeTV!
 * Paraná", "RedeTV! Guará", "RedeTV! Imperial" são a mesma marca, feeds
 * diferentes) — pra o usuário escolher quais quer ver, em vez do provedor
 * mostrar todas de uma vez. Heurística sobre o NOME já sem tag de qualidade
 * (reaproveita channelDisplayName): um canal com uma palavra extra no fim só
 * vira variante regional de um "canal-mãe" que EXISTE DE VERDADE no catálogo
 * com o nome sem essa palavra — nunca de um prefixo genérico inventado.
 *
 * Calibrado contra um catálogo de provedor real (~3 mil canais) nesta sessão,
 * em duas rodadas:
 * (1) exigir o canal-mãe de verdade é o que distingue "RedeTV!" + "RedeTV!
 *     Guará" (façanha regional legítima, "RedeTV!" sozinho existe no
 *     catálogo) de "Urban Sports"/"Urban Movies"/"Urban Kids" ou "GE Fast"/
 *     "GE TV" — marca + gênero, não regional, onde nem "Urban" nem "GE"
 *     sozinhos são canais de verdade;
 * (2) mesmo com o canal-mãe exigido, "Woohoo" (canal de verdade, sozinho) +
 *     "Woohoo Esportes" (canal DIFERENTE, não uma praça de "Woohoo") ainda
 *     colidia, porque a última palavra ("Esportes") é um GÊNERO, não uma
 *     praça — daí a lista de gêneros abaixo, que bloqueia esse tipo de
 *     sufixo mesmo quando o canal-mãe existe.
 */

import { channelDisplayName } from './channelVariants';
import { normalizeSearch } from './catalogExtras';

export interface RegionalChannel {
    stream_id: number | string;
    name: string;
}

const ROMAN_OR_ORDINAL = new Set([
    'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii',
]);

/**
 * Palavras de GÊNERO/categoria de conteúdo, não de praça — quando um
 * "multiplex" de marca (ex.: "Woohoo", "Urban", "Hallo!") tem uma variante
 * temática ("Woohoo Esportes", "Urban Kids", "Hallo! Anime"), essa última
 * palavra nunca é sinal de afiliada regional, mesmo que o canal-mãe exista.
 * Lista em PT-BR e EN — provedores IPTV misturam os dois livremente.
 */
const GENRE_OR_CATEGORY_WORDS = new Set([
    'esportes', 'esporte', 'sports', 'sport',
    'kids', 'infantil',
    'movies', 'movie', 'filmes', 'filme', 'cinema',
    'series', 'séries', 'seriados',
    'news', 'noticias', 'notícias',
    'music', 'música', 'musica',
    'documentary', 'documentario', 'documentário', 'documentation', 'docs', 'doc',
    'retro', 'classic', 'classicos', 'clássicos',
    'dorama', 'doramas', 'anime', 'animes', 'otaku',
    'action', 'ação', 'acao', 'comedy', 'comedia', 'comédia',
    'drama', 'terror', 'horror', 'suspense', 'romance',
    'novelas', 'novela', 'variedades', 'gospel', 'religioso',
    'fast', 'plus', 'premium', 'max', 'extra',
    // Edição/idioma/público — mesma categoria de "não é praça": "CNN Brasil
    // Money" não é uma afiliada regional de "CNN Brasil", é o canal de
    // economia da mesma marca.
    'money', 'internacional', 'international', 'nacional',
    'latino', 'latina', 'espanhol', 'spanish', 'italiano', 'italian',
    // Público: "Nick Jr." e "Nick Jr. Club" não são praças de "Nick" — o
    // dedup escondia o Nick Jr. da grade (e do perfil Kids). 14/10/2026.
    'jr', 'junior', 'júnior', 'club', 'teen',
]);

/**
 * Número, algarismo romano curto, letra única (com ou sem parênteses), ou
 * palavra de gênero/categoria — "2", "III", "(A)", "B", "Esportes". Nenhum
 * desses distingue afiliada regional: são índice de canal irmão ("ESPN 2"),
 * rótulo de servidor espelhado ("DAZN 3 (A)"/"(B)" — padrão comum de
 * provedor IPTV pra redundância, mesmo conteúdo em dois links), ou variante
 * temática de um multiplex de marca ("Woohoo Esportes").
 */
function isNeverRegionalSuffix(word: string): boolean {
    const w = word.toLowerCase().replace(/[.,()[\]]/g, '');
    if (/^\d+$/.test(w)) return true;
    if (/^[a-z]$/.test(w)) return true;
    if (ROMAN_OR_ORDINAL.has(w)) return true;
    return GENRE_OR_CATEGORY_WORDS.has(w);
}

/**
 * Agrupa canais em famílias de "mesma marca, praça diferente". Só entram no
 * mapa de retorno famílias com 2+ membros — canal sem par, ou sem um
 * canal-mãe de verdade no catálogo, nunca aparece. Famílias aninhadas
 * ("RecordTV" é mãe de "RecordTV Bahia", que por sua vez é mãe de "RecordTV
 * Bahia Itabuna") são achatadas numa família só, pela marca raiz — sem isso
 * o mesmo canal-mãe aparecia espalhado em duas telas de escolha separadas.
 */
export function detectRegionalFamilies<T extends RegionalChannel>(channels: T[]): Map<string, T[]> {
    // Nome (já sem tag de qualidade, minúsculo) -> canal. Usado pra achar o
    // canal-mãe de verdade de cada candidato a variante.
    const byBareName = new Map<string, T>();
    const wordsByChannel = new Map<T, string[]>();
    for (const channel of channels) {
        const words = channelDisplayName(channel.name).trim().split(/\s+/).filter(Boolean);
        wordsByChannel.set(channel, words);
        const bare = words.join(' ').toLowerCase();
        if (bare && !byBareName.has(bare)) byBareName.set(bare, channel);
    }

    const families = new Map<string, T[]>();
    for (const channel of channels) {
        const words = wordsByChannel.get(channel);
        if (!words || words.length < 2) continue; // sem palavra extra pra tirar
        const lastWord = words[words.length - 1];
        if (isNeverRegionalSuffix(lastWord)) continue;
        const prefix = words.slice(0, -1).join(' ').toLowerCase();
        const canalMae = byBareName.get(prefix);
        if (!canalMae || canalMae === channel) continue;
        const list = families.get(prefix);
        if (list) {
            if (!list.includes(channel)) list.push(channel);
        } else {
            families.set(prefix, [canalMae, channel]);
        }
    }

    // Achata famílias aninhadas: se a CHAVE de uma família (o nome do
    // canal-mãe dela) aparece como MEMBRO comum de outra família, essa
    // família inteira entra na outra — uma tela de escolha por marca raiz,
    // não uma cascata (RecordTV → RecordTV Bahia → RecordTV Bahia Itabuna
    // viram só "RecordTV" com todas as praças lado a lado).
    const bareNameOf = (channel: T): string => (wordsByChannel.get(channel) || []).join(' ').toLowerCase();
    let mudou = true;
    while (mudou) {
        mudou = false;
        for (const [key, members] of families) {
            for (const [outraKey, outrosMembros] of families) {
                if (outraKey === key) continue;
                if (outrosMembros.some(m => bareNameOf(m) === key)) {
                    for (const membro of members) {
                        if (!outrosMembros.includes(membro)) outrosMembros.push(membro);
                    }
                    families.delete(key);
                    mudou = true;
                    break;
                }
            }
            if (mudou) break; // o Map mudou — reinicia a varredura
        }
    }

    return families;
}

/**
 * Redes de TV aberta nacionais (Globo, SBT, RecordTV, Band, "Canais |
 * Abertos") onde a heurística de NOME acima nunca forma família: não existe
 * um "canal-mãe" nu no catálogo (nenhum provedor oferece "Globo" sozinho, só
 * as praças — "Globo SP", "EPTV Campinas", "RBS TV Porto Alegre"...), e boa
 * parte dos nomes de praça tem 2+ palavras extras (cidade + estado), o que a
 * regra "só a ÚLTIMA palavra pode ser praça" não cobre. Resultado real:
 * ~183 canais em "Canais | Globo" sozinhos, quase nenhum agrupado.
 *
 * Como toda a CATEGORIA já É a rede (cada entrada é uma praça/afiliada), a
 * categoria inteira vira 1 família — mesmo default "só a primeira aparece" e
 * mesma tela de Configurações que já existe pra praças por nome, só que
 * chaveada por categoria (`cat:<id>`) em vez de por nome de canal.
 *
 * PADRÕES genéricos (substring, sem acento/maiúsculo) contra o NOME da
 * categoria da playlist ativa — não uma lista fixa de IDs, pelo mesmo motivo
 * de curatedHiddenGroups.ts: cada provedor nomeia as categorias do seu jeito.
 */
export const NETWORK_CATEGORY_PATTERNS = ['abertos', 'sbt', 'record', 'band', 'globo'];

export interface RegionalCategory {
    category_id: string;
}

/**
 * Uma família por categoria de rede detectada, com TODOS os canais daquela
 * categoria como membros. Só entram categorias com 2+ canais (categoria com 1
 * canal só não tem o que escolher).
 */
export function detectCategoryFamilies<T extends RegionalChannel & RegionalCategory>(
    channels: T[],
    categories: Array<{ category_id: string; category_name: string }>,
): Map<string, T[]> {
    const networkCategoryIds = new Set<string>();
    for (const category of categories) {
        const normalized = normalizeSearch(category.category_name || '');
        if (NETWORK_CATEGORY_PATTERNS.some(p => normalized.includes(p))) {
            networkCategoryIds.add(category.category_id);
        }
    }
    if (networkCategoryIds.size === 0) return new Map();

    const byCategory = new Map<string, T[]>();
    for (const channel of channels) {
        if (!networkCategoryIds.has(channel.category_id)) continue;
        const list = byCategory.get(channel.category_id);
        if (list) list.push(channel);
        else byCategory.set(channel.category_id, [channel]);
    }

    const families = new Map<string, T[]>();
    for (const [categoryId, members] of byCategory) {
        if (members.length < 2) continue;
        families.set(`cat:${categoryId}`, members);
    }
    return families;
}
