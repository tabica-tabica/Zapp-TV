// Card compartilhado pelas 7 fileiras da Home — extraído de 7 blocos JSX
// quase idênticos. `React.memo` só funciona porque `onSelect` é um
// `useCallback` estável POR FILEIRA (não por card) e `item` vem direto do
// array de estado (referência estável entre renders não relacionados).

import { memo, useState, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { posterThumb } from '../services/tmdb';

export interface HomeCardProps<T> {
    item: T;
    index: number;
    focused: boolean;
    title: string;
    image: string;
    /** Ícone do pôster de reserva quando a imagem falha (FaFilm/FaTv). Omitido = só o fundo. */
    fallbackIcon?: IconType;
    onSelect: (item: T) => void;
    /** Classe extra no <button> raiz — hoje só 'top10-card'. */
    cardClassName?: string;
    /** Sibling ANTES de .card-image — hoje só o rank do Top 10. */
    rankBadge?: ReactNode;
    /** DENTRO de .card-image, depois do <img> — selo "NOVOS EPS" ou barra de progresso. */
    imageOverlay?: ReactNode;
    /** Acrescentado ao final do título — hoje só "T1 · E2" do Continuar Assistindo. */
    subtitle?: ReactNode;
}

function HomeCardImpl<T>({
    item, focused, title, image, fallbackIcon: FallbackIcon, onSelect, cardClassName, rankBadge, imageOverlay, subtitle,
}: HomeCardProps<T>) {
    const [broken, setBroken] = useState(false);
    return (
        <button
            className={['content-card', cardClassName, focused ? 'tv-focused' : ''].filter(Boolean).join(' ')}
            onClick={() => onSelect(item)}
        >
            {rankBadge}
            <div className="card-image card-image-poster">
                {broken || !image ? (
                    <div className="card-image-fallback">
                        {FallbackIcon && <FallbackIcon />}
                    </div>
                ) : (
                    <img
                        decoding="async"
                        loading="lazy"
                        src={posterThumb(image)}
                        alt={title}
                        onError={() => setBroken(true)}
                    />
                )}
                {imageOverlay}
            </div>
            <div className="card-title">
                {title}
                {subtitle}
            </div>
        </button>
    );
}

export const HomeCard = memo(HomeCardImpl) as typeof HomeCardImpl;
