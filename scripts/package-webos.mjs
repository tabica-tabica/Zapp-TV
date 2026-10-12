// Gera o .ipk do webOS em dist/ipk, com as imagens da loja ao lado.
//
//   npm run package:webos
//
// 1. build do webOS (scripts/build-webos.mjs → webos/assets)
// 2. splash de brand/webos entra em webos/ (o appinfo.json aponta pra ele)
// 3. ares-package → dist/ipk (do PATH; sem ele, via npx @webos-tools/cli)
// 4. imagens da loja (launcher, ícone 1024, screenshots) → dist/ipk
// 5. instalador (install-tv.*: Windows/macOS/Linux) + LEIA-ME.txt → dist/ipk
// 6. zapp-tv-lg-<versão>.zip com tudo que quem instala precisa (vai na release)
//
// As imagens-fonte vivem em brand/webos; webos/splash.png é cópia gerada.

import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readdirSync, chmodSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(root, 'brand', 'webos');
const webosDir = join(root, 'webos');
const outDir = join(root, 'dist', 'ipk');

const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });

function temNoPath(bin) {
    try {
        execSync(`command -v ${bin}`, { stdio: 'ignore', shell: '/bin/sh' });
        return true;
    } catch {
        return false;
    }
}

run('node scripts/build-webos.mjs');

cpSync(join(brandDir, 'splash.png'), join(webosDir, 'splash.png'));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const ares = temNoPath('ares-package') ? 'ares-package' : 'npx -y -p @webos-tools/cli ares-package';
run(`${ares} -o "${outDir}" "${webosDir}"`);

for (const nome of ['launcher-bg-1920x1080.jpg', 'store-icon-1024.png', 'screenshots']) {
    cpSync(join(brandDir, nome), join(outDir, nome), { recursive: true });
}
// Instalador pra quem recebe só a pasta: duplo clique no .bat (Windows) ou
// no .command (macOS); no Linux, sh install-tv.command. Sem Node: só ssh/curl
for (const nome of ['install-tv.bat', 'install-tv.ps1', 'install-tv.command', 'install-tv-remote.sh']) {
    cpSync(join(root, 'scripts', nome), join(outDir, nome));
}
chmodSync(join(outDir, 'install-tv.command'), 0o755);
cpSync(join(root, 'scripts', 'install-tv-LEIA-ME.txt'), join(outDir, 'LEIA-ME.txt'));

// Zip pra quem instala: o .ipk + instaladores + LEIA-ME. bsdtar escreve zip e
// guarda a permissão de execução do .command (sem ela o macOS não abre no
// duplo clique); é o `tar` do macOS e do Windows 10+. GNU tar (Linux) não faz
// zip — por isso bsdtar primeiro. Sem nenhum, só avisa: o .ipk já está pronto.
const versao = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const ipk = readdirSync(outDir).find(nome => nome.endsWith('.ipk'));
const noZip = [ipk, 'install-tv.bat', 'install-tv.ps1', 'install-tv.command', 'install-tv-remote.sh', 'LEIA-ME.txt'];
const zip = `zapp-tv-lg-${versao}.zip`;
const zipador = ['bsdtar', 'tar'].find(bin => {
    try {
        return /bsdtar|libarchive/i.test(execSync(`${bin} --version`, { stdio: 'pipe' }).toString());
    } catch {
        return false;
    }
});
if (ipk && zipador) {
    execSync(`${zipador} -a -cf "${zip}" ${noZip.map(n => `"${n}"`).join(' ')}`, { cwd: outDir, stdio: 'inherit' });
} else {
    console.warn('\nSem bsdtar/tar com suporte a zip: zip não gerado (o .ipk e os instaladores estão em dist/ipk).');
}

console.log(`\ndist/ipk: ${readdirSync(outDir).join(', ')}`);
