// MyList Page - Watch Later List - Matching NeoStream Desktop Style

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FaChild, FaBookmark, FaFilm, FaTv, FaTrashAlt, FaPlus, FaCheckSquare, FaRegSquare,
} from 'react-icons/fa';
import { Grid, type CellComponentProps } from 'react-window';
import { RemoteColorHint } from '../components/RemoteColorHint';
import { storage, type WatchLaterItem } from '../services/storage';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useVirtualGridNavigation } from '../hooks/useVirtualGridNavigation';
import { useMeasuredColumns } from '../hooks/useMeasuredColumns';
import { useFocusZone } from '../contexts/FocusContext';
import { kidsFilter } from '../services/kidsFilter';
import { listsService, NOMES_SUGERIDOS, MAX_LISTAS, type ListaNomeada } from '../services/listsService';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { CatalogCard } from '../components/CatalogCard/CatalogCard';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './MyList.css';

interface MyListProps {
    onNavigate?: (page: string) => void;
}

// Card visível 200x(200*1.5)px + a faixa de título/nota embaixo. Gap 24px:
// mesma folga do grid antigo. `columnWidth` que sai do useMeasuredColumns já
// é o PITCH da coluna (o card, mais o gap) — ver o hook pra detalhe.
const CARD_WIDTH = 200;
const CARD_GAP = 24;
const CARD_INFO_HEIGHT = 76;

interface MyListCellProps {
    items: WatchLaterItem[];
    columns: number;
    focusedIndex: number;
    removingId: string | null;
    gap: number;
    onSelect: (item: WatchLaterItem) => void;
    onRemove: (item: WatchLaterItem) => void;
    onPlay: (item: WatchLaterItem) => void;
}

function MyListCell({
    rowIndex, columnIndex, style, items, columns, focusedIndex, removingId, gap, onSelect, onRemove, onPlay,
}: CellComponentProps<MyListCellProps>) {
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
            onPlay={onPlay}
            style={style}
            gap={gap}
        />
    );
}

export function MyList({ onNavigate }: MyListProps) {
    const [items, setItems] = useState<WatchLaterItem[]>(() => storage.getWatchLater());
    // Abas: os três filtros de tipo E as listas nomeadas (item 30). É UMA
    // dimensão só — "o que mostrar" —, então cabe numa fileira de abas sem
    // inventar uma segunda zona de foco.
    const [activeTab, setActiveTab] = useState<string>('all');
    const [listas, setListas] = useState<ListaNomeada[]>(() => listsService.list());
    // Overlays do D-pad: criar lista (sugestões) e "adicionar a…"
    const [criandoLista, setCriandoLista] = useState(false);
    const [sugestaoIndex, setSugestaoIndex] = useState(0);
    const [addAlvo, setAddAlvo] = useState<WatchLaterItem | null>(null);
    const [addIndex, setAddIndex] = useState(0);
    const [aviso, setAviso] = useState('');
    // Confirmacao de dois toques pra apagar uma lista (mesmo padrao do
    // "Limpar Tudo"): guarda o id armado, nao um booleano
    const [excluirArmado, setExcluirArmado] = useState<string | null>(null);
    // O painel de destinos e a fileira de abas rolam: sem levar o foco
    // junto, o realce sai da area visivel e o usuario navega as cegas
    const destinosRef = useRef<HTMLDivElement>(null);
    const abasRef = useRef<HTMLDivElement>(null);
    const { containerRef: gridContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 8,
    });
    const [removingId, setRemovingId] = useState<string | null>(null);
    const { focusZone, setFocusZone } = useFocusZone();
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());

    // Playback / modal
    const [modalItem, setModalItem] = useState<WatchLaterItem | null>(null);
    const [playingMovie, setPlayingMovie] = useState<WatchLaterItem | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Focus states for TV navigation
    const [focusArea, setFocusArea] = useState<'tabs' | 'items'>('items');
    // Confirmação de dois toques pro "Limpar Tudo" (mesmo padrão do reset das
    // Configurações): apagar a lista inteira sem confirmar seria cruel
    const [clearArmed, setClearArmed] = useState(false);
    const [focusedTabIndex, setFocusedTabIndex] = useState(0);
    const [emptyFocusIndex, setEmptyFocusIndex] = useState(0);

    useEffect(() => {
        if (focusArea !== 'tabs') return;
        const aba = abasRef.current?.querySelectorAll('.tab')[focusedTabIndex] as HTMLElement | undefined;
        aba?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [focusArea, focusedTabIndex]);

    useEffect(() => {
        if (!addAlvo) return;
        const alvo = destinosRef.current?.querySelectorAll('.mylist-destino')[addIndex] as HTMLElement | undefined;
        alvo?.scrollIntoView({ block: 'nearest' });
    }, [addAlvo, addIndex]);

    const loadItems = useCallback(() => {
        const saved = storage.getWatchLater();
        setItems(saved);
    }, []);

    const clearAll = () => {
        storage.clearWatchLater();
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');
    const listaAtiva = activeTab.startsWith('list:')
        ? listas.find(lista => `list:${lista.id}` === activeTab) || null
        : null;

    const displayItems = listaAtiva ? listaAtiva.itens
        : activeTab === 'all' ? items
        : activeTab === 'movies' ? movies
        : series;

    // Abas ancoradas por ID, nunca por posição: as listas nomeadas entram e
    // saem, e índice posicional com item condicional é o defeito que já mandou
    // o foco pro botão errado neste repositório.
    const tabs: string[] = [
        'all', 'movies', 'series',
        ...listas.map(lista => `list:${lista.id}`),
        ...(listas.length < MAX_LISTAS ? ['new'] : []),
    ];
    // Slots da faixa do cabeçalho: as abas + "Limpar Tudo" (que só existe
    // quando há algo pra limpar — slot invisível vira parada morta do D-pad)
    const headerSlots = tabs.length + (items.length > 0 ? 1 : 0);

    const recarregarListas = () => setListas(listsService.list());

    // Ajustes de foco no RENDER (effect com setState e erro de lint aqui).
    // Dois casos reais achados na revisao:
    //  - o "Limpar Tudo" some quando a lista padrao esvazia, e o foco ficava
    //    parado num slot que nao existe mais: nenhuma tecla saia dali;
    //  - uma lista nomeada VAZIA deixava focusArea='items' sem card nenhum,
    //    e a tela inteira ficava sem realce.
    if (focusedTabIndex > headerSlots - 1) setFocusedTabIndex(Math.max(0, headerSlots - 1));
    if (focusArea === 'items' && displayItems.length === 0) setFocusArea('tabs');

    // Abrir item: ambos os tipos abrem a ficha (o modal resolve episódios)
    const openItem = useCallback((item: WatchLaterItem) => {
        setModalItem(item);
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

    // Play direto do card: filme toca na hora; série abre a ficha
    const playItem = useCallback((item: WatchLaterItem) => {
        if (item.type === 'movie') {
            setPlayingMovie(item);
        } else if (item.type === 'series') {
            openItem(item);
        }
    }, [openItem]);

    const playSeriesEpisode = async (item: WatchLaterItem, season?: number, episode?: number) => {
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

    const removeItem = useCallback((item: WatchLaterItem) => {
        setRemovingId(item.id);
        setTimeout(() => {
            storage.removeWatchLater(item.id, item.type);
            loadItems();
            setRemovingId(null);
            // Reancora o indice REAL no saneado: sem isto, apagar itens do fim
            // deixava o foco alem da lista e as setas ficavam mortas por
            // varios toques ate o numero voltar ao range
            setFocusedIndex(Math.max(0, Math.min(focusedIndex, displayItems.length - 2)));
        }, 300);
    }, [loadItems, focusedIndex, setFocusedIndex, displayItems.length]);

    // Remove o item da VISTA atual: dentro de uma lista nomeada, 🔴 tira dali
    // — apagar da lista padrão seria destruir o que a pessoa não pediu
    const removerDaVista = useCallback((item: WatchLaterItem) => {
        if (listaAtiva) {
            listsService.toggleItem(listaAtiva.id, item);
            recarregarListas();
            setFocusedIndex(Math.max(0, Math.min(focusedIndex, listaAtiva.itens.length - 2)));
            return;
        }
        removeItem(item);
    }, [listaAtiva, removeItem, focusedIndex, setFocusedIndex]);

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        setAviso('');
        setExcluirArmado(null); // mover o foco cancela a confirmacao
        // Overlays são donos exclusivos das teclas enquanto estão na tela
        if (criandoLista) {
            if (direction === 'left') setSugestaoIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'right') setSugestaoIndex(prev => Math.min(NOMES_SUGERIDOS.length - 1, prev + 1));
            return;
        }
        if (addAlvo) {
            if (direction === 'up') setAddIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setAddIndex(prev => Math.min(listas.length - 1, prev + 1));
            return;
        }
        setClearArmed(false); // sair da linha cancela a confirmação
        if (kidsActive) {
            if (direction === 'left') setFocusZone('sidebar');
            return;
        }
        if (items.length === 0 && listas.length === 0) {
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
        if (items.length === 0 && listas.length === 0) {
            onNavigate?.(emptyFocusIndex === 0 ? 'movies' : 'series');
            return;
        }

        if (criandoLista) {
            const criada = listsService.create(NOMES_SUGERIDOS[sugestaoIndex]);
            setCriandoLista(false);
            if (!criada) {
                setAviso('Você já tem o máximo de listas.');
                return;
            }
            recarregarListas();
            setActiveTab(`list:${criada.id}`);
            setAviso(`Lista "${criada.nome}" criada.`);
            return;
        }
        if (addAlvo) {
            const destino = listas[addIndex];
            if (destino) {
                const dentro = listsService.toggleItem(destino.id, addAlvo);
                recarregarListas();
                setAviso(dentro
                    ? `Adicionado a "${destino.nome}".`
                    : `Removido de "${destino.nome}".`);
            }
            setAddAlvo(null);
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
            const aba = tabs[focusedTabIndex];
            if (aba === 'new') {
                setSugestaoIndex(0);
                setCriandoLista(true);
                return;
            }
            setActiveTab(aba);
        } else if (focusArea === 'items') {
            handleGridSelect();
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: () => {
            // Voltar fecha primeiro o que está por cima
            if (criandoLista) { setCriandoLista(false); return; }
            if (addAlvo) { setAddAlvo(null); return; }
            // Sem isto a tecla nao fazia nada e o usuario ficava preso na
            // pagina. Voltar devolve o foco pra sidebar; de la vai pra Home.
            setFocusZone('sidebar');
        },
        onAction: (action) => {
            if (criandoLista || addAlvo) return;
            // 🔵 na aba de uma lista nomeada: exclui a lista (dois toques).
            // Sem isto, lista criada nunca mais saia — e uma lista criada por
            // engano ficava ocupando uma aba pra sempre.
            if (action === 'blue' && focusArea === 'tabs') {
                const aba = tabs[focusedTabIndex];
                if (!aba || !aba.startsWith('list:')) return;
                const id = aba.slice(5);
                const alvo = listas.find(lista => lista.id === id);
                if (!alvo) return;
                if (excluirArmado !== id) {
                    setExcluirArmado(id);
                    setAviso('Toque azul de novo apaga a lista "' + alvo.nome + '".');
                    return;
                }
                listsService.remove(id);
                setExcluirArmado(null);
                recarregarListas();
                setActiveTab('all');
                setFocusedTabIndex(0);
                setAviso('Lista "' + alvo.nome + '" apagada.');
                return;
            }
            if (focusArea !== 'items') return;
            const item = displayItems[focusedIndex];
            if (!item) return;
            // 🔴 remove o item em foco — mesma convenção do resto do app
            if (action === 'red') {
                removerDaVista(item);
            } else if (action === 'yellow') {
                // 🟡 adicionar a uma lista nomeada (item 30)
                if (listas.length === 0) {
                    setAviso('Crie uma lista primeiro em "Nova lista".');
                    return;
                }
                setAddIndex(0);
                setAddAlvo(item);
            }
        },
        enabled: focusZone === 'content' && !modalItem && !playingMovie && !seriesQueue,
    });

    // Altura da linha: pôster 2:3 (a mesma proporção do CSS) + a faixa de
    // título/nota embaixo do card + o gap visual entre linhas.
    const cardHeight = Math.round((columnWidth - CARD_GAP) * 1.5) + CARD_INFO_HEIGHT + CARD_GAP;
    const rowCount = Math.max(1, Math.ceil(displayItems.length / columns));
    const myListCellProps = useMemo<MyListCellProps>(() => ({
        items: displayItems,
        columns,
        focusedIndex: focusArea === 'items' ? focusedIndex : -1,
        removingId,
        gap: CARD_GAP,
        onSelect: openItem,
        onRemove: removerDaVista,
        onPlay: playItem,
    }), [displayItems, columns, focusArea, focusedIndex, removingId, openItem, removerDaVista, playItem]);

    // Perfil Kids: listas sao globais do aparelho e podem conter conteudo
    // adulto salvo por outros perfis — bloqueadas no modo Kids
    if (kidsActive) {
        return (
            <div className="mylist-page">
                <div className="mylist-backdrop" />
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

    // Empty State — só quando NÃO há nada em lugar nenhum. Sem a segunda
    // condição, quem esvaziasse a lista padrão mas tivesse listas nomeadas
    // cheias veria "sua lista está vazia" e nunca mais alcançaria as listas.
    if (items.length === 0 && listas.length === 0) {
        return (
            <div className="mylist-page">
                <div className="mylist-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon"><FaBookmark /></div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Sua lista está vazia</h2>
                    <p className="empty-text">
                        Adicione filmes e séries para assistir depois clicando em
                        <strong> "+ Minha Lista"</strong> no modal de detalhes.
                    </p>
                    <div className="empty-suggestions">
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 0 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('movies')}
                        >
                            <span><FaFilm /></span>
                            <span>Explorar Filmes</span>
                        </button>
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 1 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('series')}
                        >
                            <span><FaTv /></span>
                            <span>Explorar Séries</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mylist-page">
            <div className="mylist-backdrop" />

            {/* Header */}
            <header className="mylist-header">
                <div className="header-title">
                    <div className="title-icon"><FaBookmark /></div>
                    <div>
                        <h1>Minha Lista</h1>
                        <p className="subtitle">
                            {listaAtiva
                                ? `${listaAtiva.itens.length} em “${listaAtiva.nome}”`
                                : `${items.length} itens para assistir`}
                        </p>
                    </div>
                </div>
                {items.length > 0 && (
                    <button
                        className={`clear-btn ${focusArea === 'tabs' && focusedTabIndex >= tabs.length ? 'tv-focused' : ''} ${clearArmed ? 'armed' : ''}`}
                        onClick={clearAll}
                    >
                        <span><FaTrashAlt /></span>
                        <span>{clearArmed ? 'OK de novo apaga' : 'Limpar Tudo'}</span>
                    </button>
                )}
            </header>

            {/* Tabs */}
            <div className="tabs-container" ref={abasRef}>
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
                    <span><FaFilm /> Filmes</span>
                    <span className="tab-count">{movies.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'series' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 2 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('series')}
                >
                    <span><FaTv /> Séries</span>
                    <span className="tab-count">{series.length}</span>
                </button>

                {/* Listas nomeadas (item 30) */}
                {listas.map(lista => {
                    const aba = `list:${lista.id}`;
                    return (
                        <button
                            key={lista.id}
                            className={`tab ${activeTab === aba ? 'active' : ''} ${focusArea === 'tabs' && tabs[focusedTabIndex] === aba ? 'tv-focused' : ''}`}
                            onClick={() => setActiveTab(aba)}
                        >
                            <span><FaBookmark /> {lista.nome}</span>
                            <span className="tab-count">{lista.itens.length}</span>
                        </button>
                    );
                })}
                {listas.length < MAX_LISTAS && (
                    <button
                        className={`tab ${focusArea === 'tabs' && tabs[focusedTabIndex] === 'new' ? 'tv-focused' : ''}`}
                        onClick={() => { setSugestaoIndex(0); setCriandoLista(true); }}
                    >
                        <span><FaPlus /> Nova lista</span>
                    </button>
                )}
            </div>

            {aviso && <div className="mylist-aviso">{aviso}</div>}

            {/* Criar lista: sugestões navegáveis por ←→. Sem digitação livre —
                o IME nativo do Tizen já rendeu quatro armadilhas neste repo. */}
            {criandoLista && (
                <div className="mylist-overlay">
                    <div className="mylist-overlay-painel">
                        <h2 className="mylist-overlay-titulo">Nova lista</h2>
                        <p className="mylist-overlay-dica">← → escolhe · OK cria · Voltar cancela</p>
                        <div className="mylist-sugestoes">
                            {NOMES_SUGERIDOS.map((nome, index) => (
                                <button
                                    key={nome}
                                    className={`mylist-sugestao ${index === sugestaoIndex ? 'tv-focused' : ''}`}
                                    onClick={() => setSugestaoIndex(index)}
                                >
                                    {nome}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Adicionar a uma lista (🟡 no card) */}
            {addAlvo && (
                <div className="mylist-overlay">
                    <div className="mylist-overlay-painel">
                        <h2 className="mylist-overlay-titulo">Adicionar “{addAlvo.title}” a…</h2>
                        <p className="mylist-overlay-dica">↑ ↓ escolhe · OK liga/desliga · Voltar cancela</p>
                        <div className="mylist-destinos" ref={destinosRef}>
                            {listas.map((lista, index) => (
                                <button
                                    key={lista.id}
                                    className={`mylist-destino ${index === addIndex ? 'tv-focused' : ''}`}
                                    onClick={() => setAddIndex(index)}
                                >
                                    <span>
                                        {lista.itens.some(guardado =>
                                            guardado.id === addAlvo.id && guardado.type === addAlvo.type
                                        ) ? <FaCheckSquare /> : <FaRegSquare />}
                                        {' '}<FaBookmark /> {lista.nome}
                                    </span>
                                    <span className="tab-count">{lista.itens.length}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Cards Grid — virtualizado (react-window): a lista pode ter
                centenas de itens salvos, e só a janela visível+overscan
                fica montada no DOM. */}
            <div className="cards-grid" ref={gridContainerRef}>
                <Grid
                    className="cards-grid-viewport"
                    gridRef={gridRef}
                    cellComponent={MyListCell}
                    cellProps={myListCellProps}
                    columnCount={columns}
                    columnWidth={columnWidth}
                    rowCount={rowCount}
                    rowHeight={cardHeight}
                    overscanCount={1}
                    style={{ height: '100%', width: '100%' }}
                />
            </div>

            {/* Footer Hints */}
            <div className="mylist-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <RemoteColorHint color="red" label="Remover" />
                <RemoteColorHint color="yellow" label="Adicionar a uma lista" />
                <RemoteColorHint color="blue" label="Apagar lista" />
                <span>← Voltar</span>
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
