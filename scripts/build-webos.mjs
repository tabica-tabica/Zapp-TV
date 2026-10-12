// Empacotamento LG webOS — espelha scripts/build-tizen.mjs (mesmo incidente
// que motivou aquele: destino limpo antes de copiar, e index.html/polyfills
// conferidos contra o bundle recém-gerado, não contra promessa).
//
// A versão não é mantida em dois lugares: package.json manda, e o
// appinfo.json é derivado dele (troca de campo direcionada — não um
// round-trip de JSON.stringify, que reordenaria as chaves à toa).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLYFILLS_WEBOS, MARCA_NO_BUNDLE } from './tizen-polyfills.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist', 'webos', 'assets');
const webosDir = join(root, 'webos');
const assetsDir = join(webosDir, 'assets');
const appinfoPath = join(webosDir, 'appinfo.json');

function run(command) {
    execSync(command, { cwd: root, stdio: 'inherit' });
}

function humanKb(bytes) {
    return `${Math.round(bytes / 1024)} KB`;
}

// ---- 0. nome/marca: brand.config.mjs é a fonte da verdade ----
run('node scripts/sync-brand.mjs');

// ---- 1. versão: package.json é a fonte da verdade ----
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appinfo = readFileSync(appinfoPath, 'utf8');
const versionMatch = appinfo.match(/("version":\s*")([^"]+)(")/);
if (!versionMatch) {
    console.error('appinfo.json sem campo "version" — abortando.');
    process.exit(1);
}
if (versionMatch[2] !== pkg.version) {
    writeFileSync(
        appinfoPath,
        appinfo.replace(versionMatch[0], `${versionMatch[1]}${pkg.version}${versionMatch[3]}`),
        'utf8'
    );
    console.log(`appinfo.json: versão ${versionMatch[2]} → ${pkg.version}`);
} else {
    console.log(`appinfo.json: versão ${pkg.version} (já em dia)`);
}

// ---- 2. build ----
run('npx tsc -b');
run('npx vite build --config vite.webos.config.ts');

// ---- 3. destino limpo, depois copia ----
rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });
cpSync(distDir, assetsDir, { recursive: true });

const files = readdirSync(assetsDir)
    .map(name => ({ name, size: statSync(join(assetsDir, name)).size }))
    .sort((a, b) => b.size - a.size);
const total = files.reduce((sum, file) => sum + file.size, 0);

console.log('\nwebos/assets:');
for (const file of files) {
    console.log(`  ${humanKb(file.size).padStart(8)}  ${file.name}`);
}
console.log(`  ${humanKb(total).padStart(8)}  TOTAL\n`);

// ---- 4. o index.html aponta pra arquivos que existem? ----
// Mesmo risco do Tizen: index.html é escrito à mão, e trocar a estratégia de
// bundle muda os NOMES dos assets. Sem esta checagem o .ipk sai com
// <script src> apontando pro vazio e a TV mostra tela preta — sem erro visível.
const html = readFileSync(join(webosDir, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/\.\/assets\/([\w.-]+\.(?:js|css))/g)].map(m => m[1]);
const present = new Set(readdirSync(assetsDir));
const missing = [...new Set(referenced)].filter(name => !present.has(name));
if (missing.length > 0) {
    console.error(`
ERRO: webos/index.html referencia assets que o build nao produziu: ${missing.join(', ')}`);
    console.error(`Produzidos: ${[...present].join(', ')}`);
    process.exit(1);
}
console.log(`index.html: ${[...new Set(referenced)].length} referencia(s) conferida(s).
`);

// ---- 4b. a lista de polyfills declarada bate com o bundle? ----
// Lista própria do webOS (Chromium 53, bem mais velho que o 69 do Tizen) —
// ver scripts/tizen-polyfills.mjs.
const polyfillFile = readdirSync(assetsDir).find(name => name.startsWith('polyfills'));
const polyfillSource = polyfillFile ? readFileSync(join(assetsDir, polyfillFile), 'utf8') : '';
const naoEntregues = POLYFILLS_WEBOS.apis.filter(
    nome => !polyfillSource.includes(MARCA_NO_BUNDLE[nome] ?? nome)
);
if (naoEntregues.length > 0) {
    console.error(`
ERRO: scripts/tizen-polyfills.mjs declara polyfills que o bundle NAO entrega: ${naoEntregues.join(', ')}`);
    console.error('O eslint-plugin-compat esta silenciando estes nomes por confiar nesta lista.');
    console.error('Ou o build parou de polifilar, ou a lista esta errada. Nao ignore.');
    process.exit(1);
}
console.log(`polyfills: ${POLYFILLS_WEBOS.apis.length} declarado(s) e conferido(s) no bundle.
`);

// ---- 5. o .ipk em si ----
// Empacotar exige o webOS CLI (ares-package): sem ele instalado não adianta
// gerar nada aqui. O id em appinfo.json também é só um placeholder até a
// conta na LG Seller Lounge existir e reservar o id de verdade.
console.log('Pronto pra empacotar: npm run package:webos (gera dist/ipk com as imagens da loja)');
