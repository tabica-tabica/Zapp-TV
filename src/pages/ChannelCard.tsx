// Card de canal — extraído de LiveTV.tsx pra virar cellComponent do
// react-window e pra que React.memo tenha algo memoizável.

import { memo, type CSSProperties } from 'react';
import { FaBroadcastTower, FaStar, FaHistory } from 'react-icons/fa';
import type { LiveStream } from '../types';
import { channelDisplayName } from '../services/channelVariants';
import { useLogoPequeno } from '../services/logoPequeno';
import './ChannelCard.css';


export interface ChannelCardProps {
    stream: LiveStream;
    focused: boolean;
    selected: boolean;
    isFavorite: boolean;
    broken: boolean;
    onImageError: (id: number) => void;
    onSelect: (stream: LiveStream) => void;
    /** Style absoluto de posicionamento que o react-window injeta na célula. */
    style?: CSSProperties;
    gap?: number;
}

function ChannelCardImpl({
    stream, focused, selected, isFavorite, broken, onImageError, onSelect, style, gap = 12,
}: ChannelCardProps) {
    const logo = useLogoPequeno(broken ? null : stream?.stream_icon);
    return (
        <div className="channel-card-cell" style={style}>
            <div
                className={[
                    'channel-card',
                    focused ? 'tv-focused' : '',
                    selected ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--channel-card-gap': `${gap}px` } as CSSProperties}
                onClick={() => onSelect(stream)}
            >
                <div className="channel-logo">
                    {!logo ? (
                        <span className="channel-placeholder"><FaBroadcastTower /></span>
                    ) : (
                        <img
                            src={logo}
                            alt={stream?.name ? channelDisplayName(stream.name) : 'Canal'}
                            onError={() => onImageError(stream.stream_id)}
                        />
                    )}
                </div>
                <div className="channel-info">
                    <div className="channel-name">
                        {isFavorite && <span className="channel-fav"><FaStar /> </span>}
                        {stream?.name ? channelDisplayName(stream.name) : 'Canal Sem Nome'}
                        {Number(stream.tv_archive) > 0 && <span className="channel-catchup"> <FaHistory /></span>}
                    </div>
                </div>
                <div className="channel-live-indicator" />
            </div>
        </div>
    );
}

// react-window 2 cria um `style` NOVO por célula a cada render da grade — com
// o memo padrão, cada seta no controle redesenhava TODOS os cards (e os SVGs
// de ícone). Compara o style por valor; o resto segue raso.
function mesmoCard(a: ChannelCardProps, b: ChannelCardProps): boolean {
    for (const k of Object.keys(b) as (keyof ChannelCardProps)[]) {
        if (k !== 'style' && a[k] !== b[k]) return false;
    }
    const sa = a.style || {}, sb = b.style || {};
    const ks = Object.keys(sb) as (keyof CSSProperties)[];
    return ks.length === Object.keys(sa).length && ks.every(k => sa[k] === sb[k]);
}

export const ChannelCard = memo(ChannelCardImpl, mesmoCard);
