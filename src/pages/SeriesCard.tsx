// Card de série — extraído de Series.tsx pra virar cellComponent do
// react-window e pra que React.memo tenha algo memoizável (a página inteira
// não conta: ela re-renderiza sempre que o próprio estado dela muda, que é
// exatamente quando as listas de card re-renderizavam também).

import { memo, type CSSProperties } from 'react';
import { FaTv, FaStar } from 'react-icons/fa';
import type { Series as SeriesType } from '../types';
import './SeriesCard.css';

const STAGGER_BUCKETS = 8;

export type SeriesCardBadge = 'episodes' | 'new' | null;

export interface SeriesCardProps {
    item: SeriesType;
    /** Posição na lista completa — define o bucket de stagger. */
    index: number;
    focused: boolean;
    selected: boolean;
    broken: boolean;
    badge: SeriesCardBadge;
    onSelect: (item: SeriesType) => void;
    onImageError: (id: number) => void;
    /** Style absoluto de posicionamento que o react-window injeta na célula. */
    style?: CSSProperties;
    gap?: number;
}

function SeriesCardImpl({
    item, index, focused, selected, broken, badge, onSelect, onImageError, style, gap = 16,
}: SeriesCardProps) {
    return (
        <div className="series-card-cell" style={style}>
            <div
                className={[
                    'series-card',
                    `stagger-${index % STAGGER_BUCKETS}`,
                    focused ? 'tv-focused' : '',
                    selected ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--series-card-gap': `${gap}px` } as CSSProperties}
                onClick={() => onSelect(item)}
            >
                <div className="series-poster">
                    {broken ? (
                        <div className="poster-placeholder"><FaTv /></div>
                    ) : (
                        <img
                            decoding="async"
                            src={item.cover}
                            alt={item.name}
                            loading="lazy"
                            onError={() => onImageError(item.series_id)}
                        />
                    )}
                    {badge === 'episodes' ? (
                        <div className="new-badge new-badge-episodes">NOVOS EPS</div>
                    ) : badge === 'new' ? (
                        <div className="new-badge">NOVO</div>
                    ) : null}
                    {item.rating && parseFloat(item.rating) > 0 && (
                        <div className="series-rating"><FaStar /> {item.rating}</div>
                    )}
                </div>
                <div className="series-title">{item?.name || 'Série Sem Nome'}</div>
            </div>
        </div>
    );
}

export const SeriesCard = memo(SeriesCardImpl);
