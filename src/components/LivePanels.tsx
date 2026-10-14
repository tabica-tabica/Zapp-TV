// Painel da TV ao vivo (backlog item 7): "Agora nos favoritos" — programa
// atual + progresso de cada canal ⭐, com EPG sob demanda e teto de canais
// pra não estourar a TV. O painel "Jogos de hoje" (item 12) saiu em
// 14/10/2026: virou o modo Jogos da grade.

import { useState, useEffect, useRef } from 'react';
import { FaStar, FaTimes } from 'react-icons/fa';
import { epgService, type ChannelEpg } from '../services/epgService';
import { RemoteColorHint } from './RemoteColorHint';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { channelDisplayName } from '../services/channelVariants';
import type { LiveStream } from '../types';
import './LivePanels.css';

const MAX_FAVORITES = 20; // teto de requisições numa TV fraca

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

interface FavoritesNowPanelProps {
    channels: LiveStream[];
    onClose: () => void;
    onPlay: (channel: LiveStream) => void;
    /** Modo reordenar (item 17): ←→ movem o canal focado */
    onMove?: (channel: LiveStream, direction: -1 | 1) => void;
}

export function FavoritesNowPanel({ channels, onClose, onPlay, onMove }: FavoritesNowPanelProps) {
    const [epgByChannel, setEpgByChannel] = useState<Map<number, ChannelEpg | null>>(new Map());
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [reordering, setReordering] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const visible = channels.slice(0, MAX_FAVORITES);

    // EPG de cada favorito, em sequência (paralelo derruba TV fraca)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const channel of visible) {
                if (cancelled) return;
                const epg = await epgService.getChannelEpg(channel.stream_id);
                if (cancelled) return;
                setEpgByChannel(prev => new Map(prev).set(channel.stream_id, epg));
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channels.length]);

    useEffect(() => {
        const focused = listRef.current?.querySelector('.fav-now-row.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const safeIndex = Math.min(focusedIndex, Math.max(0, visible.length - 1));

    useTVNavigation({
        onNavigate: (direction) => {
            if (visible.length === 0) return;
            if (direction === 'up') setFocusedIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setFocusedIndex(prev => Math.min(visible.length - 1, prev + 1));
            else if (reordering && onMove && (direction === 'left' || direction === 'right')) {
                const channel = visible[safeIndex];
                if (!channel) return;
                onMove(channel, direction === 'left' ? -1 : 1);
                setFocusedIndex(prev => Math.max(0, Math.min(visible.length - 1, prev + (direction === 'left' ? -1 : 1))));
            }
        },
        onEnter: () => {
            const channel = visible[safeIndex];
            if (channel) onPlay(channel);
        },
        onBack: onClose,
        onAction: (action) => {
            // 🟡 alterna o modo reordenar (item 17)
            if (action === 'yellow' && onMove) setReordering(prev => !prev);
        },
    });

    return (
        <div className="live-panel-overlay">
            <div className="live-panel">
                <div className="live-panel-header">
                    <h2 className="live-panel-title"><FaStar /> Agora nos favoritos</h2>
                    <button className="live-panel-close" onClick={onClose}><FaTimes /></button>
                </div>

                <div ref={listRef} className="live-panel-list">
                    {visible.length === 0 && (
                        <div className="live-panel-empty">
                            Nenhum canal favorito ainda. Marque canais com <FaStar /> na TV ao vivo.
                        </div>
                    )}
                    {visible.map((channel, index) => {
                        const entry = epgByChannel.get(channel.stream_id);
                        const program = entry?.now;
                        const next = entry?.next;
                        const pct = program ? epgService.progressPct(program) ?? 0 : 0;
                        return (
                            <div
                                key={channel.stream_id}
                                className={`fav-now-row ${safeIndex === index ? 'tv-focused' : ''} ${reordering ? 'reordering' : ''}`}
                                onClick={() => onPlay(channel)}
                            >
                                <span className="fav-now-name">{channelDisplayName(channel.name)}</span>
                                <span className="fav-now-program">
                                    {program ? program.title : (epgByChannel.has(channel.stream_id) ? 'Sem programação' : 'Carregando…')}
                                </span>
                                {program && (
                                    <>
                                        <span className="fav-now-time">
                                            {formatClock(program.start)}–{formatClock(program.end)}
                                        </span>
                                        <span className="fav-now-progress">
                                            <span className="fav-now-progress-fill" style={{ width: `${pct}%` }} />
                                        </span>
                                    </>
                                )}
                                {next && <span className="fav-now-next">A seguir: {next.title}</span>}
                                {reordering && <span className="fav-now-move">↔</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="live-panel-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK Assistir</span>
                    {onMove && (reordering
                        ? <RemoteColorHint color="yellow" label="Sair de reordenar · ←→ Mover" />
                        : <RemoteColorHint color="yellow" label="Reordenar" />)}
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}
