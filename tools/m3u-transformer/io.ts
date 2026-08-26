// Leitura de entrada (arquivo local ou URL) e escrita de saída — spec §4.

import { readFileSync, writeFileSync } from 'node:fs';

const URL_PATTERN = /^https?:\/\//i;

export function isUrl(input: string): boolean {
    return URL_PATTERN.test(input);
}

export async function readInput(input: string): Promise<string> {
    if (isUrl(input)) {
        const response = await fetch(input);
        if (!response.ok) {
            throw new Error(`Falha ao baixar ${input}: HTTP ${response.status} ${response.statusText}`);
        }
        return await response.text();
    }
    return readFileSync(input, 'utf8');
}

export function writeOutput(path: string, content: string): void {
    writeFileSync(path, content, 'utf8');
}
