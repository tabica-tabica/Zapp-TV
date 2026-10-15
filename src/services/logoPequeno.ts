// Logos de canal em miniatura, feitas UMA vez e guardadas no IndexedDB.
//
// As logos do provedor são enormes pro lugar em que aparecem (~48 px): na TV
// ao Vivo, 40 delas somavam 3,5 MB, mediana 1200×696 e uma de 3500×3495
// (~49 MB decodificada). Cada linha nova da grade decodificava várias na
// thread principal da LG — suspeita forte dos picos de 2–4 s ao rolar. Aqui
// cada logo é baixada uma vez (no máximo 2 por vez: rajada de dezenas levava
// 429 do host), reduzida num canvas e guardada como WebP pequena. O host
// manda `Access-Control-Allow-Origin: *`, então o canvas não fica "sujo".
// Visto em 14/10/2026.

import { useEffect, useState } from 'react';
import { logoFalhou, logoEmEspera } from './logoFalho';

/** Maior lado da miniatura (2× o maior lugar onde a logo aparece). */
const LADO_MAX = 128;
const SIMULTANEAS = 2;
const BANCO = 'zapp-logos';
const LOJA = 'logos';

/** Tamanho da miniatura: cabe em `max`×`max` mantendo a proporção; nunca amplia. */
export function tamanhoMiniatura(largura: number, altura: number, max = LADO_MAX): [number, number] {
    if (largura <= 0 || altura <= 0) return [0, 0];
    const escala = Math.min(1, max / Math.max(largura, altura));
    return [Math.max(1, Math.round(largura * escala)), Math.max(1, Math.round(altura * escala))];
}

const prontas = new Map<string, string>();
const esperando = new Map<string, Array<(src: string | null) => void>>();
const fila: string[] = [];
let ativas = 0;

let bancoP: Promise<IDBDatabase | null> | null = null;
function banco(): Promise<IDBDatabase | null> {
    if (!bancoP) {
        bancoP = new Promise(resolve => {
            try {
                const req = indexedDB.open(BANCO, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null); // sem IndexedDB: só a memória da sessão
            }
        });
    }
    return bancoP;
}

async function lerDoBanco(url: string): Promise<string | null> {
    const db = await banco();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const req = db.transaction(LOJA).objectStore(LOJA).get(url);
            req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function gravarNoBanco(url: string, src: string): Promise<void> {
    const db = await banco();
    try {
        db?.transaction(LOJA, 'readwrite').objectStore(LOJA).put(src, url);
    } catch {
        // quota: a miniatura só não sobrevive ao app fechar
    }
}

/**
 * Miniatura WebP da logo; se não der pra fazer, a própria URL.
 *
 * O canvas exige a imagem com CORS (crossOrigin), e só o host que manda
 * `Access-Control-Allow-Origin` responde: no app desktop (tauri://localhost)
 * as logos de outros hosts (sites de logo, emissoras) eram recusadas e
 * NENHUMA aparecia — visto em 14/10/2026. Recusou com CORS: carrega sem e
 * usa a URL original, em tamanho cheio (sem miniatura, mas com logo).
 */
export function reduzir(url: string): Promise<string | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const [l, a] = tamanhoMiniatura(img.naturalWidth, img.naturalHeight);
                const canvas = document.createElement('canvas');
                canvas.width = l;
                canvas.height = a;
                const ctx = canvas.getContext('2d');
                if (!ctx || !l) return resolve(url);
                ctx.drawImage(img, 0, 0, l, a);
                // WebP onde o navegador grava (LG/Tizen gravam); senão sai PNG
                resolve(canvas.toDataURL('image/webp', 0.85));
            } catch {
                resolve(url);
            }
        };
        img.onerror = () => {
            const semCors = new Image();
            semCors.onload = () => resolve(url);
            semCors.onerror = () => resolve(null);
            semCors.src = url;
        };
        img.src = url;
    });
}

function terminar(url: string, src: string | null) {
    if (src) prontas.set(url, src);
    else logoFalhou(url);
    esperando.get(url)?.forEach(cb => cb(src));
    esperando.delete(url);
}

function andarFila() {
    while (ativas < SIMULTANEAS && fila.length) {
        const url = fila.shift()!;
        ativas++;
        void reduzir(url).then(src => {
            ativas--;
            if (src) void gravarNoBanco(url, src);
            terminar(url, src);
            andarFila();
        });
    }
}

function pedir(url: string, cb: (src: string | null) => void): () => void {
    const lista = esperando.get(url);
    if (lista) lista.push(cb);
    else {
        esperando.set(url, [cb]);
        void lerDoBanco(url).then(salva => {
            if (salva) return terminar(url, salva);
            fila.push(url);
            andarFila();
        });
    }
    return () => {
        const l = esperando.get(url);
        if (!l) return;
        const i = l.indexOf(cb);
        if (i >= 0) l.splice(i, 1);
        // Ninguém mais quer (a linha saiu da tela): tira da fila se não começou
        if (!l.length) {
            const j = fila.indexOf(url);
            if (j >= 0) {
                fila.splice(j, 1);
                esperando.delete(url);
            }
        }
    };
}

/** Miniatura da logo, ou undefined enquanto não fica pronta (ou se falhou). */
export function useLogoPequeno(url: string | null | undefined): string | undefined {
    const [chegou, setChegou] = useState<{ url: string; src?: string } | null>(null);
    useEffect(() => {
        if (!url || prontas.has(url) || logoEmEspera(url)) return;
        return pedir(url, src => setChegou({ url, src: src ?? undefined }));
    }, [url]);
    if (!url) return undefined;
    return prontas.get(url) ?? (chegou?.url === url ? chegou.src : undefined);
}
