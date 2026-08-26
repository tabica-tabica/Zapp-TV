// Cliente da API do OpenSubtitles.com — mesmo modelo do tmdb.ts: chave
// própria do usuário, cache em dois níveis (memória + localStorage), nunca
// lança pro chamador (retorna null/[] em qualquer falha).

import { storage } from './storage';
import { srtToVtt } from './srtToVtt';

const OS_BASE_URL = 'https://api.opensubtitles.com/api/v1';

// Resultado de busca muda mais rápido que metadado de filme (releases novas
// aparecem toda semana) — TTL bem mais curto que os 7 dias do TMDB.
const CACHE_EXPIRY_HOURS = 24;
const MAX_CACHE_ENTRIES = 60;
const SAVE_DEBOUNCE_MS = 1500;
const CACHE_KEYS = { SEARCH: 'opensubtitles_search_v1' };

// Margem antes do JWT expirar (~24h de vida) pra nunca usar um token que
// vence no meio de uma requisição.
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

export interface SubtitleSearchQuery {
    imdbId?: string;
    title: string;
    year?: string;
    season?: number;
    episode?: number;
    /** ISO 639-1, separado por vírgula (ex.: "pt,en") */
    languages: string;
}

export interface SubtitleResult {
    fileId: number;
    release: string;
    lang: string;
    downloadCount: number;
}

interface SubtitleDownload {
    url: string;
    fileName: string;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}
type CacheStore<T> = Record<string, CacheEntry<T>>;

const memoryCache: { search: CacheStore<SubtitleResult[]> } = { search: {} };

function loadCacheFromStorage<T>(key: string): CacheStore<T> {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

function saveCacheToStorage<T>(key: string, cache: CacheStore<T>): void {
    try {
        const cleaned: CacheStore<T> = {};
        const now = Date.now();
        const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        for (const [k, entry] of Object.entries(cache)) {
            if (now - entry.timestamp < expiryMs) cleaned[k] = entry;
        }
        localStorage.setItem(key, JSON.stringify(cleaned));
    } catch {
        // quota/modo privado — cache é descartável, a busca segue sem ele
    }
}

function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
    return Date.now() - entry.timestamp < expiryMs;
}

function getCached<T>(store: CacheStore<T>, key: string): T | null {
    const entry = store[key];
    return isCacheValid(entry) ? entry.data : null;
}

function pruneStore<T>(store: CacheStore<T>, max = MAX_CACHE_ENTRIES): void {
    const chaves = Object.keys(store);
    if (chaves.length <= max) return;
    chaves
        .sort((a, b) => (store[b]?.timestamp || 0) - (store[a]?.timestamp || 0))
        .slice(max)
        .forEach(chave => { delete store[chave]; });
}

const saveTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

function setCache<T>(store: CacheStore<T>, key: string, data: T, storageKey: string): void {
    store[key] = { data, timestamp: Date.now() };
    pruneStore(store);
    if (saveTimers[storageKey]) clearTimeout(saveTimers[storageKey]);
    saveTimers[storageKey] = setTimeout(() => {
        saveTimers[storageKey] = undefined;
        saveCacheToStorage(storageKey, store);
    }, SAVE_DEBOUNCE_MS);
}

memoryCache.search = loadCacheFromStorage(CACHE_KEYS.SEARCH);

function getApiKey(): string {
    return storage.getOpenSubtitlesApiKey();
}

/**
 * JWT de login (eleva a cota diária de download) — reusa o token salvo
 * enquanto válido; sem credenciais configuradas, fica no tier anônimo.
 * Login que falha (senha errada, rede fora) não lança: cai pro anônimo em
 * silêncio, já que o erro de credencial é assunto pra aparecer em
 * Configurações, não pra travar o menu de legendas do player.
 */
async function ensureToken(apiKey: string): Promise<string | null> {
    const credentials = storage.getOpenSubtitlesCredentials();
    if (!credentials) return null;

    const cached = storage.getOpenSubtitlesToken();
    if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
        return cached.token;
    }

    try {
        const response = await fetch(`${OS_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
        });
        if (!response.ok) return null;
        const json = await response.json();
        const token = json?.token;
        if (!token || typeof token !== 'string') return null;
        storage.saveOpenSubtitlesToken(token, Date.now() + TOKEN_TTL_MS);
        return token;
    } catch {
        return null;
    }
}

function buildHeaders(apiKey: string, token: string | null): Record<string, string> {
    const headers: Record<string, string> = { 'Api-Key': apiKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function searchCacheKey(query: SubtitleSearchQuery): string {
    const identity = query.imdbId || query.title.toLowerCase().trim();
    return `${identity}:${query.year || ''}:${query.season ?? ''}:${query.episode ?? ''}:${query.languages}`;
}

export async function searchSubtitles(query: SubtitleSearchQuery): Promise<SubtitleResult[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const cacheKey = searchCacheKey(query);
    const cached = getCached(memoryCache.search, cacheKey);
    if (cached !== null) return cached;

    try {
        const token = await ensureToken(apiKey);
        const url = new URL(`${OS_BASE_URL}/subtitles`);
        if (query.imdbId) {
            url.searchParams.set('imdb_id', query.imdbId.replace(/^tt/i, ''));
        } else {
            url.searchParams.set('query', query.title);
            // Ano da temporada raramente bate com o do episódio — só filtra
            // por ano quando NÃO é uma busca de episódio.
            if (query.year && query.season == null) url.searchParams.set('year', query.year);
        }
        if (query.season != null) url.searchParams.set('season_number', String(query.season));
        if (query.episode != null) url.searchParams.set('episode_number', String(query.episode));
        url.searchParams.set('languages', query.languages);

        const response = await fetch(url.toString(), { headers: buildHeaders(apiKey, token) });
        if (!response.ok) return [];
        const json = await response.json();

        const results: SubtitleResult[] = (json?.data || [])
            .map((item: { attributes?: { release?: string; language?: string; download_count?: number; files?: Array<{ file_id?: number }> } }) => {
                const fileId = item.attributes?.files?.[0]?.file_id;
                if (typeof fileId !== 'number') return null;
                return {
                    fileId,
                    release: item.attributes?.release || 'Legenda',
                    lang: item.attributes?.language || query.languages.split(',')[0],
                    downloadCount: item.attributes?.download_count || 0,
                };
            })
            .filter((r: SubtitleResult | null): r is SubtitleResult => r !== null)
            .sort((a: SubtitleResult, b: SubtitleResult) => b.downloadCount - a.downloadCount);

        setCache(memoryCache.search, cacheKey, results, CACHE_KEYS.SEARCH);
        return results;
    } catch {
        return [];
    }
}

/**
 * Consome 1 unidade da cota diária — só deve ser chamado quando o usuário
 * efetivamente seleciona uma legenda no menu, nunca de forma especulativa.
 * A URL retornada expira rápido; por isso NUNCA é cacheada (diferente da
 * busca, que é cacheável sem custo de cota).
 */
async function downloadSubtitle(fileId: number): Promise<SubtitleDownload | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        const token = await ensureToken(apiKey);
        const response = await fetch(`${OS_BASE_URL}/download`, {
            method: 'POST',
            headers: buildHeaders(apiKey, token),
            body: JSON.stringify({ file_id: fileId }),
        });
        if (!response.ok) return null;
        const json = await response.json();
        if (!json?.link) return null;
        return { url: json.link, fileName: json.file_name || 'subtitle.srt' };
    } catch {
        return null;
    }
}

/** Conveniência única pro player: baixa, converte SRT→VTT, uma chamada só. */
export async function resolveSubtitleTrack(fileId: number): Promise<{ vtt: string; fileName: string } | null> {
    const download = await downloadSubtitle(fileId);
    if (!download) return null;
    try {
        const response = await fetch(download.url);
        if (!response.ok) return null;
        const text = await response.text();
        return { vtt: srtToVtt(text), fileName: download.fileName };
    } catch {
        return null;
    }
}
