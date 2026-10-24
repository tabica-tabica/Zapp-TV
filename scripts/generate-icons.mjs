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

// Rasteriza brand.logoSource com as cores dadas pra `destino` (1024×1024).
function rasterizarLogo(accent, accent2, destino) {
    const logoPath = join(root, brand.logoSource);
    if (!existsSync(logoPath)) {
        console.error(`SVG da marca não encontrado: ${brand.logoSource}`);
        process.exit(1);
    }
    const svgResolvido = readFileSync(logoPath, 'utf8')
        .replaceAll('{{ACCENT}}', accent)
        .replaceAll('{{ACCENT2}}', accent2);
    // Arquivo temporário ao lado do destino — rsvg-convert precisa de um
    // caminho de verdade, não de stdin, e o svg resolvido não tem valor
    // nenhum guardado (é derivado, git-ignorado como o próprio iconSource).
    const svgTemp = `${destino}.tmp.svg`;
    writeFileSync(svgTemp, svgResolvido, 'utf8');
    try {
        magick([svgTemp, '-background', 'none', '-resize', '1024x1024', destino]);
    } finally {
        unlinkSync(svgTemp);
    }
}

if (brand.logoSource) {
    rasterizarLogo(brand.accent.hex, brand.accent2.hex, fonte);
    console.log(`Ícone-base gerado de ${brand.logoSource} (${brand.accent.hex} → ${brand.accent2.hex}) → ${brand.iconSource}`);
}

if (!existsSync(fonte)) {
    console.error(`Imagem-fonte não encontrada: ${brand.iconSource}`);
    console.error('Configure brand.config.mjs\'s `iconSource` pra um PNG de verdade (1024×1024 recomendado), ou `logoSource` pra gerar a partir de um SVG.');
    process.exit(1);
}

function resize(destinoRelativo, tamanho, origem = fonte) {
    const destino = join(root, destinoRelativo);
    magick([origem, '-resize', `${tamanho}x${tamanho}`, destino]);
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
// A QA da LG reprova se o fundo do ícone não bate com a cor do tile
// (appinfo.json's iconColor) — rejeição de 2026-10-12, "Appicon background
// color and tile color do not match". Por isso o ícone do webOS sai com fundo
// SÓLIDO (sem o gradiente accent→accent2) e o iconColor é escrito daqui, da
// mesma cor, pra os dois nunca divergirem.
{
    let origem = fonte;
    if (brand.logoSource) {
        origem = join(root, 'webos', 'icon-solido.tmp.png');
        rasterizarLogo(brand.accent.hex, brand.accent.hex, origem);
    } else {
        console.warn('  sem logoSource: ícone do webOS usa o iconSource como está — confira se o fundo é sólido e igual ao iconColor');
    }
    // Tamanhos da convenção do LG webOS TV SDK (icon/largeIcon).
    resize('webos/icon.png', 80, origem);
    resize('webos/largeIcon.png', 130, origem);
    if (origem !== fonte) unlinkSync(origem);

    const appinfoPath = join(root, 'webos', 'appinfo.json');
    const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf8'));
    appinfo.iconColor = brand.accent.hex;
    writeFileSync(appinfoPath, `${JSON.stringify(appinfo, null, 2)}\n`, 'utf8');
    console.log(`  webos/appinfo.json: iconColor = ${brand.accent.hex}`);
}

console.log('\nTauri (Windows/Linux):');
try {
    execFileSync('npx', ['tauri', 'icon', fonte, '-o', join(root, 'src-tauri/icons')], { stdio: 'inherit' });
} catch {
    console.error('  `tauri icon` falhou — rode manualmente: npx tauri icon <iconSource> -o src-tauri/icons');
    process.exit(1);
}

console.log('\nÍcones gerados. Rode node scripts/sync-brand.mjs se ainda não rodou (nome/título dos manifests).');
