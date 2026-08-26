// Sincroniza o nome de brand.config.mjs pros 3 HTML estáticos + 3 manifests de
// plataforma que NÃO passam pelo `define` do Vite (index.html, tizen/index.html
// + config.xml, webos/index.html + appinfo.json, src-tauri/tauri.conf.json).
//
// Mesmo padrão do sync de versão já existente em build-tizen.mjs/build-webos.mjs:
// lê o arquivo como texto, troca só o campo específico via regex/substring, e só
// grava se o valor mudou — nunca reserializa o arquivo inteiro (evita reordenar
// chaves de JSON/mudar indentação à toa).
//
// IDs de publicador (tizen:application id, package, webos "id", tauri
// "identifier") são propositalmente DEIXADOS DE FORA — são amarrados a
// certificado/assinatura, não são "nome de marca" e trocar sozinho quebraria a
// instalação num device real.
//
//   node scripts/sync-brand.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import brand from '../brand.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const kebab = brand.fullName.toLowerCase().replace(/\s+/g, '-');
const noSpace = brand.fullName.replace(/\s+/g, '');

let trocou = false;

function patch(caminhoRelativo, transformar) {
    const caminho = join(root, caminhoRelativo);
    const original = readFileSync(caminho, 'utf8');
    const novo = transformar(original);
    if (novo === original) {
        console.log(`${caminhoRelativo}: já em dia`);
        return;
    }
    writeFileSync(caminho, novo, 'utf8');
    console.log(`${caminhoRelativo}: atualizado`);
    trocou = true;
}

function trocarTag(texto, tag, valor) {
    return texto.replace(new RegExp(`(<${tag}>)[^<]*(</${tag}>)`), `$1${valor}$2`);
}

function trocarJson(texto, chave, valor) {
    return texto.replace(
        new RegExp(`("${chave}":\\s*")[^"]*(")`),
        `$1${valor}$2`
    );
}

// ---- Web ----
patch('index.html', texto => trocarTag(texto, 'title', kebab));

// ---- Tizen ----
patch('tizen/index.html', texto => trocarTag(texto, 'title', noSpace)
    .replace('Carregando NeoStream</strong>', `Carregando ${brand.name}</strong>`)
    .replace('Erro ao carregar NeoStream</strong>', `Erro ao carregar ${brand.name}</strong>`));

patch('tizen/config.xml', texto => trocarTag(texto, 'name', noSpace));

// ---- webOS ----
patch('webos/index.html', texto => trocarTag(texto, 'title', noSpace)
    .replace('Carregando NeoStream</strong>', `Carregando ${brand.name}</strong>`)
    .replace('Erro ao carregar NeoStream</strong>', `Erro ao carregar ${brand.name}</strong>`));

patch('webos/appinfo.json', texto => trocarJson(texto, 'title', brand.fullName));

// ---- Tauri ----
patch('src-tauri/tauri.conf.json', texto => trocarJson(
    trocarJson(texto, 'productName', brand.fullName),
    'title', brand.fullName
));

if (!trocou) {
    console.log('\nTudo já refletia brand.config.mjs — nada pra sincronizar.');
}
