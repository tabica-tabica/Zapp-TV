// Card de canal — extraído de LiveTV.tsx pra virar cellComponent do
// react-window e pra que React.memo tenha algo memoizável.

import { memo, type CSSProperties } from 'react';
import { FaBroadcastTower, FaStar, FaHistory } from 'react-icons/fa';
import type { LiveStream } from '../types';
import { channelDisplayName } from '../services/channelVariants';
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
                    {broken || !stream?.stream_icon ? (
                        <span className="channel-placeholder"><FaBroadcastTower /></span>
                    ) : (
                        <img
                            decoding="async"
                            loading="lazy"
                            src={stream.stream_icon}
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

export const ChannelCard = memo(ChannelCardImpl);
