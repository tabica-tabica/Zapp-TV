#!/usr/bin/env -S node --experimental-strip-types
// Transformador de listas M3U — entrada única, per .agents/m3u-transformer.md.
//
//   node --experimental-strip-types transform.ts --input lista.m3u --output saida.m3u
//
// Ver README.md nesta pasta para exemplos e as flags disponíveis.

import { parseM3U } from './parse.ts';
import { classifyEntry } from './classify.ts';
import { groupAndSort } from './group.ts';
import { renderM3U } from './render.ts';
import { readInput, writeOutput } from './io.ts';
import { buildReport, printReport } from './report.ts';
import type { TransformOptions } from './types.ts';

interface CliArgs {
    input: string;
    output: string;
    defaultGroupVod: string;
    defaultGroupLive: string;
    dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    const args: Partial<CliArgs> = { dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--input':
                args.input = argv[++i];
                break;
            case '--output':
                args.output = argv[++i];
                break;
            case '--default-group-vod':
                args.defaultGroupVod = argv[++i];
                break;
            case '--default-group-live':
                args.defaultGroupLive = argv[++i];
                break;
            case '--dry-run':
                args.dryRun = true;
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
                break;
            default:
                throw new Error(`Flag desconhecida: ${arg} (use --help)`);
        }
    }
    if (!args.input) {
        printUsage();
        throw new Error('--input é obrigatório');
    }
    return {
        input: args.input,
        output: args.output ?? 'output.m3u',
        defaultGroupVod: args.defaultGroupVod ?? 'Filmes',
        defaultGroupLive: args.defaultGroupLive ?? 'Canais',
        dryRun: args.dryRun ?? false,
    };
}

function printUsage(): void {
    console.log(`
Uso: node --experimental-strip-types transform.ts --input <arquivo|url> [opções]

Opções:
  --input <path|url>          Lista M3U de entrada (obrigatório)
  --output <path>             Arquivo de saída (default: output.m3u)
  --default-group-vod <nome>  group-title default para VOD sem um definido (default: Filmes)
  --default-group-live <nome> group-title default para canais sem um definido (default: Canais)
  --dry-run                   Só imprime o relatório, não grava o arquivo de saída
  --help                      Mostra esta ajuda
`);
}

export async function run(argv: string[]): Promise<void> {
    const args = parseArgs(argv);
    const options: TransformOptions = {
        defaultGroupVod: args.defaultGroupVod,
        defaultGroupLive: args.defaultGroupLive,
    };

    console.log(`Lendo ${args.input}...`);
    const raw = await readInput(args.input);

    const parsed = parseM3U(raw);
    console.log(`${parsed.length} itens encontrados. Classificando...`);
    const classified = parsed.map(entry => classifyEntry(entry, options));

    const { entries, duplicatesRemoved, groupCount } = groupAndSort(classified);

    const report = buildReport(parsed.length, duplicatesRemoved, groupCount, entries);
    printReport(report);

    if (args.dryRun) {
        console.log('(--dry-run: nada foi gravado)');
        return;
    }

    const rendered = renderM3U(entries, options);
    writeOutput(args.output, rendered);
    console.log(`Gravado em ${args.output}`);
}

// Só roda o CLI quando o arquivo é executado diretamente — importar de um
// teste não deve disparar main() sozinho.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    run(process.argv.slice(2)).catch(err => {
        console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
