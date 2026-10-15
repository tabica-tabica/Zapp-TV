// Card de pôster compartilhado por MyList e Favorites — mesmo markup, mesmas
// classes, mesmo botão de remover com stopPropagation, que antes viviam
// duplicados em cada página. `React.memo` só funciona aqui porque os
// callbacks (onSelect/onRemove/onPlay) são estáveis (useCallback na página).

import { memo, type CSSProperties, type ReactNode } from 'react';
import { FaFilm, FaTv, FaBroadcastTower, FaTrashAlt, FaPlay, FaStar } from 'react-icons/fa';
import type { SavedContentItem } from '../../services/storage';
import { posterThumb } from '../../services/tmdb';
import './CatalogCard.css';


function iconeDoTipo(type: SavedContentItem['type']): ReactNode {
    if (type === 'movie') return <FaFilm />;
    if (type === 'series') return <FaTv />;
    return <FaBroadcastTower />;
}

export interface CatalogCardProps {
    item: SavedContentItem;
    focused: boolean;
    removing?: boolean;
    onSelect: (item: SavedContentItem) => void;
    onRemove: (item: SavedContentItem) => void;
    /**
     * Atalho de play direto do card (MyList). Omitido em páginas onde o
     * próprio clique no card já basta (Favorites: canal toca na hora, filme/
     * série abrem a ficha) — sem essa prop o botão simplesmente não existe,
     * em vez de aparecer sem função.
     */
    onPlay?: (item: SavedContentItem) => void;
    /** Style absoluto de posicionamento que o react-window injeta na célula (top/left/width/height). */
    style?: CSSProperties;
    /**
     * Espaço visual entre cards, em px. A célula do react-window fica
     * encostada na vizinha (sem isso não há como o grid saber o "gap" real);
     * o card visível ocupa `calc(100% - gap)` dentro da célula, deixando a
     * folga no canto inferior-direito de cada um — mesmo efeito visual de um
     * CSS grid com `gap`, sem depender de margin (que não funciona bem em
     * caixas posicionadas de forma absoluta).
     */
    gap?: number;
    /** Cor de destaque (foco/hover/botões), "R, G, B". Default: teal do MyList. */
    accentRgb?: string;
    /** Rótulo do tipo (badge + placeholder sem pôster). Default: ícone (MyList); Favorites passa texto. */
    typeBadge?: (type: SavedContentItem['type']) => ReactNode;
}

function CatalogCardImpl({
    item, focused, removing, onSelect, onRemove, onPlay, style, gap = 24,
    accentRgb = '20, 184, 166', typeBadge = iconeDoTipo,
}: CatalogCardProps) {
    return (
        <div className="catalog-card-cell" style={style}>
            <div
                className={[
                    'catalog-card',
                    removing ? 'removing' : '',
                    focused ? 'tv-focused' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--catalog-card-gap': `${gap}px`, '--catalog-card-accent': accentRgb } as CSSProperties}
                onClick={() => onSelect(item)}
            >
                <div className="catalog-card-poster">
                    {item.poster ? (
                        <img decoding="async" loading="lazy" src={posterThumb(item.poster)} alt={item.title} />
                    ) : (
                        <div className="catalog-card-poster-placeholder">{typeBadge(item.type)}</div>
                    )}
                    <div className="catalog-card-type">{typeBadge(item.type)}</div>
                    <div className="catalog-card-overlay">
                        {/* No canto de cima, longe do ▶ do centro: logo acima
                            dele, um clique um pouco alto tirava o título da lista */}
                        <button
                            className="catalog-card-remove-btn"
                            onClick={(e) => { e.stopPropagation(); onRemove(item); }}
                            title="Remover da lista"
                            aria-label="Remover da lista"
                        >
                            <FaTrashAlt />
                        </button>
                        {onPlay && (
                            <button
                                className="catalog-card-play-btn"
                                onClick={(e) => { e.stopPropagation(); onPlay(item); }}
                            >
                                <FaPlay />
                            </button>
                        )}
                    </div>
                </div>
                <div className="catalog-card-info">
                    <h3 className="catalog-card-title">{item.title}</h3>
                    <div className="catalog-card-meta">
                        {item.year && <span>{item.year}</span>}
                        {item.rating && <span><FaStar className="catalog-card-rating-icon" /> {item.rating}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export const CatalogCard = memo(CatalogCardImpl);
