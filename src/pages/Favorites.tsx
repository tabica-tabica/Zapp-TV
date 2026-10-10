// Favorites Page - Matching NeoStream Desktop Style

import { useCallback, useMemo, useState } from 'react';
import { FaChild, FaStar } from 'react-icons/fa';
import { Grid, type CellComponentProps } from 'react-window';
import { RemoteColorHint } from '../components/RemoteColorHint';
import { storage, type FavoriteItem } from '../services/storage';
import { api } from '../services/api';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useVirtualGridNavigation } from '../hooks/useVirtualGridNavigation';
import { useMeasuredColumns } from '../hooks/useMeasuredColumns';
import { useVariantFailover } from '../hooks/useVariantFailover';
import { useFocusZone } from '../contexts/FocusContext';
import { kidsFilter } from '../services/kidsFilter';
import { VideoPlayer } from '../components/VideoPlayer';
import { CatalogCard } from '../components/CatalogCard/CatalogCard';
import './Favorites.css';

interface FavoritesProps {
    onNavigate?: (page: string) => void;
}

const CARD_WIDTH = 200;
const CARD_GAP = 24;
const CARD_INFO_HEIGHT = 76;
// Vermelho — tema original do Favorites (o do MyList é teal, o default do CatalogCard).
const ACCENT_RGB = '239, 68, 68';

const rotuloDoTipo = () => 'Canal';

// Só canais: filmes/séries favoritados continuam no storage (alimentam as
// recomendações da Home e o badge de episódio novo), mas não aparecem aqui.
const getChannelFavorites = () => storage.getFavorites().filter(item => item.type === 'channel');

interface FavoritesCellProps {
    items: FavoriteItem[];
    columns: number;
    focusedIndex: number;
    removingId: string | null;
    gap: number;
    onSelect: (item: FavoriteItem) => void;
    onRemove: (item: FavoriteItem) => void;
}

function FavoritesCell({
    rowIndex, columnIndex, style, items, columns, focusedIndex, removingId, gap, onSelect, onRemove,
}: CellComponentProps<FavoritesCellProps>) {
    const index = rowIndex * columns + columnIndex;
    const item = items[index];
    if (!item) return null;
    return (
        <CatalogCard
            item={item}
            focused={index === focusedIndex}
            removing={removingId === item.id}
            onSelect={onSelect}
            onRemove={onRemove}
            style={style}
            gap={gap}
            accentRgb={ACCENT_RGB}
            typeBadge={rotuloDoTipo}
        />
    );
}

export function Favorites({ onNavigate }: FavoritesProps) {
    const [items, setItems] = useState<FavoriteItem[]>(getChannelFavorites);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const { focusZone, setFocusZone } = useFocusZone();
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());

    const [playingChannel, setPlayingChannel] = useState<FavoriteItem | null>(null);

    // Focus states for TV navigation ('header' = o botão "Limpar Tudo")
    const [focusArea, setFocusArea] = useState<'header' | 'items'>('items');
    // Confirmação de dois toques pro "Limpar Tudo" (mesmo padrão do reset das
    // Configurações): apagar a lista inteira sem confirmar seria cruel
    const [clearArmed, setClearArmed] = useState(false);
    const { containerRef: gridContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 8,
    });

    const loadItems = useCallback(() => {
        setItems(getChannelFavorites());
    }, []);

    // Limpa só os canais — clearFavorites() levaria junto filmes/séries
    const clearAll = () => {
        for (const item of getChannelFavorites()) storage.removeFavorite(item.id, item.type);
        loadItems();
    };

    const channelFailover = useVariantFailover(
        playingChannel && { stream_id: playingChannel.id, name: playingChannel.title },
        next => setPlayingChannel(prev => prev && { ...prev, id: String(next.stream_id), title: next.name }),
    );

    const openItem = useCallback((item: FavoriteItem) => setPlayingChannel(item), []);

    const {
        focusedIndex, setFocusedIndex, gridRef, handleNavigate: handleGridNavigate, handleSelect: handleGridSelect,
    } = useVirtualGridNavigation({
        itemCount: items.length,
        columns,
        enabled: focusArea === 'items',
        onExitUp: () => setFocusArea('header'),
        onExitLeft: () => setFocusZone('sidebar'),
        onSelect: (index) => {
            const item = items[index];
            if (item) openItem(item);
        },
    });

    const removeItem = useCallback((item: FavoriteItem) => {
        setRemovingId(item.id);
        setTimeout(() => {
            storage.removeFavorite(item.id, item.type);
            loadItems();
            setRemovingId(null);
        }, 300);
    }, [loadItems]);

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        setClearArmed(false); // sair da linha cancela a confirmação
        if (kidsActive) {
            if (direction === 'left') setFocusZone('sidebar');
            return;
        }
        if (items.length === 0) {
            if (direction === 'left') setFocusZone('sidebar');
            return;
        }

        if (focusArea === 'header') {
            if (direction === 'left') {
                setFocusZone('sidebar');
            } else if (direction === 'down') {
                setFocusArea('items');
                setFocusedIndex(0);
            }
        } else if (focusArea === 'items') {
            handleGridNavigate(direction);
        }
    };

    const handleEnter = () => {
        if (kidsActive) return;
        if (items.length === 0) {
            onNavigate?.('live');
            return;
        }

        if (focusArea === 'header') {
            // Apagar tudo é irreversível: o primeiro OK arma, o segundo faz
            if (clearArmed) {
                clearAll();
                setClearArmed(false);
            } else {
                setClearArmed(true);
            }
        } else if (focusArea === 'items') {
            handleGridSelect();
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: () => {
            // Sem isto a tecla nao fazia nada e o usuario ficava preso na
            // pagina. Voltar devolve o foco pra sidebar; de la vai pra Home.
            setFocusZone('sidebar');
        },
        onAction: (action) => {
            // 🔴 remove o item em foco — mesma convenção do resto do app
            if (action !== 'red' || focusArea !== 'items') return;
            const item = items[focusedIndex];
            if (item) removeItem(item);
        },
        enabled: focusZone === 'content' && !playingChannel,
    });

    // Altura da linha: pôster 2:3 + a faixa de título/nota + o gap entre linhas.
    const cardHeight = Math.round((columnWidth - CARD_GAP) * 1.5) + CARD_INFO_HEIGHT + CARD_GAP;
    const rowCount = Math.max(1, Math.ceil(items.length / columns));
    const favoritesCellProps = useMemo<FavoritesCellProps>(() => ({
        items: items,
        columns,
        focusedIndex: focusArea === 'items' ? focusedIndex : -1,
        removingId,
        gap: CARD_GAP,
        onSelect: openItem,
        onRemove: removeItem,
    }), [items, columns, focusArea, focusedIndex, removingId, openItem, removeItem]);

    // Perfil Kids: listas sao globais do aparelho e podem conter conteudo
    // adulto salvo por outros perfis — bloqueadas no modo Kids
    if (kidsActive) {
        return (
            <div className="favorites-page">
                <div className="favorites-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon"><FaChild /></div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Indisponível no perfil Kids</h2>
                    <p className="empty-text">
                        Troque para um perfil adulto para acessar esta página.
                    </p>
                </div>
            </div>
        );
    }

    // Empty State
    if (items.length === 0) {
        return (
            <div className="favorites-page">
                <div className="favorites-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon"><FaStar /></div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Nenhum canal favorito ainda</h2>
                    <p className="empty-text">
                        Seus canais favoritos aparecerão aqui.
                        Favorite um canal na <strong>TV ao Vivo</strong> para adicioná-lo.
                    </p>
                    <div className="empty-suggestions">
                        <button
                            className="suggestion-btn tv-focused"
                            onClick={() => onNavigate?.('live')}
                        >
                            <span>TV ao Vivo</span>
                            <span>Explorar Canais</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="favorites-page">
            <div className="favorites-backdrop" />

            {/* Header */}
            <header className="favorites-header">
                <div className="header-title">
                    <div className="title-icon"><FaStar /></div>
                    <div>
                        <h1>Canais Favoritos</h1>
                        <p className="subtitle">{items.length} {items.length === 1 ? 'canal' : 'canais'}</p>
                    </div>
                </div>
                {items.length > 0 && (
                    <button
                        className={`clear-btn ${focusArea === 'header' ? 'tv-focused' : ''} ${clearArmed ? 'armed' : ''}`}
                        onClick={clearAll}
                    >
                        <span>Excluir</span>
                        <span>{clearArmed ? 'OK de novo apaga' : 'Limpar Tudo'}</span>
                    </button>
                )}
            </header>

            {/* Cards Grid — virtualizado (react-window), mesmo padrão do MyList. */}
            <div className="cards-grid" ref={gridContainerRef}>
                <Grid
                    className="cards-grid-viewport"
                    gridRef={gridRef}
                    cellComponent={FavoritesCell}
                    cellProps={favoritesCellProps}
                    columnCount={columns}
                    columnWidth={columnWidth}
                    rowCount={rowCount}
                    rowHeight={cardHeight}
                    overscanCount={1}
                    style={{ height: '100%', width: '100%' }}
                />
            </div>

            {/* Footer Hints */}
            <div className="favorites-hints">
                <span>Setas Navegar</span>
                <span>OK Selecionar</span>
                <RemoteColorHint color="red" label="Remover" />
                <span>Voltar</span>
            </div>

            {/* Live Channel Player */}
            {playingChannel && (
                <VideoPlayer
                    src={api.getLiveStreamUrl(Number(playingChannel.id))}
                    title={playingChannel.title}
                    poster={playingChannel.poster}
                    isLive
                    autoPlay
                    contentType="live"
                    {...channelFailover}
                    onClose={() => setPlayingChannel(null)}
                />
            )}

        </div>
    );
}
