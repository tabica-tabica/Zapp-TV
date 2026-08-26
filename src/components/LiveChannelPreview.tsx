// Preview de vídeo mudo da ficha do canal (TV ao Vivo, item da sessão): usa
// o MESMO hook do player cheio (useHls.ts) mas sem nenhuma UI de controles/
// menu/retry em volta — só liga, toca mudo, e se falhar deixa o chamador
// mostrar o fallback estático de sempre (logo). Nunca é o player de verdade:
// o botão "Assistir" continua abrindo VideoPlayer.tsx normalmente.

import { useRef, useState } from 'react';
import { useHls } from '../hooks/useHls';

interface LiveChannelPreviewProps {
    src: string;
    onError?: () => void;
}

export function LiveChannelPreview({ src, onError }: LiveChannelPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);

    useHls({
        src,
        videoRef,
        autoPlay: true,
        isLive: true,
        onStreamError: () => {
            setFailed(true);
            onError?.();
        },
    });

    if (failed) return null;

    return (
        <video
            ref={videoRef}
            className="live-channel-preview-video"
            muted
            playsInline
        />
    );
}
