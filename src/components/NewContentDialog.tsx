// Diálogo "Novo conteúdo disponível": lista o que o provedor acrescentou
// desde o último "Recarregar lista" (newContentService.checkForNewContent).
// Modelado em ChannelAgendaOverlay.tsx — lista rolável com foco por D-pad.

import { useEffect, useRef, useState } from 'react';
import { FaBroadcastTower, FaFilm, FaTimes, FaTv } from 'react-icons/fa';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import type { NewContentItem, NewContentType } from '../services/newContentService';
import './NewContentDialog.css';

interface NewContentDialogProps {
    items: NewContentItem[];
    onClose: () => void;
}

// Corta a lista rolável por seção — evita rolagem D-pad inviável quando o
// provedor acrescenta centenas de itens de uma vez. O cabeçalho da seção
// sempre mostra a contagem REAL, mesmo com a lista cortada.
const MAX_PER_SECTION = 50;

const SECTION_ORDER: NewContentType[] = ['live', 'vod', 'series'];
const SECTION_ICON: Record<NewContentType, typeof FaTv> = {
    live: FaBroadcastTower,
    vod: FaFilm,
    series: FaTv,
};

export function NewContentDialog({ items, onClose }: NewContentDialogProps) {
    const { t } = useTranslation();
    const [focusedIndex, setFocusedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const sectionLabel: Record<NewContentType, string> = {
        live: t('new_content_channels_label'),
        vod: t('new_content_movies_label'),
        series: t('new_content_series_label'),
    };

    const sections = SECTION_ORDER
        .map(type => ({ type, all: items.filter(item => item.type === type) }))
        .filter(section => section.all.length > 0);

    // Lista achatada (só o que é de fato renderável/focável) pra navegação D-pad
    const flatItems = sections.flatMap(section => section.all.slice(0, MAX_PER_SECTION));

    useEffect(() => {
        const focused = listRef.current?.querySelector('.new-content-item.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    useTVNavigation({
        onNavigate: (direction) => {
            if (flatItems.length === 0) return;
            if (direction === 'up') setFocusedIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setFocusedIndex(prev => Math.min(flatItems.length - 1, prev + 1));
        },
        onEnter: onClose,
        onBack: onClose,
    });

    let flatIndex = -1;

    return (
        <div className="new-content-overlay">
            <div className="new-content-panel">
                <div className="new-content-header">
                    <h2 className="new-content-title">{t('new_content_title')}</h2>
                    <button className="new-content-close" onClick={onClose}><FaTimes /></button>
                </div>

                <div ref={listRef} className="new-content-list">
                    {sections.map(section => {
                        const Icon = SECTION_ICON[section.type];
                        const shown = section.all.slice(0, MAX_PER_SECTION);
                        const extra = section.all.length - shown.length;
                        return (
                            <div key={section.type} className="new-content-section">
                                <div className="new-content-section-title">
                                    <Icon /> {sectionLabel[section.type]} ({section.all.length})
                                </div>
                                {shown.map(item => {
                                    flatIndex++;
                                    const isFocused = flatIndex === focusedIndex;
                                    return (
                                        <div
                                            key={`${item.type}-${item.id}`}
                                            className={`new-content-item ${isFocused ? 'tv-focused' : ''}`}
                                        >
                                            {item.name}
                                        </div>
                                    );
                                })}
                                {extra > 0 && (
                                    <div className="new-content-more">
                                        +{extra} {t('new_content_more')}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="new-content-hint">
                    <span>{t('new_content_hint')}</span>
                </div>
            </div>
        </div>
    );
}
