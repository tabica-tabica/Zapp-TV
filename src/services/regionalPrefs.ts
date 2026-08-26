/**
 * Preferência de quais variantes regionais o usuário quer ver, por família
 * detectada em regionalVariants.ts. Escopado por PLAYLIST (não por perfil,
 * igual catalogCache.ts) — praças regionais são um dado do catálogo do
 * provedor, não de quem está assistindo.
 */

import { playlistService } from './playlistService';

const PREFIX = 'neostream_regional_prefs_';

function storageKey(): string {
    const playlist = playlistService.getActiveId() || 'default';
    return `${PREFIX}${playlist}`;
}

function readMap(): Record<string, Array<number | string>> {
    try {
        const raw = localStorage.getItem(storageKey());
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeMap(map: Record<string, Array<number | string>>): void {
    try {
        localStorage.setItem(storageKey(), JSON.stringify(map));
    } catch {
        // Quota cheia — falha silenciosa, igual ao restante do app
    }
}

export const regionalPrefs = {
    /**
     * IDs selecionados pra uma família. Sem preferência salva ainda, o padrão
     * é `fallbackFirstId` sozinho — só a primeira variante detectada aparece
     * até o usuário abrir Configurações e marcar mais.
     */
    getSelected(familyKey: string, fallbackFirstId: number | string): Set<number | string> {
        const map = readMap();
        const saved = map[familyKey];
        if (!saved || saved.length === 0) return new Set([fallbackFirstId]);
        return new Set(saved);
    },

    setSelected(familyKey: string, ids: Set<number | string>): void {
        const map = readMap();
        map[familyKey] = [...ids];
        writeMap(map);
    },
};
