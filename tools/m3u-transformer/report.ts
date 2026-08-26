// Relatório de classificação — spec §6/§8: contagem por categoria e lista de
// itens que caíram nos dois defaults ao mesmo tempo, para revisão manual.

import type { Audio, ClassificationReport, ContentType, M3UEntry, Quality } from './types.ts';

const QUALITIES: Quality[] = ['4K', 'FHD', 'HD', 'SD'];
const AUDIOS: Audio[] = ['Dublado', 'Legendado', 'Original', 'Dual Áudio', 'Não especificado'];
const CONTENT_TYPES: ContentType[] = ['live', 'vod'];

/** Default de qualidade+áudio ao mesmo tempo = nenhuma pista foi encontrada. */
function isFullyUnclassified(entry: M3UEntry): boolean {
    return entry.quality === 'SD' && entry.audio === 'Não especificado';
}

const SAMPLE_SIZE = 20;

export function buildReport(
    totalInput: number,
    duplicatesRemoved: number,
    groups: number,
    outputEntries: M3UEntry[]
): ClassificationReport {
    const byContentType = Object.fromEntries(CONTENT_TYPES.map(t => [t, 0])) as Record<ContentType, number>;
    const byQuality = Object.fromEntries(QUALITIES.map(q => [q, 0])) as Record<Quality, number>;
    const byAudio = Object.fromEntries(AUDIOS.map(a => [a, 0])) as Record<Audio, number>;
    const fullyUnclassified: M3UEntry[] = [];
    const adultSample: M3UEntry[] = [];
    let adultCount = 0;

    for (const entry of outputEntries) {
        byContentType[entry.contentType]++;
        byQuality[entry.quality]++;
        byAudio[entry.audio]++;
        if (isFullyUnclassified(entry)) fullyUnclassified.push(entry);
        if (entry.isAdult) {
            adultCount++;
            if (adultSample.length < SAMPLE_SIZE) adultSample.push(entry);
        }
    }

    return {
        totalInput,
        duplicatesRemoved,
        totalOutput: outputEntries.length,
        groups,
        byContentType,
        byQuality,
        byAudio,
        fullyUnclassified,
        adultCount,
        adultSample,
    };
}

export function printReport(report: ClassificationReport): void {
    const lines: string[] = [];
    lines.push('');
    lines.push('=== Relatório de classificação ===');
    lines.push(`Itens na entrada:       ${report.totalInput}`);
    lines.push(`Duplicados removidos:   ${report.duplicatesRemoved}`);
    lines.push(`Itens na saída:         ${report.totalOutput}`);
    lines.push(`Grupos (raízes únicas): ${report.groups}`);
    lines.push('');
    lines.push('Por tipo:');
    for (const [type, count] of Object.entries(report.byContentType)) {
        lines.push(`  ${type.padEnd(6)} ${count}`);
    }
    lines.push('');
    lines.push('Por qualidade:');
    for (const [quality, count] of Object.entries(report.byQuality)) {
        lines.push(`  ${quality.padEnd(6)} ${count}`);
    }
    lines.push('');
    lines.push('Por áudio:');
    for (const [audio, count] of Object.entries(report.byAudio)) {
        lines.push(`  ${audio.padEnd(18)} ${count}`);
    }
    lines.push('');
    lines.push(`Conteúdo adulto detectado (consolidado em "🔞 Adulto", movido pro início): ${report.adultCount}`);
    if (report.adultSample.length > 0) {
        lines.push(`Amostra (até ${SAMPLE_SIZE}, revisar manualmente):`);
        for (const entry of report.adultSample) {
            lines.push(`  - [${entry.contentType}] ${entry.title}`);
        }
        if (report.adultCount > report.adultSample.length) {
            lines.push(`  ... e mais ${report.adultCount - report.adultSample.length}`);
        }
    }
    lines.push('');
    lines.push(
        `Sem NENHUMA pista de qualidade ou áudio (caíram nos dois defaults): ${report.fullyUnclassified.length}`
    );
    if (report.fullyUnclassified.length > 0) {
        lines.push(`Amostra (até ${SAMPLE_SIZE}, revisar manualmente):`);
        for (const entry of report.fullyUnclassified.slice(0, SAMPLE_SIZE)) {
            lines.push(`  - [${entry.contentType}] ${entry.title}`);
        }
        if (report.fullyUnclassified.length > SAMPLE_SIZE) {
            lines.push(`  ... e mais ${report.fullyUnclassified.length - SAMPLE_SIZE}`);
        }
    }
    lines.push('');
    console.log(lines.join('\n'));
}
