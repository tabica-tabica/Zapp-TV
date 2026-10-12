// Preview de vídeo da ficha do canal (TV ao Vivo, Home, zap): usa o MESMO
// hook do player cheio (useHls.ts) mas sem nenhuma UI de controles/menu/retry
// em volta — só liga, toca, e se falhar deixa o chamador mostrar o fallback
// estático de sempre (logo). Nunca é o player de verdade: o botão "Assistir"
// continua abrindo VideoPlayer.tsx normalmente.

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type Hls from 'hls.js';
import { useHls } from '../hooks/useHls';
import { LIVE_START_TIMEOUT_MS, type StreamErrorCause } from '../services/playerDecisions';
import { pipelineEstacionado } from '../services/pipelineEstacionado';
import { naDesktop } from '../services/platformApp';
import { liveHealth } from '../services/liveHealth';

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
    ref?: Ref<LiveChannelPreviewHandle>;
}

export function LiveChannelPreview({ src, onError, muted = true, onResolvedUrl, onAutoMuted, adopt, canalId, ref }: LiveChannelPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    // Mesmo truque do player: o <video> adotado entra no host no MESMO commit
    // em que o player sai da tela, e segue tocando sem engasgar
    const [adotado] = useState<LivePipeline | null>(() => adopt ?? (canalId != null ? pipelineEstacionado.retirar(canalId) : null));
    const hostRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!adotado || !host) return;
        // Pelo ref (mutável); o valor do useState não pode ser mexido
        videoRef.current = adotado.video;
        const video = videoRef.current;
        host.appendChild(video);
        video.className = 'live-channel-preview-video';
        video.playsInline = true;
    }, [adotado]);

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
            return hls ? { video, hls } : null;
        },
        retomar: (pipeline) => {
            const video = videoRef.current;
            if (!video || pipeline.video !== video) return false;
            // O player trocou a classe (tela cheia); o React não volta a mexer
            // nela porque a prop não mudou
            video.className = 'live-channel-preview-video';
            video.muted = muted;
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

    if (failed) return null;

    if (adotado) return <div ref={hostRef} className="live-channel-preview-host" />;

    return (
        <video
            ref={videoRef}
            className="live-channel-preview-video"
            muted={muted}
            playsInline
            onCanPlay={tocarMesmoBarrado}
        />
    );
}
