// Storage service for TV platforms (localStorage-based)

import type { Credentials } from '../types';
import { scopedKey } from './profileScope';
import { writeJson, writeRaw, removeKey } from './safeStorage';

export interface SavedContentItem {
    id: string;
    type: 'movie' | 'series' | 'channel';
    title: string;
    poster?: string;
    rating?: string;
    year?: string;
    /** container_extension pra reproduzir filme direto da lista */
    container?: string;
    addedAt: number;
}

export type FavoriteItem = SavedContentItem;
export type WatchLaterItem = SavedContentItem;

export type SavedContentInput = Omit<SavedContentItem, 'addedAt'>;

const STORAGE_KEYS = {
    CREDENTIALS: 'neostream_credentials',
    FAVORITES: 'neostream_favorites',
    WATCH_LATER: 'neostream_watch_later',
    LAST_CHANNEL: 'neostream_last_channel',
    SETTINGS: 'neostream_settings',
    TMDB_API_KEY: 'neostream_tmdb_api_key',
    OPENSUBTITLES_API_KEY: 'neostream_opensubtitles_api_key',
    OPENSUBTITLES_CREDENTIALS: 'neostream_opensubtitles_credentials',
    OPENSUBTITLES_TOKEN: 'neostream_opensubtitles_token',
    SUBTITLE_LANGUAGE: 'neostream_subtitle_language',
};

// Chaves de DADO do usuário: cada perfil tem as suas (item 54). Credencial,
// idioma e chave TMDB continuam globais — são do aparelho, não de quem assiste.
const favoritesKey = () => scopedKey(STORAGE_KEYS.FAVORITES);
const watchLaterKey = () => scopedKey(STORAGE_KEYS.WATCH_LATER);
const lastChannelKey = () => scopedKey(STORAGE_KEYS.LAST_CHANNEL);

interface Settings {
    language: 'pt' | 'en' | 'es';
    autoPlay: boolean;
    preferredQuality: 'auto' | '1080p' | '720p' | '480p';
}

const DEFAULT_SETTINGS: Settings = {
    language: 'pt',
    autoPlay: true,
    preferredQuality: 'auto',
};

class StorageService {
    // Credentials
    saveCredentials(credentials: Credentials): void {
        writeJson(STORAGE_KEYS.CREDENTIALS, credentials);
    }

    getCredentials(): Credentials | null {
        // Blindado: localStorage corrompido não pode derrubar o boot
        try {
            const data = localStorage.getItem(STORAGE_KEYS.CREDENTIALS);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    clearCredentials(): void {
        removeKey(STORAGE_KEYS.CREDENTIALS);
    }

    // Sanitiza listas salvas por versões antigas do app (o modal antigo
    // gravava só {id,type} — sem título o card renderizava vazio)
    private readContentList(key: string): SavedContentItem[] {
        try {
            const raw = localStorage.getItem(key);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return (parsed as Array<Partial<SavedContentItem>>)
                .filter(item => item && item.id != null && item.type != null)
                .map(item => ({
                    ...item,
                    id: String(item.id),
                    type: item.type as SavedContentItem['type'],
                    title: item.title || 'Sem título',
                    addedAt: item.addedAt || 0,
                }));
        } catch {
            return [];
        }
    }

    // Favorites (item completo; id pode colidir entre filme/série, então
    // toda operação é chaveada por id+type)
    getFavorites(): FavoriteItem[] {
        return this.readContentList(favoritesKey());
    }

    addFavorite(item: SavedContentInput): void {
        const favorites = this.getFavorites();
        if (!favorites.some(f => f.id === item.id && f.type === item.type)) {
            favorites.push({ ...item, addedAt: Date.now() });
            writeJson(favoritesKey(), favorites);
        }
    }

    removeFavorite(id: string, type: SavedContentItem['type']): void {
        const favorites = this.getFavorites().filter(f => !(f.id === id && f.type === type));
        writeJson(favoritesKey(), favorites);
    }

    isFavorite(id: string, type: SavedContentItem['type']): boolean {
        return this.getFavorites().some(f => f.id === id && f.type === type);
    }

    toggleFavorite(item: SavedContentInput): boolean {
        if (this.isFavorite(item.id, item.type)) {
            this.removeFavorite(item.id, item.type);
            return false;
        }
        this.addFavorite(item);
        return true;
    }

    clearFavorites(): void {
        writeJson(favoritesKey(), []);
    }

    // Watch Later (Minha Lista)
    getWatchLater(): WatchLaterItem[] {
        return this.readContentList(watchLaterKey());
    }

    addWatchLater(item: SavedContentInput): void {
        const items = this.getWatchLater();
        if (!items.some(i => i.id === item.id && i.type === item.type)) {
            items.push({ ...item, addedAt: Date.now() });
            writeJson(watchLaterKey(), items);
        }
    }

    removeWatchLater(id: string, type: SavedContentItem['type']): void {
        const items = this.getWatchLater().filter(i => !(i.id === id && i.type === type));
        writeJson(watchLaterKey(), items);
    }

    isInWatchLater(id: string, type: SavedContentItem['type']): boolean {
        return this.getWatchLater().some(i => i.id === id && i.type === type);
    }

    toggleWatchLater(item: SavedContentInput): boolean {
        if (this.isInWatchLater(item.id, item.type)) {
            this.removeWatchLater(item.id, item.type);
            return false;
        }
        this.addWatchLater(item);
        return true;
    }

    clearWatchLater(): void {
        writeJson(watchLaterKey(), []);
    }

    // Last channel
    setLastChannel(streamId: number): void {
        writeRaw(lastChannelKey(), String(streamId));
    }

    getLastChannel(): number | null {
        const data = localStorage.getItem(lastChannelKey());
        return data ? parseInt(data, 10) : null;
    }

    // Settings
    hasSettings(): boolean {
        return localStorage.getItem(STORAGE_KEYS.SETTINGS) !== null;
    }

    getSettings(): Settings {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
            return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    }

    saveSettings(settings: Partial<Settings>): void {
        const current = this.getSettings();
        writeJson(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
    }

    // TMDB API key (user-provided and stored locally only)
    getTmdbApiKey(): string {
        return localStorage.getItem(STORAGE_KEYS.TMDB_API_KEY) || '';
    }

    saveTmdbApiKey(apiKey: string): void {
        const trimmed = apiKey.trim();
        if (trimmed) {
            writeRaw(STORAGE_KEYS.TMDB_API_KEY, trimmed);
        } else {
            this.clearTmdbApiKey();
        }
    }

    clearTmdbApiKey(): void {
        removeKey(STORAGE_KEYS.TMDB_API_KEY);
    }

    // OpenSubtitles.com — mesmo modelo do TMDB: chave própria do usuário, sem
    // segredo global embutido no app. Usuário/senha são opcionais (aumentam a
    // cota diária de download); o token de login é derivado, não editado.
    getOpenSubtitlesApiKey(): string {
        return localStorage.getItem(STORAGE_KEYS.OPENSUBTITLES_API_KEY) || '';
    }

    saveOpenSubtitlesApiKey(apiKey: string): void {
        const trimmed = apiKey.trim();
        if (trimmed) {
            writeRaw(STORAGE_KEYS.OPENSUBTITLES_API_KEY, trimmed);
        } else {
            this.clearOpenSubtitlesApiKey();
        }
    }

    clearOpenSubtitlesApiKey(): void {
        removeKey(STORAGE_KEYS.OPENSUBTITLES_API_KEY);
    }

    getOpenSubtitlesCredentials(): { username: string; password: string } | null {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.OPENSUBTITLES_CREDENTIALS);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    saveOpenSubtitlesCredentials(credentials: { username: string; password: string }): void {
        writeJson(STORAGE_KEYS.OPENSUBTITLES_CREDENTIALS, credentials);
    }

    clearOpenSubtitlesCredentials(): void {
        removeKey(STORAGE_KEYS.OPENSUBTITLES_CREDENTIALS);
        // Token de login pertence à credencial que o gerou — não pode sobreviver a ela
        this.clearOpenSubtitlesToken();
    }

    getOpenSubtitlesToken(): { token: string; expiresAt: number } | null {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.OPENSUBTITLES_TOKEN);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    saveOpenSubtitlesToken(token: string, expiresAt: number): void {
        writeJson(STORAGE_KEYS.OPENSUBTITLES_TOKEN, { token, expiresAt });
    }

    clearOpenSubtitlesToken(): void {
        removeKey(STORAGE_KEYS.OPENSUBTITLES_TOKEN);
    }

    // Idioma de busca de legenda: cai pro idioma da interface se nada foi salvo
    getSubtitleLanguage(): string {
        const saved = localStorage.getItem(STORAGE_KEYS.SUBTITLE_LANGUAGE);
        return saved || this.getSettings().language;
    }

    saveSubtitleLanguage(lang: string): void {
        writeRaw(STORAGE_KEYS.SUBTITLE_LANGUAGE, lang.trim().toLowerCase());
    }

    // Clear all data
    clearAll(): void {
        Object.values(STORAGE_KEYS).forEach(key => removeKey(key));
    }
}

export const storage = new StorageService();
