// Series Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import {
    FaTv, FaBookmark, FaRegBookmark, FaSort, FaEyeSlash,
    FaCalendarAlt, FaStar,
} from 'react-icons/fa';
import { RemoteColorHint } from '../components/RemoteColorHint';
import { Grid, type CellComponentProps } from 'react-window';
import { api } from '../services/api';
import type { Series as SeriesType, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useVirtualGridNavigation } from '../hooks/useVirtualGridNavigation';
import { useMeasuredColumns } from '../hooks/useMeasuredColumns';
import { useBrokenImages } from '../hooks/useBrokenImages';
import { useAdultLock } from '../hooks/useAdultLock';
import { parentalService } from '../services/parentalService';
import { PinPrompt } from '../components/PinPrompt';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { SeriesCard, type SeriesCardBadge } from './SeriesCard';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import {
    catalogSort, sortCatalog, hideWatched, isRecentlyAdded, newEpisodes, SORT_LABELS, type CatalogSort,
    catalogFilters, matchesFilters, normalizeSearch, fuzzyMatches, DECADES, MIN_RATINGS,
    type CatalogFilters,
} from '../services/catalogExtras';
import { kidsFilter } from '../services/kidsFilter';
import { groupVodVersions, rotulosDasVersoes } from '../services/vodVariants';
import { contentFlags } from '../services/contentFlags';
import { progressService } from '../services/progressService';
import { storage } from '../services/storage';
import './Series.css';
import { ErrorScreen } from '../components/ErrorScreen';

const CARD_WIDTH = 180;
// Mesma folga da Minha Lista: com 16px os cards ficavam colados
const CARD_GAP = 24;
const CARD_INFO_HEIGHT = 40;

interface SeriesCellProps {
    items: SeriesType[];
    columns: number;
    focusedIndex: number;
    gap: number;
    isBroken: (id: number) => boolean;
    onImageError: (id: number) => void;
    onSelect: (item: SeriesType) => void;
    selectedId: number | undefined;
    badgeFor: (item: SeriesType) => SeriesCardBadge;
    versionsOf: Map<string, SeriesType[]>;
}

function SeriesGridCell({
    rowIndex, columnIndex, style, items, columns, focusedIndex, gap, isBroken, onImageError, onSelect, selectedId, badgeFor, versionsOf,
}: CellComponentProps<SeriesCellProps>) {
    const index = rowIndex * columns + columnIndex;
    const item = items[index];
    if (!item) return null;
    return (
        <SeriesCard
            item={item}
            focused={index === focusedIndex}
            selected={selectedId === item.series_id}
            broken={isBroken(item.series_id)}
            badge={badgeFor(item)}
            versionCount={versionsOf.get(String(item.series_id))?.length ?? 0}
            onSelect={onSelect}
            onImageError={onImageError}
            style={style}
            gap={gap}
        />
    );
}

export function Series() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [series, setSeries] = useState<SeriesType[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSeries, setSelectedSeries] = useState<SeriesType | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);
    const { isBroken, markBroken } = useBrokenImages<number>();
    const { containerRef: scrollContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 10,
    });
    const {
        lockedCategoryIds, guardSelect: guardCategorySelect, pendingCategoryId,
        setPendingCategoryId, setUnlocked: setAdultUnlocked, justProvisioned,
    } = useAdultLock(categories);

    // Ordenação / esconder assistidos / selo NOVO / novos episódios (Fase 3)
    const [sortMode, setSortMode] = useState<CatalogSort>(() => catalogSort.get('series'));
    const [hideWatchedOn, setHideWatchedOn] = useState(() => hideWatched.get());
    const [newEpisodesTick, setNewEpisodesTick] = useState(0);
    // R3: filtros, menu de contexto, toast
    const [filters, setFilters] = useState<CatalogFilters>(() => catalogFilters.get('series'));
    const [contextItem, setContextItem] = useState<SeriesType | null>(null);
    const [contextIndex, setContextIndex] = useState(0);
    const [toast, setToast] = useState<ReactNode | null>(null);
    // Congelado no mount: Date.now() no render viola a pureza do react-hooks
    const [nowMs] = useState(() => Date.now());

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    const [focusArea, setFocusArea] = useState<'categories' | 'series'>('series');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const searchRef = useRef<AnimatedSearchBarHandle>(null);
    const categoryMenuRef = useRef<CategoryMenuHandle>(null);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            // "Incluir VOD" desmarcado no login: nem busca — mesmo motivo do
            // gate em LiveTV.tsx.
            if (!contentFlags.includeVOD()) {
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                const [seriesData, categoriesData] = await Promise.all([
                    api.getSeries(),
                    api.getSeriesCategories()
                ]);
                // Gate do perfil Kids (remove categorias adultas e suas séries)
                const gated = kidsFilter.apply(seriesData, categoriesData, 'vod');
                setSeries(gated.items);
                setCategories(gated.categories);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar s�ries');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Séries seguidas (favoritas ou com progresso) — pra badge de novos episódios
    const followedSeriesIds = useMemo(() => {
        const followed = progressService.getSeriesIdsWithProgress();
        for (const fav of storage.getFavorites()) {
            if (fav.type === 'series') followed.add(fav.id);
        }
        return followed;
        // newEpisodesTick força recomputo após markSeen
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newEpisodesTick]);

    // Semeia o baseline de last_modified das séries seguidas (1x por carga)
    useEffect(() => {
        if (series.length === 0) return;
        newEpisodes.seed(
            series
                .filter(s => followedSeriesIds.has(String(s.series_id)))
                .map(s => ({ seriesId: String(s.series_id), lastModified: s.last_modified || '0' }))
        );
    }, [series, followedSeriesIds]);

    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2200);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Séries terminadas (só relidas quando o toggle liga ou o player fecha —
    // seriesQueue é gatilho intencional de refresh, não dependência de dado)
    const finishedSeriesIds = useMemo(() => {
        return hideWatchedOn ? progressService.getFinishedSeriesIds() : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideWatchedOn, seriesQueue]);

    // Ordenação roda 1x por mudança de modo/dados; o filtro (que roda a cada
    // tecla da busca) preserva a ordem — nunca re-ordenar por tecla
    const sortedSeries = useMemo(() => sortCatalog(series, sortMode), [series, sortMode]);

    // Botões da barra ancorados por id, não por posição
    const toolbarItems = ['sort', 'hidewatched', 'decade', 'nota'] as const;
    const HEADER_BASE = 2; // 0 = busca, 1 = menu de categorias
    const toolbarFocusIndex = (item: string) =>
        HEADER_BASE + toolbarItems.indexOf(item as typeof toolbarItems[number]);
    const maxHeaderIndex = HEADER_BASE + toolbarItems.length - 1;

    // Filter series (memoizado — recalcular a cada tecla do D-pad trava TVs antigas)
    const seriesFiltradas = useMemo(() => {
        const query = normalizeSearch(searchQuery);
        const hasFilters = filters.decade > 0 || filters.minRating > 0;
        let list = sortedSeries.filter((s) => {
            const matchesSearch = !query || fuzzyMatches(s.name || '', query);
            const matchesCategory = selectedCategory === 'all' || s.category_id === selectedCategory;
            if (!matchesSearch || !matchesCategory) return false;
            // Categoria travada por PIN só aparece quando ela mesma está
            // selecionada — mesmo motivo do gate em Movies.tsx.
            if (lockedCategoryIds.has(s.category_id) && selectedCategory !== s.category_id) return false;
            if (hasFilters && !matchesFilters(s, filters)) return false;
            return true;
        });
        if (finishedSeriesIds) {
            // Série terminada que ganhou episódios NOVOS não se esconde —
            // é justamente o caso em que ela voltou a ter conteúdo não visto
            list = list.filter(s =>
                !finishedSeriesIds.has(String(s.series_id)) ||
                newEpisodes.has(String(s.series_id), s.last_modified || '0')
            );
        }
        return list;
    }, [sortedSeries, searchQuery, selectedCategory, finishedSeriesIds, filters, lockedCategoryIds]);
    // Dublada e legendada "[L]" (ou 4K) da mesma série viram um card só; a
    // ficha troca entre elas pelos botões de versão (mesmo esquema de Filmes)
    const { groups: filteredSeries, versionsOf } = useMemo(
        () => groupVodVersions(seriesFiltradas, s => s.series_id, true),
        [seriesFiltradas],
    );

    // Grade vazia numa TV e indistinguivel de defeito: dizer QUAIS filtros
    // estao ligados e o que fecha a duvida
    const filtrosLigados = [
        searchQuery ? `busca "${searchQuery}"` : '',
        selectedCategory !== 'all' ? 'categoria' : '',
        filters.decade > 0 ? `${filters.decade}s` : '',
        filters.minRating > 0 ? `nota ${filters.minRating}+` : '',
        hideWatchedOn ? 'esconder assistidos' : '',
    ].filter(Boolean);

    // Selecionado limpa ao trocar busca/categoria — a ficha aberta pode não
    // fazer mais parte do resultado filtrado
    useEffect(() => {
        setSelectedSeries(null);
    }, [searchQuery, selectedCategory]);

    // Grupo de versões de qualquer membro (o representante é a chave do mapa)
    const versoesDe = (item: SeriesType): SeriesType[] => {
        const direto = versionsOf.get(String(item.series_id));
        if (direto) return direto;
        for (const grupo of versionsOf.values()) if (grupo.includes(item)) return grupo;
        return [];
    };

    const openSeriesModal = useCallback((item: SeriesType) => {
        setSelectedSeries(item);
        setShowModal(true);
        // Abrir a ficha "vê" os episódios novos — atualiza o baseline
        newEpisodes.markSeen(String(item.series_id), item.last_modified || '0');
        setNewEpisodesTick(t => t + 1);
    }, []);

    const {
        focusedIndex, setFocusedIndex, gridRef, handleNavigate: handleGridNavigate, handleSelect: handleGridSelect,
    } = useVirtualGridNavigation({
        itemCount: filteredSeries.length,
        columns,
        enabled: focusArea === 'series',
        onExitUp: () => setFocusArea('categories'),
        onExitLeft: () => setFocusZone('sidebar'),
        onSelect: (index) => {
            const item = filteredSeries[index];
            if (item) openSeriesModal(item);
        },
    });

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            // Header: 0 = busca, 1 = categorias, 2 = ordenar, 3 = esconder assistidos
            if (direction === 'left') {
                if (focusedCategoryIndex === 0) {
                    // At search - go to sidebar
                    setFocusZone('sidebar');
                } else {
                    setFocusedCategoryIndex(prev => prev - 1);
                }
            } else if (direction === 'right') {
                setFocusedCategoryIndex(prev => Math.min(maxHeaderIndex, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('series');
                setFocusedIndex(0);
            }
        } else if (focusArea === 'series') {
            handleGridNavigate(direction);
        }
    };

    const cycleSort = () => {
        setSortMode(prev => {
            const next = catalogSort.next(prev);
            catalogSort.set('series', next);
            return next;
        });
    };

    const toggleHideWatched = () => {
        setHideWatchedOn(prev => {
            hideWatched.set(!prev);
            return !prev;
        });
    };

    // Nota mínima (item 32): existia em matchesFilters e nenhuma tela escrevia
    const cycleNota = () => {
        setFilters(prev => {
            const i = MIN_RATINGS.indexOf(prev.minRating);
            const next = { ...prev, minRating: MIN_RATINGS[(i + 1) % MIN_RATINGS.length] };
            catalogFilters.set('series', next);
            return next;
        });
    };

    const cycleFilters = () => {
        setFilters(prev => {
            const index = DECADES.indexOf(prev.decade);
            const next = { ...prev, decade: DECADES[(index + 1) % DECADES.length] };
            catalogFilters.set('series', next);
            return next;
        });
    };

    // Menu de contexto no card (item 24)
    const openContextMenu = () => {
        const item = filteredSeries[focusedIndex];
        if (!item) return;
        setContextItem(item);
        setContextIndex(0);
    };

    const contextActions = contextItem ? [
        {
            label: storage.isInWatchLater(String(contextItem.series_id), 'series')
                ? <><FaBookmark /> Tirar da Minha Lista</> : <><FaRegBookmark /> Adicionar à Lista</>,
            run: () => {
                const added = storage.toggleWatchLater({
                    id: String(contextItem.series_id),
                    type: 'series',
                    title: contextItem.name,
                    poster: contextItem.cover,
                    rating: contextItem.rating,
                });
                setToast(added ? <><FaBookmark /> Salvo na Minha Lista</> : <><FaRegBookmark /> Removido da Minha Lista</>);
            },
        },
    ] : [];

    const handleEnter = (fromInput?: boolean) => {
        // OK vindo de dentro do campo de busca já fechou o teclado; reabrir
        // aqui faria o IME do Tizen piscar sem parar
        if (fromInput) return;
        if (focusArea === 'categories') {
            if (focusedCategoryIndex === 0) {
                searchRef.current?.open();
            } else if (focusedCategoryIndex === 1) {
                categoryMenuRef.current?.open();
            } else {
                // Sem fallback destrutivo (lição da R2)
                const item = toolbarItems[focusedCategoryIndex - HEADER_BASE];
                if (item === 'sort') cycleSort();
                else if (item === 'hidewatched') toggleHideWatched();
                else if (item === 'decade') cycleFilters();
                else if (item === 'nota') cycleNota();
            }
        } else if (focusArea === 'series') {
            handleGridSelect();
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onAction: (action) => {
            if (action === 'yellow' && focusArea === 'series') openContextMenu();
        },
        enabled: focusZone === 'content' && !error && !showModal && !seriesQueue && !categoryMenuOpen && !contextItem && !pendingCategoryId,
    });

    useTVNavigation({
        enabled: !!contextItem,
        onNavigate: (direction) => {
            if (direction === 'up') setContextIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setContextIndex(prev => Math.min(contextActions.length - 1, prev + 1));
        },
        onEnter: () => {
            const action = contextActions[contextIndex];
            if (action) {
                action.run();
                setContextItem(null);
            }
        },
        onBack: () => {
            // Voltar sobe um degrau: primeiro fecha o que estiver aberto por
            // cima, depois devolve o foco pra sidebar (de lá, Voltar vai pra
            // Home e só então pede pra sair).
            if (contextItem) {
                setContextItem(null);
                return;
            }
            setFocusZone('sidebar');
        },
    });

    const badgeFor = useCallback((item: SeriesType): SeriesCardBadge => {
        if (followedSeriesIds.has(String(item.series_id)) && newEpisodes.has(String(item.series_id), item.last_modified || '0')) {
            return 'episodes';
        }
        return isRecentlyAdded(item, nowMs) ? 'new' : null;
    }, [followedSeriesIds, nowMs]);

    // Altura da linha: pôster 2:3 + a faixa de título + o gap entre linhas.
    const seriesCardHeight = Math.round((columnWidth - CARD_GAP) * 1.5) + CARD_INFO_HEIGHT + CARD_GAP;
    const seriesRowCount = Math.max(1, Math.ceil(filteredSeries.length / columns));
    const seriesCellProps = useMemo<SeriesCellProps>(() => ({
        items: filteredSeries,
        columns,
        focusedIndex: focusArea === 'series' ? focusedIndex : -1,
        gap: CARD_GAP,
        isBroken,
        onImageError: markBroken,
        onSelect: openSeriesModal,
        selectedId: selectedSeries?.series_id,
        badgeFor,
        versionsOf,
    }), [filteredSeries, columns, focusArea, focusedIndex, isBroken, markBroken, openSeriesModal, selectedSeries, badgeFor, versionsOf]);

    // Loading State
    if (loading) {
        return (
            <div className="series-page">
                <div className="series-bg-gradient" />
                <div className="series-loading">
                    <div className="loading-grid">
                        {Array.from({ length: 15 }).map((_, i) => (
                            <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.05}s` }}>
                                <div className="skeleton-poster" />
                                <div className="skeleton-title" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <ErrorScreen
                icon={FaTv}
                title="Erro ao carregar séries"
                message={error}
                className="series-error-container"
            />
        );
    }

    return (
        <div className="series-page">
            {/* Dynamic Background */}
            <div className="series-bg-gradient" />
            {selectedSeries && selectedSeries.cover && (
                <div
                    className="series-backdrop"
                    style={{ backgroundImage: `url(${selectedSeries.cover})` }}
                />
            )}

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar séries..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={(id) => guardCategorySelect(id, () => setSelectedCategory(id))}
                type="series"
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 1}
                onOpenChange={setCategoryMenuOpen}
                lockedCategoryIds={lockedCategoryIds}
            />

            {pendingCategoryId && (
                <PinPrompt
                    title="Categoria bloqueada"
                    hint={justProvisioned
                        ? 'Conteúdo adulto — PIN padrão: 0000 (altere em Configurações)'
                        : 'Conteúdo adulto — digite o PIN'}
                    parental
                    onSubmit={async (pin) => {
                        const ok = await parentalService.verify(pin);
                        if (ok) {
                            setAdultUnlocked(true);
                            setSelectedCategory(pendingCategoryId);
                            setPendingCategoryId(null);
                        }
                        return ok;
                    }}
                    onCancel={() => setPendingCategoryId(null)}
                />
            )}

            {/* Toolbar: ordenar + esconder assistidos */}
            <div className="catalog-toolbar">
                <button
                    className={`toolbar-btn ${sortMode !== 'default' ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('sort') ? 'tv-focused' : ''}`}
                    onClick={cycleSort}
                    title="Ordenar"
                >
                    <FaSort /> {SORT_LABELS[sortMode]}
                </button>
                <button
                    className={`toolbar-btn ${hideWatchedOn ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('hidewatched') ? 'tv-focused' : ''}`}
                    onClick={toggleHideWatched}
                    title="Esconder assistidos"
                >
                    <FaEyeSlash />
                </button>
                <button
                    className={`toolbar-btn ${filters.decade > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('decade') ? 'tv-focused' : ''}`}
                    onClick={cycleFilters}
                    title="Filtrar por década"
                >
                    {filters.decade > 0 ? `${filters.decade}s` : <><FaCalendarAlt /> Década</>}
                </button>
                <button
                    className={`toolbar-btn ${filters.minRating > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('nota') ? 'tv-focused' : ''}`}
                    onClick={cycleNota}
                    title="Nota mínima"
                >
                    {filters.minRating > 0 ? <><FaStar /> {filters.minRating}+</> : <><FaStar /> Nota</>}
                </button>
            </div>

            {/* Content Detail Modal */}
            {selectedSeries && (
                <ContentDetailModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setSelectedSeries(null);
                    }}
                    contentId={String(selectedSeries.series_id)}
                    contentType="series"
                    versions={(() => {
                        // As versões são do card de ORIGEM: trocar pra legendada
                        // muda selectedSeries, e o grupo segue achável por ela
                        const todas = versoesDe(selectedSeries);
                        const rotulos = rotulosDasVersoes(todas.map(v => v.name));
                        return todas.map((v, i) => ({ id: String(v.series_id), label: rotulos[i] }));
                    })()}
                    onSelectVersion={(versionId) => {
                        const alvo = versoesDe(selectedSeries).find(v => String(v.series_id) === versionId);
                        if (alvo) setSelectedSeries(alvo);
                    }}
                    contentData={{
                        name: selectedSeries.name,
                        cover: selectedSeries.cover,
                        rating: selectedSeries.rating,
                        plot: selectedSeries.plot,
                        genre: selectedSeries.genre,
                        cast: selectedSeries.cast,
                        director: selectedSeries.director,
                        release_date: selectedSeries.release_date,
                        runtime: selectedSeries.episode_run_time,
                        tmdbId: selectedSeries.tmdb_id,
                        // Item 18: o campo existe no Xtream e ninguém lia
                        youtubeTrailer: selectedSeries.youtube_trailer,
                    }}
                    onPlay={async (season, episode) => {
                        // Monta a fila de episódios (habilita próximo/anterior + resume)
                        try {
                            const queue = await buildEpisodeQueue(
                                selectedSeries.series_id,
                                selectedSeries.name,
                                selectedSeries.cover,
                                season,
                                episode
                            );
                            if (queue) setSeriesQueue(queue);
                        } catch (err) {
                            console.error('Error getting episode info:', err);
                        }
                        setShowModal(false);
                    }}
                />
            )}

            {/* Video Player (fila de episódios + retomada + progresso) */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => setSeriesQueue(null)}
                />
            )}

            {/* Series Grid — virtualizado (react-window): o catálogo pode ter
                centenas de séries, e só a janela visível+overscan monta. */}
            <div ref={scrollContainerRef} className="series-content">
                {filteredSeries.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon"><FaTv /></div>
                        {contentFlags.includeVOD() ? (
                            <>
                                <p>Nenhuma série encontrada</p>
                                <span>
                                    {filtrosLigados.length > 0
                                        ? `Filtros ligados: ${filtrosLigados.join(' · ')}`
                                        : 'Tente buscar por outro termo'}
                                </span>
                            </>
                        ) : (
                            <>
                                <p>VOD desativado para esta playlist</p>
                                <span>Mude isso ao adicionar a playlist de novo, em Configurações</span>
                            </>
                        )}
                    </div>
                ) : (
                    <Grid
                        className="series-grid-viewport"
                        gridRef={gridRef}
                        cellComponent={SeriesGridCell}
                        cellProps={seriesCellProps}
                        columnCount={columns}
                        columnWidth={columnWidth}
                        rowCount={seriesRowCount}
                        rowHeight={seriesCardHeight}
                        overscanCount={1}
                        style={{ height: '100%', width: '100%' }}
                    />
                )}
            </div>

            {toast && <div className="catalog-toast">{toast}</div>}

            {contextItem && (
                <div className="context-overlay" onClick={() => setContextItem(null)}>
                    <div className="context-menu" onClick={(e) => e.stopPropagation()}>
                        <div className="context-title">{contextItem.name}</div>
                        {contextActions.map((action, index) => (
                            <div
                                key={index}
                                className={`context-item ${contextIndex === index ? 'tv-focused' : ''}`}
                                onClick={() => {
                                    action.run();
                                    setContextItem(null);
                                }}
                            >
                                {action.label}
                            </div>
                        ))}
                        <div className="context-hint">↑↓ Navegar · OK Executar · ← Fechar</div>
                    </div>
                </div>
            )}

            {/* Footer Hints */}
            <div className="series-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
                <RemoteColorHint color="yellow" label="Ações" />
            </div>
        </div>
    );
}
