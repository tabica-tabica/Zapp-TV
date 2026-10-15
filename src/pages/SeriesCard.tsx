// Card de série — extraído de Series.tsx pra virar cellComponent do
// react-window e pra que React.memo tenha algo memoizável (a página inteira
// não conta: ela re-renderiza sempre que o próprio estado dela muda, que é
// exatamente quando as listas de card re-renderizavam também).

import { memo, type CSSProperties } from 'react';
import { FaTv, FaStar } from 'react-icons/fa';
import type { Series as SeriesType } from '../types';
import { posterThumb } from '../services/tmdb';
import './SeriesCard.css';


export type SeriesCardBadge = 'episodes' | 'new' | null;

export interface SeriesCardProps {
    item: SeriesType;
    focused: boolean;
    selected: boolean;
    broken: boolean;
    badge: SeriesCardBadge;
    /** Versões do mesmo título (dublada, [L], 4K) agrupadas neste card */
    versionCount?: number;
    onSelect: (item: SeriesType) => void;
    onImageError: (id: number) => void;
    /** Style absoluto de posicionamento que o react-window injeta na célula. */
    style?: CSSProperties;
    gap?: number;
}

function SeriesCardImpl({
    item, focused, selected, broken, badge, versionCount = 0, onSelect, onImageError, style, gap = 16,
}: SeriesCardProps) {
    return (
        <div className="series-card-cell" style={style}>
            <div
                className={[
                    'series-card',
                    focused ? 'tv-focused' : '',
                    selected ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--series-card-gap': `${gap}px` } as CSSProperties}
                onClick={() => onSelect(item)}
            >
                <div className="series-poster">
                    {/* Sem capa: <img src=""> não dispara onError e o WebKit
                        desenhava o texto alternativo numa caixa vazia */}
                    {broken || !item.cover ? (
                        <div className="poster-placeholder"><FaTv /></div>
                    ) : (
                        <img
                            decoding="async"
                            src={posterThumb(item.cover)}
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
                    {versionCount > 1 && <div className="version-badge">{versionCount} versões</div>}
                </div>
                <div className="series-title">{item?.name || 'Série Sem Nome'}</div>
            </div>
        </div>
    );
}

export const SeriesCard = memo(SeriesCardImpl);
