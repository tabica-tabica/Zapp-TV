// Card de filme — extraído de Movies.tsx pra virar cellComponent do
// react-window e pra que React.memo tenha algo memoizável.

import { memo, type CSSProperties } from 'react';
import { FaFilm, FaStar } from 'react-icons/fa';
import type { VODStream } from '../types';
import { tagsOf } from '../services/vodVariants';
import { posterThumb } from '../services/tmdb';
import './MovieCard.css';


export interface MovieCardProps {
    movie: VODStream;
    focused: boolean;
    selected: boolean;
    broken: boolean;
    isNew: boolean;
    versionCount: number;
    /** Alguma OUTRA versão do grupo é legendada: o selo diz "LEG" em vez de "N versões" */
    temLegendada?: boolean;
    onSelect: (movie: VODStream) => void;
    onImageError: (id: number) => void;
    /** Style absoluto de posicionamento que o react-window injeta na célula. */
    style?: CSSProperties;
    gap?: number;
}

function MovieCardImpl({
    movie, focused, selected, broken, isNew, versionCount, temLegendada = false, onSelect, onImageError, style, gap = 16,
}: MovieCardProps) {
    // Chamado uma vez só (antes cada card chamava tagsOf duas vezes — uma
    // pra decidir SE mostra o selo, outra pra montar o texto dele).
    const tags = tagsOf(movie.name || '').filter(t => t !== 'H265');

    return (
        <div className="movie-card-cell" style={style}>
            <div
                className={[
                    'movie-card',
                    focused ? 'tv-focused' : '',
                    selected ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--movie-card-gap': `${gap}px` } as CSSProperties}
                onClick={() => onSelect(movie)}
                // Título inteiro: o do card corta com reticências
                title={movie.name}
            >
                <div className="movie-poster">
                    {/* Sem capa: <img src=""> não dispara onError (texto alternativo numa caixa vazia) */}
                    {broken || !(movie.stream_icon || movie.cover) ? (
                        <div className="poster-placeholder"><FaFilm /></div>
                    ) : (
                        <img
                            decoding="async"
                            src={posterThumb(movie.stream_icon || movie.cover)}
                            alt={movie.name}
                            loading="lazy"
                            onError={() => onImageError(movie.stream_id)}
                        />
                    )}
                    {isNew && <div className="new-badge">NOVO</div>}
                    {versionCount > 1 && (
                        <div className="version-badge">{temLegendada ? 'LEG' : `${versionCount} versões`}</div>
                    )}
                    {tags.length > 0 && (
                        <div className="tag-badge">{tags.slice(0, 2).join(' ')}</div>
                    )}
                    {movie.rating && parseFloat(movie.rating) > 0 && (
                        <div className="movie-rating"><FaStar /> {movie.rating}</div>
                    )}
                </div>
                <div className="movie-title">{movie?.name || 'Filme Sem Nome'}</div>
            </div>
        </div>
    );
}

export const MovieCard = memo(MovieCardImpl);
