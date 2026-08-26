// Parser manual de M3U — linha a linha, sem lib externa (spec §4/§6).
// O formato é simples o bastante: #EXTM3U, blocos #EXTINF + URL, comentários
// e linhas em branco ignorados.

import type { M3UAttributes, M3UEntry } from './types.ts';

/** Extrai os atributos `key="value"` de dentro do #EXTINF, na ordem em que aparecem. */
function parseAttributes(segment: string): M3UAttributes {
    const attrs: M3UAttributes = {};
    const re = /([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(segment)) !== null) {
        const [, key, value] = match;
        switch (key.toLowerCase()) {
            case 'tvg-id': attrs.tvgId = value; break;
            case 'tvg-name': attrs.tvgName = value; break;
            case 'tvg-logo': attrs.tvgLogo = value; break;
            case 'group-title': attrs.groupTitle = value; break;
            // Outros atributos (tvg-chno, radio, etc.) não fazem parte do
            // escopo da spec — descartados de propósito, não por descuido.
        }
    }
    return attrs;
}

/**
 * Separa "atributos" de "título" dentro do #EXTINF. O título pode conter
 * vírgulas (nomes reais têm), então a régua não é "primeira vírgula" — é a
 * primeira vírgula DEPOIS que todos os valores entre aspas já fecharam.
 */
function splitAttrsAndTitle(afterDuration: string): { attrsSegment: string; title: string } {
    const lastQuote = afterDuration.lastIndexOf('"');
    const searchFrom = lastQuote === -1 ? 0 : lastQuote;
    const commaIdx = afterDuration.indexOf(',', searchFrom);
    if (commaIdx === -1) {
        // Sem vírgula nenhuma — linha degenerada; tudo vira atributos, título vazio.
        return { attrsSegment: afterDuration, title: '' };
    }
    return {
        attrsSegment: afterDuration.slice(0, commaIdx),
        title: afterDuration.slice(commaIdx + 1).trim(),
    };
}

function parseExtinfLine(line: string): { attributes: M3UAttributes; title: string } | null {
    // "#EXTINF:-1 tvg-id=\"x\" ...,Nome" — a duração (-1) é sempre descartada:
    // nunca vi outro valor num #EXTINF de IPTV, e a saída não a usa.
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return null;
    const afterHash = line.slice(colonIdx + 1);
    // Pula a duração (dígitos/sinal) até o primeiro espaço OU vírgula — cobre
    // tanto "#EXTINF:-1 tvg-id=..." quanto "#EXTINF:-1,Nome" (spec §7, sem atributos).
    const durationMatch = afterHash.match(/^-?\d+/);
    const rest = durationMatch ? afterHash.slice(durationMatch[0].length) : afterHash;
    const { attrsSegment, title } = splitAttrsAndTitle(rest);
    return { attributes: parseAttributes(attrsSegment), title };
}

/** Normaliza quebras de linha (CRLF/CR/LF) e remove BOM — spec §7. */
export function normalizeContent(content: string): string {
    return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function parseM3U(content: string): M3UEntry[] {
    const lines = normalizeContent(content).split('\n');
    const entries: M3UEntry[] = [];

    let pending: { extinf: string; attributes: M3UAttributes; title: string } | null = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === '#EXTM3U' || line.startsWith('#EXTM3U ')) continue;

        if (line.startsWith('#EXTINF')) {
            const parsed = parseExtinfLine(line);
            if (parsed) {
                // #EXTINF sem URL na sequência (lista truncada, por ex.) — o
                // pendente anterior é descartado, não escrito com URL vazia.
                pending = { extinf: line, attributes: parsed.attributes, title: parsed.title };
            } else {
                pending = null;
            }
            continue;
        }

        if (line.startsWith('#')) {
            // Outro comentário/diretiva (#EXTGRP, #EXTVLCOPT, ...) — fora do
            // escopo da spec, ignorado sem derrubar o parsing do resto.
            continue;
        }

        // Não é comentário nem #EXTINF: é a URL do item pendente.
        if (pending) {
            entries.push({
                raw: { extinf: pending.extinf, url: line },
                attributes: pending.attributes,
                title: pending.title,
                // Preenchidos por classifyEntry — placeholders até lá.
                contentType: 'vod',
                rootTitle: pending.title,
                audio: 'Não especificado',
                quality: 'SD',
                isAdult: false,
            });
            pending = null;
        }
        // URL sem #EXTINF antes: lista mal-formada — ignorada, não é um item válido.
    }

    return entries;
}
