// Prévia de canal ao vivo na Home — último canal assistido, ou (sem
// histórico ainda) uma sugestão aleatória dentre os visíveis por padrão
// (ver src/services/liveVisibility.ts). Vídeo mudo/autoplay de verdade,
// reaproveitando o MESMO componente que a ficha de canal da TV ao Vivo usa
// (LiveChannelPreview.tsx) — se o stream falhar, cai no logo estático.
// EPG "Agora" é preenchido depois, de forma assíncrona (chamada de rede
// de verdade) — não atrasa o primeiro render da Home.
//
// Ao lado da prévia (o "muito espaço sobrando" da fileira), uma fileira de
// OUTROS canais só com a capa (HomeChannelCoverRow/-Card) — clicar um deles
// troca QUAL canal está tocando na prévia grande (não navega); clicar de
// novo na prévia (agora já mostrando aquele canal) é que abre o player de
// verdade. O <section>/título ficam em Home.tsx — dependem de qual canal
// está selecionado (o rótulo "Continue assistindo"/"Sugestão" muda com a
// seleção, não é fixo por canal).

import { useEffect, useState } from 'react';
import { FaBroadcastTower, FaPlay } from 'react-icons/fa';
import { LiveChannelPreview } from '../components/LiveChannelPreview';
import { api } from '../services/api';
import { epgService } from '../services/epgService';
import { channelDisplayName } from '../services/channelVariants';
import type { LiveStream } from '../types';
import './HomeChannelPreview.css';

interface HomeChannelPreviewProps {
    channel: LiveStream;
    focused: boolean;
    onWatch: () => void;
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function HomeChannelPreview({ channel, focused, onWatch }: HomeChannelPreviewProps) {
    const [failed, setFailed] = useState(false);
    const [nowTitle, setNowTitle] = useState<string | null>(null);
    const [nowTime, setNowTime] = useState<string | null>(null);
    const [imgBroken, setImgBroken] = useState(false);

    // Sem reset manual de estado aqui: o chamador (Home.tsx) usa
    // `key={channel.stream_id}` — trocar de canal REMONTA o componente
    // inteiro, então failed/nowTitle/nowTime/imgBroken já nascem limpos.
    useEffect(() => {
        let cancelled = false;
        epgService.getChannelEpg(channel.stream_id).then(epg => {
            if (cancelled || !epg.now) return;
            setNowTitle(epg.now.title);
            setNowTime(`${formatClock(epg.now.start)} – ${formatClock(epg.now.end)}`);
        }).catch(() => {
            // Sem EPG pra esse canal — a prévia continua só com o nome, sem drama.
        });
        return () => { cancelled = true; };
    }, [channel.stream_id]);

    const src = channel.direct_source || api.getLiveStreamUrl(channel.stream_id);

    return (
        <button
            className={`home-channel-preview ${focused ? 'tv-focused' : ''}`}
            onClick={onWatch}
        >
            <div className="home-channel-preview-video">
                {!failed ? (
                    <LiveChannelPreview
                        key={channel.stream_id}
                        src={src}
                        onError={() => setFailed(true)}
                    />
                ) : (
                    <div className="home-channel-preview-fallback">
                        {imgBroken || !channel.stream_icon ? (
                            <FaBroadcastTower />
                        ) : (
                            <img
                                decoding="async"
                                src={channel.stream_icon}
                                alt={channel.name}
                                onError={() => setImgBroken(true)}
                            />
                        )}
                    </div>
                )}
                <div className="home-channel-preview-live-badge">
                    <span className="live-dot" />
                    <span>AO VIVO</span>
                </div>
            </div>
            <div className="home-channel-preview-info">
                <span className="home-channel-preview-name">{channelDisplayName(channel.name)}</span>
                {nowTitle && (
                    <span className="home-channel-preview-epg">
                        AGORA: {nowTitle}{nowTime ? ` · ${nowTime}` : ''}
                    </span>
                )}
                <span className="home-channel-preview-play"><FaPlay /> Assistir</span>
            </div>
        </button>
    );
}

interface HomeChannelCoverRowProps {
    channels: LiveStream[];
    /** índice focado DENTRO desta fileira (0-based), ou -1 se nenhum item dela está focado. */
    focusedIndex: number;
    onSelect: (channel: LiveStream) => void;
}

/** Fileira de "outros canais" só com a capa (logo) — clicar troca a prévia grande, sem navegar. */
export function HomeChannelCoverRow({ channels, focusedIndex, onSelect }: HomeChannelCoverRowProps) {
    if (channels.length === 0) return null;
    return (
        <div className="home-channel-cover-row">
            {channels.map((channel, index) => (
                <HomeChannelCoverCard
                    key={channel.stream_id}
                    channel={channel}
                    focused={focusedIndex === index}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

interface HomeChannelCoverCardProps {
    channel: LiveStream;
    focused: boolean;
    onSelect: (channel: LiveStream) => void;
}

function HomeChannelCoverCard({ channel, focused, onSelect }: HomeChannelCoverCardProps) {
    const [broken, setBroken] = useState(false);
    return (
        <button
            className={`home-channel-cover ${focused ? 'tv-focused' : ''}`}
            onClick={() => onSelect(channel)}
            title={channelDisplayName(channel.name)}
        >
            <div className="home-channel-cover-logo">
                {broken || !channel.stream_icon ? (
                    <FaBroadcastTower />
                ) : (
                    <img
                        decoding="async"
                        loading="lazy"
                        src={channel.stream_icon}
                        alt=""
                        onError={() => setBroken(true)}
                    />
                )}
            </div>
            <span className="home-channel-cover-name">{channelDisplayName(channel.name)}</span>
        </button>
    );
}
