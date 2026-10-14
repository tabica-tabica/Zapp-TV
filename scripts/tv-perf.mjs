#!/usr/bin/env node
// Bancada de desempenho NA TV (LG webOS, Modo Desenvolvedor). Dirige o app
// pelo controle de rede da TV (SSAP, porta 3000) e mede pelo inspetor
// (DevTools, porta 9998) — nada de mock: é o aparelho de verdade.
//
//   node scripts/tv-perf.mjs <ip-da-tv> [--ipk dist/ipk/x.ipk] [--runs 2]
//                                       [--save-baseline] [--only a,b]
//
// Antes: app instalado em modo dev e logado. Na 1ª vez a TV pede pra aceitar
// o pareamento ("Zapp perf") — a chave fica em .tv-perf/ (fora do git).
// --ipk instala antes de medir: precisa do Key Server ligado (TV_PASSPHRASE,
// ou pergunta) — mesmo caminho de scripts/install-tv.command.
//
// Cenários (--only): home, grade, troca, assistir, zap, ocioso (zap por último antes do ocioso: esbarra no limite de 1 conexão e segura o painel). Saída: tabela + JSON em
// .tv-perf/ultimo.json; com baseline salvo, mostra a diferença.
// "imagem" (prévia com quadro, não só áudio) usa python3 + Pillow se houver.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ESTADO = path.join(RAIZ, '.tv-perf');
const APP = 'com.tabica.zapptv';
const args = process.argv.slice(2);
const IP = args.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
const opt = (nome, padrao) => { const i = args.indexOf(`--${nome}`); return i < 0 ? padrao : args[i + 1]; };
const flag = nome => args.includes(`--${nome}`);
if (!IP) { console.error('Uso: node scripts/tv-perf.mjs <ip-da-tv> [--ipk arq.ipk] [--runs N] [--save-baseline] [--only home,grade,troca,assistir,zap,ocioso]'); process.exit(1); }
const RUNS = Number(opt('runs', 1));
const SO = (opt('only', 'home,grade,troca,assistir,zap,ocioso')).split(',');
fs.mkdirSync(ESTADO, { recursive: true });
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ---------- SSAP (controle de rede da TV) ----------
// Mesma lista do pareamento: chave aprovada com outra lista some com permissões
const PERMS = ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CONTROL_AUDIO', 'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_POWER',
    'READ_INSTALLED_APPS', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK', 'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_TV',
    'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE',
    'READ_COUNTRY_INFO', 'READ_RUNNING_APPS', 'READ_CURRENT_CHANNEL', 'READ_APP_STATUS', 'CONTROL_MOUSE_AND_KEYBOARD',
    'CONTROL_TV_SCREEN', 'CONTROL_TV_STANBY', 'CONTROL_FAVORITE_GROUP', 'CONTROL_USER_INFO', 'READ_SETTINGS',
    'WRITE_SETTINGS', 'SCREEN_CAPTURE'];
async function ssap() {
    const arqChave = path.join(ESTADO, 'ssap-key');
    const ws = new WebSocket(`ws://${IP}:3000`);
    let n = 0; const pend = {};
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'response' && m.payload?.pairingType) return; pend[m.id]?.(m); };
    await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = () => falha(new Error(`TV não responde em ${IP}:3000`)); });
    const enviar = (type, uri, payload) => new Promise(r => { const id = `m${++n}`; pend[id] = r; ws.send(JSON.stringify({ id, type, uri, payload })); });
    const chave = fs.existsSync(arqChave) ? fs.readFileSync(arqChave, 'utf8') : undefined;
    if (!chave) console.log('Aceite o pareamento "Zapp perf" na TV...');
    const reg = await enviar('register', undefined, { forcePairing: false, pairingType: 'PROMPT', 'client-key': chave,
        manifest: { manifestVersion: 1, appVersion: '1.0', permissions: PERMS, signed: { appId: 'com.lge.test', vendorId: 'com.lge', created: '20140509',
            localizedAppNames: { '': 'Zapp perf' }, localizedVendorNames: { '': 'LG' }, permissions: PERMS, serial: '2f930e2d2cfe083771f68e4fe7bb07' },
            signatures: [{ signatureVersion: 1, signature: 'x' }] } });
    if (!reg.payload?.['client-key']) throw new Error('Pareamento recusado na TV');
    fs.writeFileSync(arqChave, reg.payload['client-key']);
    const req = async (uri, payload) => (await enviar('request', uri, payload)).payload;
    const sock = await req('ssap://com.webos.service.networkinput/getPointerInputSocket');
    const ponteiro = new WebSocket(sock.socketPath);
    await new Promise(r => (ponteiro.onopen = r));
    return {
        req,
        // 600ms entre teclas: ritmo de gente apertando, não rajada
        teclas: async (lista, intervalo = 600) => { for (const k of lista) { ponteiro.send(`type:button\nname:${k}\n\n`); await dormir(intervalo); } },
        foto: async destino => { const r = await req('ssap://tv/executeOneShot', {}); if (!r?.imageUri) { console.log(`(foto recusada: ${JSON.stringify(r)})`); return null; }
            fs.writeFileSync(destino, Buffer.from(await (await fetch(r.imageUri)).arrayBuffer())); return destino; },
        fechar: () => { ponteiro.close(); ws.close(); },
    };
}

// ---------- DevTools (inspetor do app) ----------
async function inspetor() {
    let alvo;
    for (let i = 0; i < 40 && !alvo; i++) {
        try { alvo = (await (await fetch(`http://${IP}:9998/json/list`)).json()).find(p => p.url.includes(APP)); } catch { /* subindo */ }
        if (!alvo) await dormir(1000);
    }
    if (!alvo) throw new Error('App não apareceu no inspetor (porta 9998) — está instalado em modo dev e aberto?');
    const ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise(r => (ws.onopen = r));
    let n = 0; const pend = {}; const rede = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
        if (m.method === 'Network.requestWillBeSent') rede.push(m.params.request.url);
        pend[m.id]?.(m); };
    const call = (method, params) => new Promise(r => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
    // Chromium 53: sem awaitPromise — tudo síncrono, espera é por polling
    const js = async expr => { const r = (await call('Runtime.evaluate', { expression: expr, returnByValue: true })).result;
        if (r?.wasThrown) throw new Error(`JS na TV: ${r.result?.description}`); return r?.result?.value; };
    await call('Network.enable');
    return { js, call, rede, fechar: () => ws.close() };
}

// Espera uma expressão JS virar verdadeira; devolve ms ou null
async function ate(tv, expr, limite = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < limite) { if (await tv.js(expr)) return Date.now() - t0; await dormir(200); }
    return null;
}

const NAV = rotulo => `(function(){var b=[].slice.call(document.querySelectorAll(".nav-item")).filter(function(b){return ${JSON.stringify(rotulo)}===(b.getAttribute("aria-label")||b.textContent.trim())})[0];if(!b)return 0;b.click();return 1})()`;
const VIDEO_OK = '(function(){var v=document.querySelector("video");return !!v&&v.readyState>=3&&!v.paused})()';
// Cronômetro DENTRO da página (performance.now da TV): o polling pelo inspetor
// atrasa justo quando a TV está ocupada. Conta até o vídeo voltar a ANDAR
// (readyState>=3 e currentTime subindo) depois de ter parado/sumido; se nunca
// parou (troca sem engasgo), 0.
const CRONO = '(function(){if(window.__cronoT)clearInterval(window.__cronoT);var c=window.__crono={t0:performance.now(),ms:null,armado:false,ult:-1};window.__cronoT=setInterval(function(){var v=document.querySelector("video");var agora=performance.now()-c.t0;if(!(v&&v.readyState>=3&&!v.paused)){c.armado=true;c.ult=-1;return}if(!c.armado){if(agora>1500){c.ms=0;clearInterval(window.__cronoT)}return}if(c.ult>=0&&v.currentTime>c.ult){c.ms=Math.round(agora);clearInterval(window.__cronoT);return}c.ult=v.currentTime},100);return 1})()';
async function cronometrar(tv, acao, limite = 20000) {
    await tv.js(CRONO);
    await acao();
    const ok = await ate(tv, 'window.__crono.ms!=null', limite);
    await tv.js('clearInterval(window.__cronoT);1');
    return ok == null ? null : tv.js('window.__crono.ms');
}
const LATENCIA = 'window.__perf={lat:[],vis:[]};window.addEventListener("keydown",function(){var t=performance.now();requestAnimationFrame(function(){requestAnimationFrame(function(){__perf.lat.push(Math.round(performance.now()-t));var f=document.querySelector(".channel-card.tv-focused");var b=f&&f.getBoundingClientRect();__perf.vis.push(b&&b.top>=0&&b.bottom<=innerHeight?1:0)})})},true);1';

// Prévia com IMAGEM (não só áudio): desvio dos pixels dentro do <video> na foto da TV
async function temImagem(controle, tv, nome) {
    const caixa = await tv.js('(function(){var v=document.querySelector("video");if(!v)return null;var r=v.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom].map(Math.round)})()');
    if (!caixa) return null;
    // O quadro chega no plano de vídeo 1,5–5 s DEPOIS de o <video> já estar
    // andando (visto em 12/10/2026, no build novo e no antigo). Uma foto só
    // dava "preta" à toa — tenta por até ~8 s.
    for (let i = 0; i < 6; i++) {
        if (i) await dormir(1000);
        const r = await desvioDaFoto(controle, nome, caixa);
        if (r !== false) return r;
    }
    return false;
}
async function desvioDaFoto(controle, nome, caixa) {
    const foto = await controle.foto(path.join(ESTADO, `${nome}.jpg`));
    if (!foto) return null;
    const py = spawnSync('python3', ['-I', '-W', 'ignore', '-c', `import sys,statistics as s
from PIL import Image
l,t,r,b=map(int,sys.argv[2:6]); im=Image.open(sys.argv[1]).convert("L").crop((l+4,t+(b-t)*45//100,r-4,b-4)); print(round(s.pstdev(list(im.resize((64,20)).getdata())),1))`, foto, ...caixa.map(String)], { encoding: 'utf8' });
    const desvio = Number(py.stdout);
    // Metade de baixo: o selo AO VIVO (em cima) dava desvio alto até com a prévia preta.
    // Medido na LG: preta 0.2, com imagem ~34
    return py.status === 0 && Number.isFinite(desvio) ? desvio > 6 : null;
}

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const media = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;

// ---------- Cenários ----------
async function home(controle, tv) {
    const ttff = await cronometrar(tv, () => tv.js(NAV('Início')), 25000);
    await dormir(1500);
    return { home_prévia_ms: ttff, home_imagem: ttff == null ? false : await temImagem(controle, tv, 'home') };
}

async function grade(controle, tv) {
    const ttff = await cronometrar(tv, () => tv.js(NAV('TV Ao Vivo')));
    await ate(tv, '!!document.querySelector(".channel-card")', 20000);
    const imagem = ttff == null ? false : await temImagem(controle, tv, 'aovivo');
    await dormir(4000); // catálogo/EPG assentando
    await tv.js(LATENCIA);
    await controle.teclas(['LEFT', 'RIGHT']); // sidebar → grade
    await dormir(1500);
    await tv.js('__perf.lat.length=0;__perf.vis.length=0;1');
    const seq = [...Array(12).fill('DOWN'), ...Array(6).fill('RIGHT'), ...Array(12).fill('UP'), ...Array(6).fill('LEFT')];
    await controle.teclas(seq);
    await dormir(2500);
    const r = await tv.js('JSON.stringify({lat:__perf.lat,vis:__perf.vis,cards:document.querySelectorAll(".channel-card").length})');
    const { lat, vis, cards } = JSON.parse(r);
    return { aovivo_prévia_ms: ttff, aovivo_imagem: imagem, grade_mediana_ms: q(lat, 0.5), grade_p90_ms: q(lat, 0.9), grade_max_ms: lat.length ? Math.max(...lat) : null,
        grade_teclas_pct: Math.round(100 * lat.length / seq.length), grade_foco_visivel_pct: vis.length ? Math.round(100 * vis.reduce((a, b) => a + b, 0) / vis.length) : null, grade_cards: cards };
}

// Home → TV ao Vivo → Player → Voltar → Home: o MESMO <video> (uma conexão) e quanto tempo até voltar a tocar
async function troca(controle, tv) {
    const marca = '(function(){var v=document.querySelector("video");if(!v)return null;if(!v.__perf)v.__perf="V"+(window.__perfN=(window.__perfN||0)+1);return v.__perf})()';
    await tv.js(NAV('Início'));
    if (await ate(tv, VIDEO_OK, 25000) == null) return { troca_ok: false, troca_obs: 'prévia da Home não tocou' };
    const inicial = await tv.js(marca);
    tv.rede.length = 0;
    const passos = [
        ['aovivo', () => tv.js(NAV('TV Ao Vivo'))],
        ['player', () => tv.js('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(e){return /Assistir/.test(e.textContent)})[0];if(!b)return 0;b.click();return 1})()')],
        ['voltar', () => controle.teclas(['BACK'], 0)],
        ['home', () => tv.js(NAV('Início'))],
    ];
    const out = {}; let mesmo = true; const tempos = [];
    for (const [nome, acao] of passos) {
        const ms = await cronometrar(tv, acao, 15000);
        const tag = await tv.js(marca);
        if (tag !== inicial) mesmo = false;
        out[`troca_${nome}_ms`] = ms;
        if (ms != null) tempos.push(ms);
        await dormir(1500);
    }
    // Conexão nova = playlist mestre pedida de novo (as recargas de mídia ao vivo são .m3u8 também, então conta por URL distinta)
    const playlists = new Set(tv.rede.filter(u => /\.m3u8(\?|$)/.test(u)).map(u => u.split('?')[0])).size;
    return { ...out, troca_mesmo_video: mesmo, troca_media_ms: media(tempos), troca_playlists_distintas: playlists };
}

// CPU parado na TV ao Vivo com a prévia tocando (10s de perfil)
async function ocioso(controle, tv) {
    await tv.js(NAV('TV Ao Vivo'));
    // Sem prévia tocando (limite de conexão depois do zap) o perfil dava 0% e entrava na mediana
    if (await ate(tv, VIDEO_OK, 20000) == null) return { ocioso_obs: 'prévia não tocou' };
    await dormir(5000);
    await tv.call('Profiler.enable');
    await tv.call('Profiler.start');
    await dormir(10000);
    const p = (await tv.call('Profiler.stop')).result.profile;
    // Formato antigo (Chromium 53): árvore em `head`; o novo usa `nodes`
    const nos = p.nodes ?? (function plano(n, acc = []) { acc.push(n); (n.children || []).forEach(c => plano(c, acc)); return acc; })(p.head);
    const cont = {}; p.samples.forEach(s => (cont[s] = (cont[s] || 0) + 1));
    let ocioso = 0, gc = 0;
    for (const n of nos) { const nome = (n.callFrame || n).functionName; if (nome === '(idle)') ocioso += cont[n.id] || 0; if (nome === '(garbage collector)') gc += cont[n.id] || 0; }
    const mem = await tv.js('performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null');
    return { ocioso_cpu_pct: Math.round(100 * (1 - ocioso / p.samples.length)), ocioso_gc_pct: Math.round(100 * gc / p.samples.length), heap_mb: mem };
}

// Eventos do <video> com o relógio da TV. Escuta em captura no document:
// eventos de mídia não borbulham, e o <video> pode ser outro depois da troca
const EVENTOS = '(function(){if(window.__ev)return 1;window.__ev=[];["emptied","playing"].forEach(function(n){document.addEventListener(n,function(e){if(e.target.tagName==="VIDEO")__ev.push([n,performance.now()])},true)});return 1})()';
const ASSISTIR = '(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(e){return /Assistir/.test(e.textContent)})[0];if(!b)return 0;b.click();return 1})()';
const MARCA = '(function(){var v=document.querySelector("video");if(!v)return null;if(!v.__perf)v.__perf="V"+(window.__perfN=(window.__perfN||0)+1);return v.__perf})()';
const sessoes = tv => new Set(tv.rede.filter(u => /\.m3u8(\?|$)/.test(u)).map(u => u.split('?')[0])).size;

// Player da TV ao Vivo, CH+/CH− ×6 alternados: do `emptied` (começou a troca)
// ao `playing`. Alternar termina no canal de partida — CH+ ×5 deixava como
// "último canal" um que nem toca e a prévia das rodadas seguintes não subia
async function zap(controle, tv) {
    await tv.js(NAV('TV Ao Vivo'));
    if (await ate(tv, VIDEO_OK, 25000) == null) return { zap_obs: 'prévia não tocou' };
    await tv.js(ASSISTIR);
    if (await ate(tv, VIDEO_OK, 20000) == null) return { zap_obs: 'player não tocou' };
    await dormir(3000);
    await tv.js(EVENTOS);
    tv.rede.length = 0;
    const tempos = []; let falhas = 0;
    for (let i = 0; i < 6; i++) {
        await tv.js('__ev.length=0;1');
        await controle.teclas([i % 2 ? 'CHANNELDOWN' : 'CHANNELUP'], 0);
        // Limite de 1 conexão: o painel segura a anterior por até ~16 s
        const ok = await ate(tv, '(function(){var e=-1;for(var i=0;i<__ev.length;i++){if(__ev[i][0]==="emptied"&&e<0)e=__ev[i][1];if(__ev[i][0]==="playing"&&e>=0)return true}return false})()', 30000);
        const ms = ok == null ? null : await tv.js('(function(){var e=-1;for(var i=0;i<__ev.length;i++){if(__ev[i][0]==="emptied"&&e<0)e=__ev[i][1];if(__ev[i][0]==="playing"&&e>=0)return Math.round(__ev[i][1]-e)}return null})()');
        if (ms == null) falhas++; else tempos.push(ms);
        await dormir(3000);
    }
    await controle.teclas(['BACK']);
    await dormir(1500);
    return { zap_mediana_ms: q(tempos, 0.5), zap_max_ms: tempos.length ? Math.max(...tempos) : null, zap_falhas: falhas, zap_sessoes: sessoes(tv) };
}

// Prévia da TV ao Vivo → Assistir → Voltar: o vídeo tem que ficar no lugar
// (mesmo <video>, readyState sem cair, nenhuma sessão nova)
async function assistir(controle, tv) {
    await tv.js(NAV('TV Ao Vivo'));
    if (await ate(tv, VIDEO_OK, 25000) == null) return { assistir_obs: 'prévia não tocou' };
    await dormir(3000);
    const inicial = await tv.js(MARCA);
    const RS = 'window.__rs=4;if(window.__rsT)clearInterval(window.__rsT);window.__rsT=setInterval(function(){var v=document.querySelector("video");var r=v?v.readyState:0;if(r<__rs)__rs=r},50);1';
    tv.rede.length = 0;
    const out = {};
    for (const [nome, acao] of [['entrar', () => tv.js(ASSISTIR)], ['voltar', () => controle.teclas(['BACK'], 0)]]) {
        await tv.js(RS);
        await acao();
        await dormir(4000);
        out[`assistir_${nome}_rs_min`] = await tv.js('clearInterval(window.__rsT);__rs');
        out[`assistir_${nome}_mesmo_video`] = (await tv.js(MARCA)) === inicial;
    }
    return { ...out, assistir_sessoes: sessoes(tv) };
}

// ---------- Instalação (opcional) ----------
async function instalar(ipk) {
    const chave = path.join(os.tmpdir(), `tv-perf-${process.pid}`);
    const pass = process.env.TV_PASSPHRASE || (await new Promise(r => { process.stdout.write('Passphrase do Key Server (tela do Developer Mode): '); process.stdin.once('data', d => r(String(d).trim())); }));
    const res = await fetch(`http://${IP}:9991/webos_rsa`).catch(() => null);
    if (!res?.ok) throw new Error('Key Server não respondeu (ligue no app Developer Mode)');
    fs.writeFileSync(chave, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
    try {
        execFileSync('ssh-keygen', ['-p', '-P', pass.toUpperCase(), '-N', '', '-f', chave], { stdio: 'ignore' });
        const ssh = cmd => ['-p', '9922', '-i', chave, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'LogLevel=ERROR', '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa', `prisoner@${IP}`, cmd];
        execFileSync('ssh', ssh('mkdir -p /media/developer/temp && cat > /media/developer/temp/zapp.ipk'), { input: fs.readFileSync(ipk) });
        execFileSync('ssh', ssh(`sh -s ${APP} /media/developer/temp`), { input: fs.readFileSync(path.join(RAIZ, 'scripts/install-tv-remote.sh')) });
    } finally { fs.rmSync(chave, { force: true }); }
    console.log(`Instalado: ${path.basename(ipk)}`);
}

// ---------- Main ----------
const CENARIOS = { home, grade, troca, zap, assistir, ocioso };
if (opt('ipk')) await instalar(opt('ipk'));
const controle = await ssap();
const resultados = [];
for (let run = 1; run <= RUNS; run++) {
    // Cada rodada parte do app recém-aberto (mesma condição pra todo build)
    await controle.req('ssap://system.launcher/close', { id: APP }).catch(() => {});
    // Conta de 1 conexão: o painel demora a soltar a sessão do app fechado
    // (e o zap da rodada anterior); sem esperar, a prévia da Home não tocava
    await dormir(run > 1 ? 30000 : 2000);
    await controle.req('ssap://system.launcher/launch', { id: APP });
    const tv = await inspetor();
    await ate(tv, '!!document.querySelector(".nav-item")', 40000);
    await dormir(4000);
    const r = {};
    for (const nome of SO) {
        process.stdout.write(`rodada ${run}: ${nome}... `);
        try { Object.assign(r, await CENARIOS[nome](controle, tv)); console.log('ok'); }
        catch (e) { console.log(`falhou: ${e.message}`); r[`${nome}_erro`] = e.message; }
    }
    tv.fechar();
    resultados.push(r);
}
controle.fechar();

// Rodadas → um número por métrica (mediana; booleano = todas)
const chaves = [...new Set(resultados.flatMap(Object.keys))];
const final = Object.fromEntries(chaves.map(k => { const v = resultados.map(r => r[k]).filter(x => x != null);
    return [k, typeof v[0] === 'boolean' ? v.every(Boolean) : typeof v[0] === 'number' ? q(v, 0.5) : v[0] ?? null]; }));
const arqBase = path.join(ESTADO, 'baseline.json');
const base = fs.existsSync(arqBase) ? JSON.parse(fs.readFileSync(arqBase, 'utf8')) : null;
console.log(`\n${'métrica'.padEnd(28)}${'agora'.padStart(10)}${base ? 'baseline'.padStart(10) + 'Δ'.padStart(8) : ''}`);
for (const [k, v] of Object.entries(final)) {
    const b = base?.[k];
    const d = typeof v === 'number' && typeof b === 'number' && b !== 0 ? `${v > b ? '+' : ''}${Math.round(100 * (v - b) / b)}%` : '';
    console.log(`${k.padEnd(28)}${String(v).padStart(10)}${base ? String(b ?? '-').padStart(10) + d.padStart(8) : ''}`);
}
fs.writeFileSync(path.join(ESTADO, 'ultimo.json'), JSON.stringify({ quando: new Date().toISOString(), rodadas: resultados, final }, null, 2));
if (flag('save-baseline')) { fs.writeFileSync(arqBase, JSON.stringify(final, null, 2)); console.log(`\nBaseline salvo em ${path.relative(RAIZ, arqBase)}`); }
