// Favorites Page - Matching NeoStream Desktop Style

import { useCallback, useMemo, useState } from 'react';
import { FaChild, FaHeart } from 'react-icons/fa';
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
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { VideoPlayer } from '../components/VideoPlayer';
import { CatalogCard } from '../components/CatalogCard/CatalogCard';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './Favorites.css';

interface FavoritesProps {
    onNavigate?: (page: string) => void;
}

const CARD_WIDTH = 200;
const CARD_GAP = 24;
const CARD_INFO_HEIGHT = 76;
// Vermelho — tema original do Favorites (o do MyList é teal, o default do CatalogCard).
const ACCENT_RGB = '239, 68, 68';

function rotuloDoTipo(type: FavoriteItem['type']): string {
    if (type === 'movie') return 'Filme';
    if (type === 'series') return 'Série';
    return 'Canal';
}

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
            index={index}
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
    const [items, setItems] = useState<FavoriteItem[]>(() => storage.getFavorites());
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series' | 'channels'>('all');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const { focusZone, setFocusZone } = useFocusZone();
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());

    // Playback / modal
    const [modalItem, setModalItem] = useState<FavoriteItem | null>(null);
    const [playingMovie, setPlayingMovie] = useState<FavoriteItem | null>(null);
    const [playingChannel, setPlayingChannel] = useState<FavoriteItem | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Focus states for TV navigation
    const [focusArea, setFocusArea] = useState<'tabs' | 'items'>('items');
    // Confirmação de dois toques pro "Limpar Tudo" (mesmo padrão do reset das
    // Configurações): apagar a lista inteira sem confirmar seria cruel
    const [clearArmed, setClearArmed] = useState(false);
    const [focusedTabIndex, setFocusedTabIndex] = useState(0);
    const [emptyFocusIndex, setEmptyFocusIndex] = useState(0);
    const { containerRef: gridContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 8,
    });

    const loadItems = useCallback(() => {
        const saved = storage.getFavorites();
        setItems(saved);
    }, []);

    const clearAll = () => {
        storage.clearFavorites();
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');
    const channels = items.filter(item => item.type === 'channel');

    const displayItems = activeTab === 'all' ? items :
        activeTab === 'movies' ? movies :
            activeTab === 'series' ? series : channels;

    const tabs = ['all', 'movies', 'series', 'channels'] as const;
    // Slots da faixa do cabeçalho: as abas + "Limpar Tudo" (que só existe
    // quando há algo pra limpar — slot invisível vira parada morta do D-pad)
    const headerSlots = tabs.length + (items.length > 0 ? 1 : 0);

    const channelFailover = useVariantFailover(
        playingChannel && { stream_id: playingChannel.id, name: playingChannel.title },
        next => setPlayingChannel(prev => prev && { ...prev, id: String(next.stream_id), title: next.name }),
    );

    // Abrir item: canal toca direto; filme/série abrem a ficha
    const openItem = useCallback((item: FavoriteItem) => {
        if (item.type === 'channel') {
            setPlayingChannel(item);
        } else {
            setModalItem(item);
        }
    }, []);

    const {
        focusedIndex, setFocusedIndex, gridRef, handleNavigate: handleGridNavigate, handleSelect: handleGridSelect,
    } = useVirtualGridNavigation({
        itemCount: displayItems.length,
        columns,
        enabled: focusArea === 'items',
        onExitUp: () => setFocusArea('tabs'),
        onExitLeft: () => setFocusZone('sidebar'),
        onSelect: (index) => {
            const item = displayItems[index];
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

    const playSeriesEpisode = async (item: FavoriteItem, season?: number, episode?: number) => {
        try {
            const queue = await buildEpisodeQueue(item.id, item.title, item.poster, season, episode);
            if (queue) {
                setSeriesQueue(queue);
                setModalItem(null);
            }
        } catch (err) {
            console.error('Error building episode queue:', err);
        }
    };

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        setClearArmed(false); // sair da linha cancela a confirmação
        if (kidsActive) {
            if (direction === 'left') setFocusZone('sidebar');
            return;
        }
        if (items.length === 0) {
            if (direction === 'left') {
                if (emptyFocusIndex === 0) setFocusZone('sidebar');
                else setEmptyFocusIndex(0);
            } else if (direction === 'right') {
                setEmptyFocusIndex(1);
            }
            return;
        }

        if (focusArea === 'tabs') {
            if (direction === 'left') {
                if (focusedTabIndex === 0) setFocusZone('sidebar');
                else setFocusedTabIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                // O último slot é o "Limpar Tudo" — botão que existia no
                // desenho e que nenhuma tecla alcançava
                setFocusedTabIndex(prev => Math.min(headerSlots - 1, prev + 1));
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
            onNavigate?.(emptyFocusIndex === 0 ? 'movies' : 'series');
            return;
        }

        if (focusArea === 'tabs') {
            if (focusedTabIndex >= tabs.length) {
                // Apagar tudo é irreversível: o primeiro OK arma, o segundo faz
                if (clearArmed) {
                    clearAll();
                    setClearArmed(false);
                } else {
                    setClearArmed(true);
                }
                return;
            }
            setActiveTab(tabs[focusedTabIndex]);
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
            const item = displayItems[focusedIndex];
            if (item) removeItem(item);
        },
        enabled: focusZone === 'content' && !modalItem && !playingMovie && !playingChannel && !seriesQueue,
    });

    // Altura da linha: pôster 2:3 + a faixa de título/nota + o gap entre linhas.
    const cardHeight = Math.round((columnWidth - CARD_GAP) * 1.5) + CARD_INFO_HEIGHT + CARD_GAP;
    const rowCount = Math.max(1, Math.ceil(displayItems.length / columns));
    const favoritesCellProps = useMemo<FavoritesCellProps>(() => ({
        items: displayItems,
        columns,
        focusedIndex: focusArea === 'items' ? focusedIndex : -1,
        removingId,
        gap: CARD_GAP,
        onSelect: openItem,
        onRemove: removeItem,
    }), [displayItems, columns, focusArea, focusedIndex, removingId, openItem, removeItem]);

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
                        <div className="empty-icon"><FaHeart /></div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Nenhum favorito ainda</h2>
                    <p className="empty-text">
                        Seus filmes, séries e canais favoritos aparecerão aqui.
                        Clique no <strong>coração</strong> em qualquer conteúdo para adicionar aos favoritos.
                    </p>
                    <div className="empty-suggestions">
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 0 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('movies')}
                        >
                            <span>Filmes</span>
                            <span>Explorar Filmes</span>
                        </button>
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 1 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('series')}
                        >
                            <span>Séries</span>
                            <span>Explorar Séries</span>
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
                    <div className="title-icon"><FaHeart /></div>
                    <div>
                        <h1>Meus Favoritos</h1>
                        <p className="subtitle">{items.length} itens salvos</p>
                    </div>
                </div>
                {items.length > 0 && (
                    <button
                        className={`clear-btn ${focusArea === 'tabs' && focusedTabIndex >= tabs.length ? 'tv-focused' : ''} ${clearArmed ? 'armed' : ''}`}
                        onClick={clearAll}
                    >
                        <span>Excluir</span>
                        <span>{clearArmed ? 'OK de novo apaga' : 'Limpar Tudo'}</span>
                    </button>
                )}
            </header>

            {/* Tabs */}
            <div className="tabs-container">
                <button
                    className={`tab ${activeTab === 'all' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 0 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('all')}
                >
                    <span>Todos</span>
                    <span className="tab-count">{items.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'movies' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 1 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('movies')}
                >
                    <span>Filmes</span>
                    <span className="tab-count">{movies.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'series' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 2 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('series')}
                >
                    <span>Séries</span>
                    <span className="tab-count">{series.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'channels' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 3 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('channels')}
                >
                    <span>Canais</span>
                    <span className="tab-count">{channels.length}</span>
                </button>
            </div>

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

            {/* Content Detail Modal */}
            {modalItem && (
                <ContentDetailModal
                    isOpen={true}
                    onClose={() => { setModalItem(null); loadItems(); }}
                    contentId={modalItem.id}
                    contentType={modalItem.type === 'series' ? 'series' : 'movie'}
                    contentData={{
                        name: modalItem.title,
                        cover: modalItem.poster || '',
                        rating: modalItem.rating,
                        container_extension: modalItem.container,
                    }}
                    onPlay={(season, episode) => {
                        if (modalItem.type === 'movie') {
                            setPlayingMovie(modalItem);
                            setModalItem(null);
                        } else {
                            void playSeriesEpisode(modalItem, season, episode);
                        }
                    }}
                />
            )}

            {/* Movie Player */}
            {playingMovie && (
                <MoviePlayer
                    movieId={playingMovie.id}
                    title={playingMovie.title}
                    poster={playingMovie.poster}
                    container={playingMovie.container}
                    onClose={() => setPlayingMovie(null)}
                />
            )}

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

            {/* Series Player */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => setSeriesQueue(null)}
                />
            )}
        </div>
    );
}
