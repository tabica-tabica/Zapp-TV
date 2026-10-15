// Bundle do app Android TV (android/): build de TV com alvo 'android'
// (vite.android.config.ts) copiado pra android/app/src/main/assets/www.
// O APK em si sai do Gradle (CI: .github/workflows/release-android.yml;
// local: `gradle -p android assembleRelease`, com JDK 17 + Android SDK).
//
// Mesmos cuidados do build-tizen/build-webos: destino limpo antes de copiar,
// e o index.html conferido contra o bundle recém-gerado.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(root, 'dist', 'android', 'assets');
const mainDir = join(root, 'android', 'app', 'src', 'main');
const wwwDir = join(mainDir, 'assets', 'www');

const run = command => execSync(command, { cwd: root, stdio: 'inherit' });
const kb = bytes => `${Math.round(bytes / 1024)} KB`;

// ---- 1. build ----
run('node scripts/sync-brand.mjs');
run('npx tsc -b');
run('npx vite build --config vite.android.config.ts');

// ---- 2. destino limpo, depois copia ----
rmSync(wwwDir, { recursive: true, force: true });
mkdirSync(wwwDir, { recursive: true });
cpSync(distAssets, join(wwwDir, 'assets'), { recursive: true });

// index.html: o do Tizen (escrito à mão, script comum — o bundle é um IIFE
// único), com o viewport em 1920px: a WebView reduz pra caber na tela
// (setUseWideViewPort/LoadWithOverviewMode na MainActivity). Com
// device-width, uma TV 1080p em densidade 2x teria só 960px de CSS e o
// layout de TV (desenhado pra 1920) ficaria espremido.
const htmlTizen = readFileSync(join(root, 'tizen', 'index.html'), 'utf8');
const viewport = /<meta name="viewport"[^>]*>/;
if (!viewport.test(htmlTizen)) {
    console.error('tizen/index.html sem <meta name="viewport"> — abortando.');
    process.exit(1);
}
const html = htmlTizen.replace(viewport, '<meta name="viewport" content="width=1920, user-scalable=no" />');
writeFileSync(join(wwwDir, 'index.html'), html, 'utf8');

// ---- 3. ícones: os do Tauri (src-tauri/icons/android), fonte única ----
cpSync(join(root, 'src-tauri', 'icons', 'android'), join(mainDir, 'res'), { recursive: true });

// ---- 4. o index.html aponta pra arquivos que existem? ----
// Sem esta checagem o APK sai com <script src> pro vazio: tela preta, sem erro.
const referenciados = [...new Set([...html.matchAll(/\.\/assets\/([\w.-]+\.(?:js|css))/g)].map(m => m[1]))];
const presentes = new Set(readdirSync(join(wwwDir, 'assets')));
const faltando = referenciados.filter(nome => !presentes.has(nome));
if (faltando.length > 0) {
    console.error(`ERRO: index.html referencia assets que o build não produziu: ${faltando.join(', ')}`);
    console.error(`Produzidos: ${[...presentes].join(', ')}`);
    process.exit(1);
}

const arquivos = readdirSync(join(wwwDir, 'assets')).map(nome => statSync(join(wwwDir, 'assets', nome)).size);
console.log(`\nandroid/app/src/main/assets/www: ${arquivos.length} arquivo(s), ${kb(arquivos.reduce((a, b) => a + b, 0))}`);
console.log(`index.html: ${referenciados.length} referência(s) conferida(s).`);
console.log('APK: gradle -p android assembleRelease (JDK 17 + Android SDK) — ou o workflow "Release Android".');
