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

import { useEffect, useState, type Ref } from 'react';
import { FaBroadcastTower, FaPlay } from 'react-icons/fa';
import { LiveChannelPreview, type LiveChannelPreviewHandle } from '../components/LiveChannelPreview';
import { api } from '../services/api';
import { liveHealth } from '../services/liveHealth';
import { epgService } from '../services/epgService';
import { channelDisplayName } from '../services/channelVariants';
import { useTranslation } from '../hooks/useTranslation';
import type { LiveStream } from '../types';
import type { StreamErrorCause } from '../hooks/useHls';
import { useLogoPequeno } from '../services/logoPequeno';
import './HomeChannelPreview.css';

interface HomeChannelPreviewProps {
    channel: LiveStream;
    focused: boolean;
    onWatch: () => void;
    /** Pra a Home estacionar o stream tocando ao sair da página (ver pipelineEstacionado) */
    previewRef?: Ref<LiveChannelPreviewHandle>;
    /** Prévia não subiu: true se a Home trocou pra outra variante (senão, logo) */
    onFailed?: (causa?: StreamErrorCause | 'stall') => boolean;
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function HomeChannelPreview({ channel, focused, onWatch, previewRef, onFailed }: HomeChannelPreviewProps) {
    const [failed, setFailed] = useState(false);
    const [nowTitle, setNowTitle] = useState<string | null>(null);
    const [nowTime, setNowTime] = useState<string | null>(null);
    const [imgBroken, setImgBroken] = useState(false);
    const logo = useLogoPequeno(imgBroken ? null : channel.stream_icon);
    const { t } = useTranslation();

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
                        ref={previewRef}
                        key={channel.stream_id}
                        src={src}
                        // Vindo da TV ao Vivo neste canal: assume o stream que ela estacionou
                        canalId={channel.stream_id}
                        onError={(causa) => {
                            // Benchmark: limite de conexões não é culpa do canal
                            if (causa !== 'connlimit') liveHealth.registrar(channel.stream_id, 'falha');
                            if (!onFailed?.(causa)) setFailed(true);
                        }}
                        // O mesmo selo de baixo, por cima do vídeo (que mora na camada)
                        sobre={<div className="home-channel-preview-live-badge"><span className="live-dot" /><span>{t('home_live_badge')}</span></div>}
                    />
                ) : (
                    <div className="home-channel-preview-fallback">
                        {!logo ? (
                            <FaBroadcastTower />
                        ) : (
                            <img
                                src={logo}
                                alt={channel.name}
                                onError={() => setImgBroken(true)}
                            />
                        )}
                    </div>
                )}
                <div className="home-channel-preview-live-badge">
                    <span className="live-dot" />
                    <span>{t('home_live_badge')}</span>
                </div>
            </div>
            <div className="home-channel-preview-info">
                <span className="home-channel-preview-name">{channelDisplayName(channel.name)}</span>
                {nowTitle && (
                    <span className="home-channel-preview-epg">
                        {t('home_live_now')}: {nowTitle}{nowTime ? ` · ${nowTime}` : ''}
                    </span>
                )}
                <span className="home-channel-preview-play"><FaPlay /> {t('home_watch')}</span>
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
    const logo = useLogoPequeno(broken ? null : channel.stream_icon);
    return (
        <button
            className={`home-channel-cover ${focused ? 'tv-focused' : ''}`}
            onClick={() => onSelect(channel)}
            title={channelDisplayName(channel.name)}
        >
            <div className="home-channel-cover-logo">
                {!logo ? (
                    <FaBroadcastTower />
                ) : (
                    <img
                        src={logo}
                        alt=""
                        onError={() => setBroken(true)}
                    />
                )}
            </div>
            <span className="home-channel-cover-name">{channelDisplayName(channel.name)}</span>
        </button>
    );
}
