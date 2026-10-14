// Grupos de canais da TV ao Vivo: Jogos (modo próprio, fora da grade
// normal), Notícias e Infantil (filtros da barra) e a lista fechada do
// perfil Kids.
//
// Pela CATEGORIA, não pelo nome do canal: no catálogo real (44 categorias,
// 2961 canais, 14/10/2026) o provedor já separa esporte, notícias e infantil
// em categorias limpas, e padrões de nome de canal só acrescentavam falso
// positivo ("Universal Premiere HD" é filme). A exceção é o perfil Kids: lá
// vale só marca infantil conhecida, pelo começo do nome — a categoria
// Infantil também tem canal que ninguém conferiu (Box Kids, DumDum...), e
// "[24hs] Nick Classico" é maratona, não o canal.
//
// Módulo PURO: sem storage, sem rede.

import { normalizeSearch } from './catalogExtras';
import { isAdultCategoryName } from './adultNames';

interface CanalDaGrade { name: string; category_id: string }

// "max" e "nba" com fronteira: "Cinemax"/"Maxx" não são o MAX de eventos
const ESPORTE_CATEGORIA = /esporte|sport|futebol|football|dazn|premiere|espn|combate|jogos de hoje|disney\+|\bmax\b|paramount|brasileir|\bufc\b|\bnba\b|formula|estaduais|prime video/;
const NOTICIAS_CATEGORIA = /noticia|\bnews\b|jornalismo/;
const INFANTIL_CATEGORIA = /infantil|\bkids\b|crianca/;

// Só marca infantil conhecida (pedido: "se não tiver certeza, não põe").
// Ancorado no começo: "Nick Jr. FHD" entra, "[24hs] Nick Teen" não.
const MARCA_INFANTIL = /^(cartoon network|cartoonito|boomerang|discovery kids|gloob|gloobinho|nick|nick jr|nickelodeon|disney channel|disney junior|disney jr|tv ra tim bum|tooncast)\b/;

export function isSportsCategory(categoryName: string): boolean {
    return ESPORTE_CATEGORIA.test(normalizeSearch(categoryName || ''));
}

export function isNewsCategory(categoryName: string): boolean {
    return NOTICIAS_CATEGORIA.test(normalizeSearch(categoryName || ''));
}

export function isKidsCategory(categoryName: string): boolean {
    return INFANTIL_CATEGORIA.test(normalizeSearch(categoryName || ''));
}

/** Canal permitido no perfil Kids: marca infantil conhecida. */
export function isKidsBrandChannel(name: string): boolean {
    return MARCA_INFANTIL.test(normalizeSearch(name || ''));
}

/** O canal "Jogos de Hoje" abre a lista do modo Jogos. */
export function isJogosDeHojeChannel(name: string): boolean {
    return normalizeSearch(name || '') === 'jogos de hoje';
}

/** Ids das categorias que batem em `teste`. */
export function categoriasQue(
    categories: ReadonlyArray<{ category_id: string; category_name: string }>,
    teste: (categoryName: string) => boolean,
): Set<string> {
    return new Set(categories.filter(c => teste(c.category_name || '')).map(c => c.category_id));
}

/** Canal adulto: de categoria adulta OU de nome adulto ("[XX] ADULTO 23" fora da categoria) */
export function canalAdulto(canal: CanalDaGrade, categoriasAdultas: Set<string>): boolean {
    return categoriasAdultas.has(canal.category_id) || isAdultCategoryName(canal.name || '');
}

export type ModoDaGrade = 'normal' | 'adulto' | 'jogos';

/** Em que modo da grade o canal aparece: adulto ganha de esporte. */
export function modoDoCanal(canal: CanalDaGrade, categoriasAdultas: Set<string>, categoriasDeEsporte: Set<string>): ModoDaGrade {
    if (canalAdulto(canal, categoriasAdultas)) return 'adulto';
    if (categoriasDeEsporte.has(canal.category_id) || isJogosDeHojeChannel(canal.name)) return 'jogos';
    return 'normal';
}

/** Canais do modo; no Jogos, o "Jogos de Hoje" abre a lista. */
export function canaisDoModo<T extends CanalDaGrade>(canais: T[], modo: ModoDaGrade, categoriasAdultas: Set<string>, categoriasDeEsporte: Set<string>): T[] {
    const lista = canais.filter(s => modoDoCanal(s, categoriasAdultas, categoriasDeEsporte) === modo);
    if (modo !== 'jogos') return lista;
    const primeiro = lista.filter(s => isJogosDeHojeChannel(s.name));
    return primeiro.length ? [...primeiro, ...lista.filter(s => !isJogosDeHojeChannel(s.name))] : lista;
}
