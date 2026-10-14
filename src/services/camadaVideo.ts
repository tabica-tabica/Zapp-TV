// Camada única do vídeo ao vivo das prévias (Home ⇄ TV ao Vivo).
//
// webOS 4 (Chromium 53): <video> que sai do documento — e MOVER é sair e
// entrar — perde o pipeline de mídia, e o hls.js tinha que refazer o
// MediaSource (recoverMediaError): 6–11 s de preto a cada troca de página.
// A página que sai desmonta, e o <video> morava dentro dela.
//
// Aqui o <video> mora num QUADRO fora da árvore do React (filho do <body>),
// criado uma vez e NUNCA movido. A prévia só marca um "slot" na página e o
// quadro fica por cima dele (position: fixed). Página saindo: o quadro some
// (visibility) e o pipeline estaciona TOCANDO; a página que entra assume o
// mesmo quadro e o põe por cima do slot dela. Sem mover, sem refazer nada.
//
// Por cima da página (z-index 15: acima da ficha da TV ao Vivo, z 10, abaixo
// de menus e overlays, 20+). O que cobre o slot sem ter z maior (modal de
// z baixo, sidebar aberta) é pego pelo elementFromPoint no meio do slot: aí o
// quadro some. O que tem que aparecer POR CIMA do vídeo (selo AO VIVO) vai
// pro `sobre` do quadro (portal). O player usa o mesmo <video> em tela cheia
// pela classe `video-no-lugar` (fixed, sai do quadro sem mover).

export interface Quadro {
    el: HTMLDivElement;
    video: HTMLVideoElement;
    /** Alvo de portal pro que vai por cima do vídeo */
    sobre: HTMLDivElement;
}

let camada: HTMLDivElement | null = null;
const porVideo = new WeakMap<HTMLVideoElement, Quadro>();
const emUso = new Set<Quadro>();
const acompanhados = new Map<Quadro, HTMLElement>();

function obterCamada(): HTMLDivElement {
    if (!camada) {
        camada = document.createElement('div');
        camada.className = 'camada-video';
        document.body.appendChild(camada);
    }
    return camada;
}

/**
 * Quadro novo (fora do documento até `montar`). Com `video`, embrulha um que
 * veio de fora (o do player) — esse sim vai ser movido uma vez, ao montar.
 */
export function criarQuadro(video?: HTMLVideoElement): Quadro {
    const el = document.createElement('div');
    el.className = 'camada-video-quadro';
    el.style.visibility = 'hidden';
    const v = video ?? document.createElement('video');
    v.className = 'live-channel-preview-video';
    v.playsInline = true;
    const sobre = document.createElement('div');
    sobre.className = 'camada-video-sobre';
    const quadro = { el, video: v, sobre };
    porVideo.set(v, quadro);
    return quadro;
}

/** O quadro em que este <video> já mora (estacionado ou devolvido pelo player). */
export function quadroDe(video: HTMLVideoElement): Quadro | null {
    const q = porVideo.get(video);
    return q && q.el.parentNode === camada && q.video.parentNode === q.el ? q : null;
}

/** Põe o quadro na camada (idempotente) e o marca em uso. */
export function montar(q: Quadro): void {
    limparOrfaos();
    if (q.video.parentNode !== q.el) q.el.insertBefore(q.video, q.el.firstChild);
    if (q.sobre.parentNode !== q.el) q.el.appendChild(q.sobre);
    if (q.el.parentNode !== obterCamada()) obterCamada().appendChild(q.el);
    emUso.add(q);
}

/**
 * Prévia desmontando. `fica` = o pipeline seguiu vivo com outro dono
 * (estacionado ou com o player): o quadro só some. Senão sai da camada.
 */
export function desmontar(q: Quadro, fica: boolean): void {
    parar(q);
    emUso.delete(q);
    if (!fica) q.el.remove();
}

/** Tira da camada quadros sem dono cujo <video> já foi zerado (player fechou sem devolver). */
function limparOrfaos(): void {
    if (!camada) return;
    for (const el of Array.from(camada.children)) {
        const video = el.firstElementChild as HTMLVideoElement | null;
        const q = video && porVideo.get(video);
        if (!q || emUso.has(q)) continue;
        if (!video!.getAttribute('src') && !video!.classList.contains('video-no-lugar')) el.remove();
    }
}

/** O quadro vai pra cima do slot e acompanha (rolagem, foco, overlays). */
export function acompanhar(q: Quadro, slot: HTMLElement): () => void {
    acompanhados.set(q, slot);
    ligarOuvintes();
    agendar();
    return () => parar(q);
}

function parar(q: Quadro): void {
    if (!acompanhados.delete(q)) return;
    q.el.style.visibility = 'hidden';
    if (!acompanhados.size) desligarOuvintes();
}

/** Some se o slot não está inteiro na tela ou se algo o cobre (no meio). */
export function slotVisivel(slot: HTMLElement, r: { left: number; top: number; right: number; bottom: number; width: number; height: number },
    tela: { largura: number; altura: number }, noPonto: (x: number, y: number) => Element | null): boolean {
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.left < -1 || r.top < -1 || r.right > tela.largura + 1 || r.bottom > tela.altura + 1) return false;
    const alvo = noPonto(r.left + r.width / 2, r.top + r.height / 2);
    return !!alvo && (alvo === slot || slot.contains(alvo));
}

const ultimo = new WeakMap<Quadro, string>();
function posicionar(q: Quadro, slot: HTMLElement): void {
    // Player em tela cheia com este <video>: a classe dele manda
    if (q.video.classList.contains('video-no-lugar')) {
        q.el.style.visibility = '';
        ultimo.delete(q);
        return;
    }
    const r = slot.getBoundingClientRect();
    const ve = slotVisivel(slot, r, { largura: window.innerWidth, altura: window.innerHeight },
        (x, y) => document.elementFromPoint(x, y));
    const chave = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${ve}`;
    if (ultimo.get(q) === chave) return;
    ultimo.set(q, chave);
    const s = q.el.style;
    s.left = `${Math.round(r.left)}px`;
    s.top = `${Math.round(r.top)}px`;
    s.width = `${Math.round(r.width)}px`;
    s.height = `${Math.round(r.height)}px`;
    s.visibility = ve ? 'visible' : 'hidden';
}

let quadroAgendado = 0;
function agendar(): void {
    if (quadroAgendado) return;
    // Dois quadros: depois da tecla, o React ainda vai renderizar
    quadroAgendado = requestAnimationFrame(() => {
        quadroAgendado = requestAnimationFrame(() => {
            quadroAgendado = 0;
            acompanhados.forEach((slot, q) => posicionar(q, slot));
        });
    });
}

let rede: ReturnType<typeof setInterval> | null = null;
const EVENTOS = ['scroll', 'keydown', 'transitionend', 'animationend', 'resize'];
function ligarOuvintes(): void {
    if (rede) return;
    EVENTOS.forEach(e => window.addEventListener(e, agendar, true));
    // Rede de segurança pro que nenhum evento avisa (layout que muda sozinho)
    rede = setInterval(agendar, 500);
}
function desligarOuvintes(): void {
    if (!rede) return;
    EVENTOS.forEach(e => window.removeEventListener(e, agendar, true));
    clearInterval(rede);
    rede = null;
}

/**
 * Player em tela cheia com este <video> (`video-no-lugar`, z 9998). O quadro
 * (z 15) é contexto de empilhamento: preso nele, o vídeo ficava por baixo da
 * sidebar e da barra da página (visto na TV em 14/10/2026). Sobe o quadro
 * junto enquanto dura; devolve como desfazer.
 *
 * Desfazer também tira o `video-no-lugar`: player fechado sem devolver o
 * pipeline (Voltar no meio de um CH±) zerava o src mas deixava a classe, e o
 * <video> morto ficava em tela cheia por cima da Home mostrando o pôster
 * (logo do canal) — antes da camada ele saía junto com a ficha.
 */
export function elevarQuadro(video: HTMLVideoElement): () => void {
    const q = porVideo.get(video);
    if (q) q.el.style.zIndex = '9998';
    return () => {
        if (q) q.el.style.zIndex = '';
        video.classList.remove('video-no-lugar');
    };
}

/** Pipeline estacionado que ninguém assumiu: o quadro sai junto. */
export function descartarVideo(video: HTMLVideoElement): void {
    const q = porVideo.get(video);
    if (q && !emUso.has(q)) q.el.remove();
}
