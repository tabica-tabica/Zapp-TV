// Geração do M3U de saída — spec §3.

import type { M3UEntry, TransformOptions } from './types.ts';
import { ADULT_GROUP_TITLE } from './adult.ts';

/** M3U não define escape de aspas dentro de atributo — na dúvida, remove. */
function safeAttr(value: string): string {
    return value.replace(/"/g, "'");
}

export function finalName(entry: M3UEntry): string {
    return `${entry.rootTitle} (${entry.audio} - ${entry.quality})`;
}

function resolveGroupTitle(entry: M3UEntry, options: TransformOptions): string {
    // Adulto sempre consolida numa categoria só, não importa o group-title
    // original — a lista real tem pelo menos 4 grafias espalhadas pro mesmo
    // conteúdo ("Canais | Adultos", "Filmes Adultos", "Hentai [adultos]"...).
    if (entry.isAdult) return ADULT_GROUP_TITLE;
    const existing = entry.attributes.groupTitle?.trim();
    if (existing) return existing;
    return entry.contentType === 'live' ? options.defaultGroupLive : options.defaultGroupVod;
}

export function renderEntry(entry: M3UEntry, options: TransformOptions): string {
    const name = finalName(entry);
    const parts: string[] = [];
    if (entry.attributes.tvgId) parts.push(`tvg-id="${safeAttr(entry.attributes.tvgId)}"`);
    if (entry.attributes.tvgName) parts.push(`tvg-name="${safeAttr(entry.attributes.tvgName)}"`);
    if (entry.attributes.tvgLogo) parts.push(`tvg-logo="${safeAttr(entry.attributes.tvgLogo)}"`);
    parts.push(`group-title="${safeAttr(resolveGroupTitle(entry, options))}"`);

    const attrsText = parts.length > 0 ? ` ${parts.join(' ')}` : '';
    return `#EXTINF:-1${attrsText},${name}\n${entry.raw.url}`;
}

export function renderM3U(entries: M3UEntry[], options: TransformOptions): string {
    const lines = ['#EXTM3U', ...entries.map(entry => renderEntry(entry, options))];
    return lines.join('\n') + '\n';
}
