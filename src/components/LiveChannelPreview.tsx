// Preview de vídeo da ficha do canal (TV ao Vivo, Home, zap): usa o MESMO
// hook do player cheio (useHls.ts) mas sem nenhuma UI de controles/menu/retry
// em volta — só liga, toca, e se falhar deixa o chamador mostrar o fallback
// estático de sempre (logo). Nunca é o player de verdade: o botão "Assistir"
// continua abrindo VideoPlayer.tsx normalmente.

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type Hls from 'hls.js';
import { useHls } from '../hooks/useHls';

/** Pipeline vivo da prévia, pronto pro player assumir (ver useHls `adopt`). */
export interface LivePipeline {
    video: HTMLVideoElement;
    hls: Hls;
}

export interface LiveChannelPreviewHandle {
    /** Entrega o <video> + hls.js tocando; null se a prévia ainda não está tocando. */
    handOff: () => LivePipeline | null;
}

interface LiveChannelPreviewProps {
    src: string;
    onError?: () => void;
    /** Mudo por padrão; a TV ao Vivo liga o som (com botão de mudo). */
    muted?: boolean;
    /** URL da sessão aberta pela prévia — ver useHls `onResolvedUrl`. */
    onResolvedUrl?: (url: string) => void;
    /** O navegador barrou o autoplay com som e a prévia passou a tocar muda. */
    onAutoMuted?: () => void;
    ref?: Ref<LiveChannelPreviewHandle>;
}

export function LiveChannelPreview({ src, onError, muted = true, onResolvedUrl, onAutoMuted, ref }: LiveChannelPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);

    const { handOff } = useHls({
        src,
        videoRef,
        autoPlay: true,
        isLive: true,
        onResolvedUrl,
        onStreamError: () => {
            setFailed(true);
            onError?.();
        },
    });

    useImperativeHandle(ref, () => ({
        handOff: () => {
            const video = videoRef.current;
            // Só vale entregar o que já está tocando: um pipeline ainda
            // carregando não poupa nada e pode estar preso num erro
            if (!video || video.readyState < 3 || failed) return null;
            const hls = handOff();
            return hls ? { video, hls } : null;
        },
    }), [handOff, failed]);

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

    if (failed) return null;

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
