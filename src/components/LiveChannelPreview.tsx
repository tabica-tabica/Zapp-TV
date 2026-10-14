// Preview de vídeo da ficha do canal (TV ao Vivo, Home, zap): usa o MESMO
// hook do player cheio (useHls.ts) mas sem nenhuma UI de controles/menu/retry
// em volta — só liga, toca, e se falhar deixa o chamador mostrar o fallback
// estático de sempre (logo). Nunca é o player de verdade: o botão "Assistir"
// continua abrindo VideoPlayer.tsx normalmente.

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type Hls from 'hls.js';
import { useHls } from '../hooks/useHls';
import { LIVE_START_TIMEOUT_MS, type StreamErrorCause } from '../services/playerDecisions';
import { pipelineEstacionado } from '../services/pipelineEstacionado';
import { naDesktop } from '../services/platformApp';
import { liveHealth } from '../services/liveHealth';
import { acompanhar, criarQuadro, desmontar, montar, quadroDe } from '../services/camadaVideo';

/** Pipeline vivo da prévia, pronto pro player assumir (ver useHls `adopt`). */
export interface LivePipeline {
    video: HTMLVideoElement;
    hls: Hls;
    /**
     * O <video> continua NO LUGAR (dentro da prévia, que segue montada e
     * escondida): o player só o põe em tela cheia por CSS. Sem mover, o webOS
     * não derruba o pipeline — nada de refazer MediaSource (era 5–16 s de
     * "carregando" no Assistir).
     */
    noLugar?: boolean;
}

export interface LiveChannelPreviewHandle {
    /** Entrega o <video> + hls.js tocando; null se a prévia ainda não está tocando. */
    handOff: () => LivePipeline | null;
    /** Reassume o pipeline que o player devolveu, se o <video> é o desta prévia (no lugar). */
    retomar: (pipeline: LivePipeline) => boolean;
}

interface LiveChannelPreviewProps {
    src: string;
    /**
     * A prévia não vai tocar: erro do stream (com a causa — 'connlimit' é o
     * painel recusando por limite de conexões) ou 'stall', quando não subiu em
     * LIVE_START_TIMEOUT_MS sem erro nenhum (stream pendurado).
     */
    onError?: (causa?: StreamErrorCause | 'stall') => void;
    /** Mudo por padrão; a TV ao Vivo liga o som (com botão de mudo). */
    muted?: boolean;
    /** URL da sessão aberta pela prévia — ver useHls `onResolvedUrl`. */
    onResolvedUrl?: (url: string) => void;
    /** O navegador barrou o autoplay com som e a prévia passou a tocar muda. */
    onAutoMuted?: () => void;
    /**
     * Pipeline devolvido pelo player ao fechar (o inverso do handOff): a prévia
     * assume o <video> + hls.js TOCANDO em vez de abrir outra conexão. Lido só
     * na montagem.
     */
    adopt?: LivePipeline | null;
    /**
     * Canal desta prévia: sem `adopt`, assume o pipeline que outra PÁGINA
     * estacionou pra este canal (Home ⇄ TV ao Vivo, ver pipelineEstacionado).
     */
    canalId?: number;
    /** Vai POR CIMA do vídeo (selo AO VIVO): o vídeo mora na camada, fora da página. */
    sobre?: ReactNode;
    ref?: Ref<LiveChannelPreviewHandle>;
}

export function LiveChannelPreview({ src, onError, muted = true, onResolvedUrl, onAutoMuted, adopt, canalId, sobre, ref }: LiveChannelPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [adotado] = useState<LivePipeline | null>(() => adopt ?? (canalId != null ? pipelineEstacionado.retirar(canalId) : null));
    // O <video> mora num quadro da camada (ver camadaVideo): o estacionado já
    // está lá (não move: nada de refazer o MediaSource); o devolvido pelo
    // player entra nele uma vez; sem nenhum, um quadro novo
    const [{ quadro, movido }] = useState(() => {
        const naCamada = adotado ? quadroDe(adotado.video) : null;
        return { quadro: naCamada ?? criarQuadro(adotado?.video), movido: !!adotado && !naCamada };
    });
    // Pipeline entregue (estacionado ou com o player): ao desmontar, o quadro fica
    const entregueRef = useRef(false);
    const slotRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        // Pelo ref (mutável) e ANTES do efeito do useHls, que lê o videoRef
        videoRef.current = quadro.video;
        // Devolvido pelo player em tela cheia (video-no-lugar): volta a ser prévia
        quadro.video.className = 'live-channel-preview-video';
        montar(quadro);
        entregueRef.current = false;
        return () => desmontar(quadro, entregueRef.current);
    }, [quadro]);
    useLayoutEffect(() => {
        const slot = slotRef.current;
        if (!slot || failed) return;
        return acompanhar(quadro, slot);
    }, [quadro, failed]);

    // A prévia avisa UMA vez que não vai tocar (erro OU relógio de partida):
    // dois avisos fariam a TV ao Vivo pular duas variantes de uma vez
    const avisouRef = useRef(false);
    const { handOff, retomar } = useHls({
        src,
        videoRef,
        autoPlay: true,
        isLive: true,
        preview: true,
        adopt: adotado?.hls,
        adoptMovido: movido,
        onResolvedUrl,
        onStreamError: (causa) => {
            if (avisouRef.current) return;
            avisouRef.current = true;
            setFailed(true);
            onError?.(causa);
        },
    });

    // Benchmark: a prévia SUBIU = essa variante está no ar. Sem isto só o
    // player (60s tocando) contava acerto, e a variante que o failover achou
    // nunca passava a ser a padrão. O adotado já foi contado por quem abriu.
    useEffect(() => {
        const video = videoRef.current;
        if (adotado || canalId == null || !video) return;
        const tocou = () => {
            if (video.readyState < 3 || video.currentTime <= 0) return;
            video.removeEventListener('timeupdate', tocou);
            liveHealth.registrar(canalId, 'ok');
        };
        video.addEventListener('timeupdate', tocou);
        return () => video.removeEventListener('timeupdate', tocou);
    }, [src, canalId, adotado]);

    // Stream pendurado não dá erro: sem isto a prévia ficava no preto pra
    // sempre e ninguém tentava outra variante
    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
    useEffect(() => {
        if (adotado) return; // já chega tocando
        const timer = setTimeout(() => {
            const video = videoRef.current;
            if (avisouRef.current || (video && video.readyState >= 3)) return;
            avisouRef.current = true;
            setFailed(true);
            onErrorRef.current?.('stall');
        }, LIVE_START_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [src, adotado]);

    useImperativeHandle(ref, () => ({
        handOff: () => {
            // Desktop (Tauri = WebKitGTK): MOVER o <video> tocando pra outro
            // lugar da página para o pipeline de mídia (GStreamer) — o player
            // abria parado. No Chromium funciona (no webOS o useHls refaz o
            // MediaSource depois de mover). Aqui não entrega nada e todo
            // mundo cai no caminho normal: o player abre pela URL da sessão
            // da prévia (mesma conexão no painel).
            if (naDesktop()) return null;
            const video = videoRef.current;
            // Só vale entregar o que já está tocando: um pipeline ainda
            // carregando não poupa nada e pode estar preso num erro
            if (!video || video.readyState < 3 || failed) return null;
            const hls = handOff();
            if (hls) entregueRef.current = true;
            return hls ? { video, hls } : null;
        },
        retomar: (pipeline) => {
            const video = videoRef.current;
            if (!video || pipeline.video !== video) return false;
            // O player trocou a classe (tela cheia); o React não volta a mexer
            // nela porque a prop não mudou
            video.className = 'live-channel-preview-video';
            video.muted = muted;
            entregueRef.current = false;
            retomar(pipeline.hls);
            return true;
        },
    }), [handOff, retomar, failed, muted]);

    // `muted` do React só vale na montagem; o botão de mudo muda depois
    useEffect(() => {
        const video = videoRef.current;
        if (video) video.muted = muted;
    }, [muted]);

    // Autoplay COM som pode ser barrado pelo navegador (sem gesto do usuário):
    // aí a prévia toca muda em vez de ficar parada
    const tocarMesmoBarrado = () => {
        const video = videoRef.current;
        if (!video || !video.paused) return;
        video.play().catch(() => {
            video.muted = true;
            onAutoMuted?.();
            video.play().catch(() => { });
        });
    };

    // Adotado chega TOCANDO — ou pausado, se passou uns instantes fora da
    // página (estacionado entre Home e TV ao Vivo): retoma. Depois do efeito
    // do `muted`, pra respeitar o mudo desta prévia.
    useEffect(() => {
        if (adotado) tocarMesmoBarrado();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
    }, [adotado]);

    // `canplay` pelo DOM: o <video> não é mais JSX
    const tocarRef = useRef(tocarMesmoBarrado);
    useEffect(() => { tocarRef.current = tocarMesmoBarrado; });
    useEffect(() => {
        const video = quadro.video;
        const aoPoder = () => tocarRef.current();
        video.addEventListener('canplay', aoPoder);
        return () => video.removeEventListener('canplay', aoPoder);
    }, [quadro]);

    if (failed) return null;

    // Só o lugar na página; o vídeo fica por cima, na camada
    return (
        <>
            <div ref={slotRef} className="live-channel-preview-video live-channel-preview-slot" />
            {sobre && createPortal(sobre, quadro.sobre)}
        </>
    );
}
