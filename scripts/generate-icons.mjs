// Gera os ícones de TODAS as plataformas a partir de UMA imagem-fonte
// (brand.config.mjs's `iconSource`, 1024×1024 recomendado, fundo opaco).
//
// Antes de tudo, se `logoSource` estiver configurado (brand/logo-source.svg
// por padrão), esse SVG é rasterizado pra `iconSource` com as cores DA VEZ
// de brand.config.mjs — assim o PNG-base nunca fica desatualizado quando a
// marca muda de cor, sem precisar reexportar nada num editor de imagem.
//
// Usa o ImageMagick (`magick`, já disponível neste tipo de ambiente — mesma
// ferramenta usada pra gerar o ícone do Tauri nesta sessão) em vez de somar
// uma dependência de imagem no package.json. A rasterização de SVG passa
// pelo delegate `rsvg-convert` (suporte completo a gradiente, ao contrário
// do coder MSVG embutido do ImageMagick) — confirme com `magick -list
// delegate | grep svg` se num ambiente novo isto não gerar a cor certa.
//
//   node scripts/generate-icons.mjs

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import brand from '../brand.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = join(root, brand.iconSource);

function magick(args) {
    execFileSync('magick', args, { stdio: 'inherit' });
}

if (brand.logoSource) {
    const logoPath = join(root, brand.logoSource);
    if (!existsSync(logoPath)) {
        console.error(`SVG da marca não encontrado: ${brand.logoSource}`);
        process.exit(1);
    }
    const svgTemplate = readFileSync(logoPath, 'utf8');
    const svgResolvido = svgTemplate
        .replaceAll('{{ACCENT}}', brand.accent.hex)
        .replaceAll('{{ACCENT2}}', brand.accent2.hex);
    // Arquivo temporário ao lado do destino — rsvg-convert precisa de um
    // caminho de verdade, não de stdin, e o svg resolvido não tem valor
    // nenhum guardado (é derivado, git-ignorado como o próprio iconSource).
    const svgTemp = `${fonte}.tmp.svg`;
    writeFileSync(svgTemp, svgResolvido, 'utf8');
    try {
        magick([svgTemp, '-background', 'none', '-resize', '1024x1024', fonte]);
        console.log(`Ícone-base gerado de ${brand.logoSource} (${brand.accent.hex} → ${brand.accent2.hex}) → ${brand.iconSource}`);
    } finally {
        unlinkSync(svgTemp);
    }
}

if (!existsSync(fonte)) {
    console.error(`Imagem-fonte não encontrada: ${brand.iconSource}`);
    console.error('Configure brand.config.mjs\'s `iconSource` pra um PNG de verdade (1024×1024 recomendado), ou `logoSource` pra gerar a partir de um SVG.');
    process.exit(1);
}

function resize(destinoRelativo, tamanho) {
    const destino = join(root, destinoRelativo);
    magick([fonte, '-resize', `${tamanho}x${tamanho}`, destino]);
    console.log(`  ${destinoRelativo} (${tamanho}×${tamanho})`);
}

console.log('Web:');
resize('public/favicon.png', 64);
// Também um .ico multi-resolução — alguns navegadores pedem /favicon.ico
// direto, sem olhar a <link>.
magick([fonte, '-define', 'icon:auto-resize=16,32,48,64', join(root, 'public/favicon.ico')]);
console.log('  public/favicon.ico (16,32,48,64)');
{
    const caminho = join(root, 'index.html');
    const original = readFileSync(caminho, 'utf8');
    const novo = original.replace(
        /<link rel="icon"[^>]*\/>/,
        '<link rel="icon" type="image/png" href="/favicon.png" />'
    );
    if (novo !== original) {
        writeFileSync(caminho, novo, 'utf8');
        console.log('  index.html: <link rel="icon"> atualizado');
    }
}

console.log('\nTizen:');
resize('tizen/icon.png', 512);
console.log('  (config.xml não referencia o ícone por nome — Tizen Studio pega por convenção, nada pra sincronizar ali)');

console.log('\nwebOS:');
// Tamanhos da convenção do LG webOS TV SDK (icon/largeIcon) — não testado num
// device/emulador real nesta sessão; confirme antes de considerar definitivo.
resize('webos/icon.png', 80);
resize('webos/largeIcon.png', 130);

console.log('\nTauri (Windows/Linux):');
try {
    execFileSync('npx', ['tauri', 'icon', fonte, '-o', join(root, 'src-tauri/icons')], { stdio: 'inherit' });
} catch {
    console.error('  `tauri icon` falhou — rode manualmente: npx tauri icon <iconSource> -o src-tauri/icons');
    process.exit(1);
}

console.log('\nÍcones gerados. Rode node scripts/sync-brand.mjs se ainda não rodou (nome/título dos manifests).');
