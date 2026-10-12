// Movies Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import {
    FaFilm, FaBookmark, FaRegBookmark, FaPlay, FaSort, FaEyeSlash,
    FaTag, FaCalendarAlt, FaTheaterMasks, FaStar, FaFire,
} from 'react-icons/fa';
import { RemoteColorHint } from '../components/RemoteColorHint';
import { Grid, type CellComponentProps } from 'react-window';
import { api } from '../services/api';
import type { VODStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useVirtualGridNavigation } from '../hooks/useVirtualGridNavigation';
import { useMeasuredColumns } from '../hooks/useMeasuredColumns';
import { useBrokenImages } from '../hooks/useBrokenImages';
import { parentalService } from '../services/parentalService';
import { PinPrompt } from '../components/PinPrompt';
import { useFocusZone } from '../contexts/FocusContext';
import { mapaDeGeneros, generosDisponiveis, rotuloDoGenero, GENERO_ADULTO } from '../services/catalogGenres';
import { GenrePicker } from '../components/GenrePicker';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import {
    catalogSort, sortCatalog, hideWatched, isRecentlyAdded, SORT_LABELS, type CatalogSort,
    catalogFilters, matchesFilters, normalizeSearch, fuzzyMatches,
    DECADES, MIN_RATINGS, type CatalogFilters,
} from '../services/catalogExtras';
import { groupVodVersions, hasTag, versionLabel, ALL_VOD_TAGS, type VodTag } from '../services/vodVariants';
// versionLabel é usado nos botões de versão da ficha (abaixo)
import { storage } from '../services/storage';
import { kidsFilter, isAdultCategoryName } from '../services/kidsFilter';
import { secretList, type ItemSecreto } from '../services/secretList';
import { SecretList } from '../components/SecretList';
import { SecretPlayer } from '../components/SecretPlayer';
import { contentFlags } from '../services/contentFlags';
import { progressService } from '../services/progressService';
import { MovieCard } from './MovieCard';
import './Movies.css';
import { ErrorScreen } from '../components/ErrorScreen';

const CARD_WIDTH = 180;
const CARD_GAP = 16;
const CARD_INFO_HEIGHT = 40;

interface MovieCellProps {
    items: VODStream[];
    columns: number;
    focusedIndex: number;
    gap: number;
    isBroken: (id: number) => boolean;
    onImageError: (id: number) => void;
    onSelect: (movie: VODStream) => void;
    selectedId: number | undefined;
    nowMs: number;
    versionsOf: Map<string, VODStream[]>;
}

function MovieGridCell({
    rowIndex, columnIndex, style, items, columns, focusedIndex, gap, isBroken, onImageError, onSelect, selectedId, nowMs, versionsOf,
}: CellComponentProps<MovieCellProps>) {
    const index = rowIndex * columns + columnIndex;
    const movie = items[index];
    if (!movie) return null;
    return (
        <MovieCard
            movie={movie}
            focused={index === focusedIndex}
            selected={selectedId === movie.stream_id}
            broken={isBroken(movie.stream_id)}
            isNew={isRecentlyAdded(movie, nowMs)}
            versionCount={versionsOf.get(String(movie.stream_id))?.length ?? 0}
            onSelect={onSelect}
            onImageError={onImageError}
            style={style}
            gap={gap}
        />
    );
}

export function Movies() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [streams, setStreams] = useState<VODStream[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMovie, setSelectedMovie] = useState<VODStream | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [showPlayer, setShowPlayer] = useState(false);
    // playStreamId: id REAL do stream a tocar (versão escolhida); stream_id
    // continua sendo o do grupo, que é a chave de progresso/favoritos
    const [playingMovie, setPlayingMovie] = useState<(VODStream & { playStreamId?: number }) | null>(null);
    const { isBroken, markBroken } = useBrokenImages<number>();
    const { containerRef: scrollContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 10,
    });
    // Painel de gêneros (todos de uma vez)
    const [generoPickerOpen, setGeneroPickerOpen] = useState(false);

    // Ordenação / esconder assistidos / selo NOVO (Fase 3)
    const [sortMode, setSortMode] = useState<CatalogSort>(() => catalogSort.get('movies'));
    const [hideWatchedOn, setHideWatchedOn] = useState(() => hideWatched.get());
    // R3: chips de tag, filtros, versões agrupadas, menu de contexto
    const [activeTags, setActiveTags] = useState<VodTag[]>([]);
    const [filters, setFilters] = useState<CatalogFilters>(() => catalogFilters.get('movies'));
    const [contextItem, setContextItem] = useState<VODStream | null>(null);
    const [contextIndex, setContextIndex] = useState(0);
    const [toast, setToast] = useState<ReactNode | null>(null);
    // Congelado no mount: Date.now() no render viola a pureza do react-hooks
    const [nowMs] = useState(() => Date.now());

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    const [focusArea, setFocusArea] = useState<'categories' | 'movies' | 'alphabet'>('movies');
    const [alphabetIndexFocus, setAlphabetIndexFocus] = useState(0);
    // Letra escolhida na barra A-Z (null = todas)
    const [letterFilter, setLetterFilter] = useState<string | null>(null);
    // Gênero (item 31): sai do NOME da categoria, não do TMDB — assim o filtro
    // existe para quem não cadastrou chave da API, que é a maioria
    const [genero, setGenero] = useState<string | null>(null);
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
                const [streamsData, categoriesData] = await Promise.all([
                    api.getVODStreams(),
                    api.getVodCategories()
                ]);
                // Gate do perfil Kids (remove categorias adultas e seus filmes)
                const gated = kidsFilter.apply(streamsData, categoriesData);
                setStreams(gated.items);
                setCategories(gated.categories);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar filmes');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2200);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Filmes concluídos (só relidos quando o toggle liga ou um player fecha —
    // showPlayer é gatilho intencional de refresh, não dependência de dado)
    const completedMovieIds = useMemo(() => {
        return hideWatchedOn ? progressService.getCompletedMovieIds() : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideWatchedOn, showPlayer]);

    // Categoria → gênero, calculado UMA vez. Refazer a varredura de pistas por
    // item travaria a grade num catálogo de milhares de títulos.
    const generoPorCategoria = useMemo(() => mapaDeGeneros(categories), [categories]);
    // Só os gêneros que ESTE provedor realmente tem: oferecer "Guerra" numa
    // lista sem nenhum filme de guerra devolve uma grade vazia e parece bug
    // Conteúdo adulto SÓ no gênero "Adulto": fora dele, filmes e categorias
    // adultas somem de tudo (Todos, categorias, busca da página). Escolher o
    // gênero pede o PIN (uma vez por visita à página) e só então aparecem os
    // filmes adultos, as categorias adultas no menu e a lista secreta (ícone FaFire).
    // Perfil Kids nunca vê o gênero (o kidsFilter já tirou as categorias).
    const generosDoCatalogo = useMemo(
        () => generosDisponiveis(categories).filter(g => g.id !== GENERO_ADULTO || !kidsFilter.isKidsActive()),
        [categories],
    );
    const modoAdulto = genero === GENERO_ADULTO;
    const categoriasAdultas = useMemo(
        () => new Set(categories.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id)),
        [categories],
    );
    const ehFilmeAdulto = useCallback(
        (m: VODStream) => categoriasAdultas.has(m.category_id) || isAdultCategoryName(m.name || ''),
        [categoriasAdultas],
    );
    // No modo adulto o menu lista só as categorias adultas; fora dele, só as outras
    const categoriasDoMenu = useMemo(
        () => categories.filter(c => categoriasAdultas.has(c.category_id) === modoAdulto),
        [categories, categoriasAdultas, modoAdulto],
    );
    const [adultoDesbloqueado, setAdultoDesbloqueado] = useState(false);
    const [adultoPinAberto, setAdultoPinAberto] = useState(false);
    const [adultoPinProvisionado, setAdultoPinProvisionado] = useState(false);
    // Botão de gênero NO modo adulto não abre o seletor: sai do modo adulto
    // (volta pra "Todos") e TRANCA de novo — reentrar pede o PIN outra vez
    const botaoGenero = () => {
        if (!modoAdulto) {
            setGeneroPickerOpen(true);
            return;
        }
        setAdultoDesbloqueado(false);
        setSecretListOpen(false);
        setSelectedCategory('all');
        setGenero(null);
    };
    const escolherGenero = (id: string | null) => {
        if (id === GENERO_ADULTO && !adultoDesbloqueado) {
            // Sem PIN ainda: cria o "0000" primeiro e SÓ DEPOIS abre o prompt
            // (o hash é assíncrono: digitar antes negaria o PIN certo)
            if (!parentalService.isSet()) {
                parentalService.autoProvisionAdultLock().then(() => {
                    setAdultoPinProvisionado(true);
                    setAdultoPinAberto(true);
                });
                return;
            }
            setAdultoPinAberto(true);
            return;
        }
        // Entrar ou sair do modo adulto troca as categorias do menu: a
        // selecionada não existe mais do outro lado
        if ((id === GENERO_ADULTO) !== modoAdulto) setSelectedCategory('all');
        setGenero(id);
    };

    // Lista secreta (adultos + momentos): só no modo adulto, que já pediu o PIN
    const listaSecretaAtiva = modoAdulto;
    const [secretListOpen, setSecretListOpen] = useState(false);
    const [secretPlaying, setSecretPlaying] = useState<{ itens: ItemSecreto[]; indice: number; momento: number | null } | null>(null);
    const [, setSecretTick] = useState(0); // re-render do rótulo após toggle
    const toggleSecreto = (m: VODStream) => {
        const entrou = secretList.toggle({
            id: String(m.stream_id),
            title: m.name,
            poster: m.stream_icon || m.cover,
            container: m.container_extension,
        });
        setSecretTick(t => t + 1);
        setToast(entrou ? <><FaFire /> Na lista secreta</> : <><FaFire /> Fora da lista secreta</>);
    };

    // Botões da barra na ORDEM do JSX, ancorados por id e não por posição.
    // O botão de gênero é condicional (some quando o provedor não organiza o
    // catálogo por gênero) — e índice posicional com item condicional é
    // exatamente o defeito que já mandou o foco pro botão errado neste repo.
    const toolbarItems = [
        'sort', 'hidewatched', 'tags', 'decade',
        ...(generosDoCatalogo.length > 0 ? ['genero'] : []),
        ...(listaSecretaAtiva ? ['secret'] : []),
        'nota',
    ] as const;
    const HEADER_BASE = 2; // 0 = busca, 1 = menu de categorias
    const toolbarFocusIndex = (item: string) =>
        HEADER_BASE + toolbarItems.indexOf(item as typeof toolbarItems[number]);
    const maxHeaderIndex = HEADER_BASE + toolbarItems.length - 1;

    // ORDEM IMPORTA: filtra PRIMEIRO, agrupa DEPOIS. Agrupar antes fazia o
    // filtro olhar só o representante — o chip DUB escondia o filme inteiro
    // mesmo existindo versão DUB no grupo, e categorias perdiam títulos.
    const matchingStreams = useMemo(() => {
        const query = normalizeSearch(searchQuery);
        const hasFilters = filters.decade > 0 || filters.minRating > 0;
        let list = streams.filter((stream) => {
            const matchesSearch = !query || fuzzyMatches(stream.name || '', query);
            const matchesCategory = selectedCategory === 'all' || stream.category_id === selectedCategory;
            if (!matchesSearch || !matchesCategory) return false;
            // Adulto só no modo adulto, e o modo adulto só tem adulto (inclui o
            // filme de nome adulto fora de categoria adulta)
            if (ehFilmeAdulto(stream) !== modoAdulto) return false;
            // Chips de tag: item precisa ter TODAS as tags marcadas
            if (activeTags.length > 0 && !activeTags.every(tag => hasTag(stream.name || '', tag))) return false;
            if (hasFilters && !matchesFilters(stream, filters)) return false;
            if (genero && !modoAdulto && generoPorCategoria.get(stream.category_id) !== genero) return false;
            return true;
        });
        if (completedMovieIds) {
            list = list.filter(stream => !completedMovieIds.has(String(stream.stream_id)));
        }
        return list;
    }, [streams, searchQuery, selectedCategory, completedMovieIds, activeTags, filters, genero, generoPorCategoria, ehFilmeAdulto, modoAdulto]);

    // Agrupa versões do mesmo filme (DUB/LEG/4K) sobre a lista JÁ filtrada
    const { groups: groupedStreams, versionsOf } = useMemo(
        () => groupVodVersions(matchingStreams),
        [matchingStreams]
    );

    // Ordenação roda por mudança de modo/dados; o filtro já aconteceu acima
    // O filtro de letra é uma lente sobre a lista ATUAL: buscar, trocar de
    // categoria ou de ordenação muda a lista debaixo dele, e manter a letra
    // deixaria "nenhum filme encontrado" sem nada na tela explicando por quê.
    // Ajuste durante o render (mesmo padrão do lastSrc do player); effect com
    // setState é proibido pela regra react-hooks/set-state-in-effect.
    // A chave precisa citar TODOS os filtros. Antes só tinha busca, categoria
    // e ordenação: trocar a década com a letra "S" ativa deixava a grade vazia
    // pelo mesmo motivo, e o bug seguia vivo num caminho diferente.
    const chaveDosFiltros = [
        searchQuery, selectedCategory, sortMode,
        filters.decade, filters.minRating, activeTags.join('+'), genero,
        // 🙈 e o fim de um filme também mudam a lista debaixo da letra: sem
        // isto, a grade ficava vazia com a letra presa e nada explicando
        hideWatchedOn, completedMovieIds?.size ?? -1,
    ].join('|');
    const [lastFilterKey, setLastFilterKey] = useState(chaveDosFiltros);
    const filterKey = chaveDosFiltros;
    if (filterKey !== lastFilterKey) {
        setLastFilterKey(filterKey);
        if (letterFilter !== null) setLetterFilter(null);
    }

    const filteredStreams = useMemo(() => {
        const ordenado = sortCatalog(groupedStreams, sortMode);
        if (!letterFilter) return ordenado;
        return ordenado.filter(stream => {
            const first = normalizeSearch(stream.name || '').charAt(0).toUpperCase();
            const letra = /[A-Z]/.test(first) ? first : '#';
            return letra === letterFilter;
        });
    }, [groupedStreams, sortMode, letterFilter]);

    // Grade vazia numa TV e indistinguivel de defeito. Dizer QUAIS filtros
    // estao ligados e o que fecha a duvida — o caso classico e genero e
    // categoria se contradizendo ("Comedia" com a categoria "Terror" aberta).
    const filtrosLigados = [
        searchQuery ? `busca "${searchQuery}"` : '',
        selectedCategory !== 'all' ? 'categoria' : '',
        genero ? `genero ${rotuloDoGenero(genero)}` : '',
        letterFilter ? `letra ${letterFilter}` : '',
        activeTags.length > 0 ? activeTags.join('+') : '',
        filters.decade > 0 ? `${filters.decade}s` : '',
        filters.minRating > 0 ? `nota ${filters.minRating}+` : '',
        hideWatchedOn ? 'esconder assistidos' : '',
    ].filter(Boolean);

    // Barra A-Z (item 23): navegável por D-pad (→ da última coluna entra)
    const alphabetIndex = useMemo(() => {
        if (sortMode !== 'name') return null;
        const map = new Map<string, number>();
        // Sobre a lista SEM o filtro de letra: senão, ao escolher "S" a barra
        // passaria a mostrar só o "S" e não haveria como voltar às outras
        sortCatalog(groupedStreams, sortMode).forEach((stream, index) => {
            const first = normalizeSearch(stream.name || '').charAt(0).toUpperCase();
            const letter = /[A-Z]/.test(first) ? first : '#';
            if (!map.has(letter)) map.set(letter, index);
        });
        return map;
    }, [sortMode, groupedStreams]);

    // Seleção limpa ao trocar busca/categoria — a ficha aberta pode não
    // fazer mais parte do resultado filtrado
    useEffect(() => {
        setSelectedMovie(null);
    }, [searchQuery, selectedCategory]);

    const openMovieModal = useCallback((movie: VODStream) => {
        setSelectedMovie(movie);
        setShowModal(true);
    }, []);

    const {
        focusedIndex: focusedMovieIndex, setFocusedIndex: setFocusedMovieIndex, gridRef,
        handleNavigate: handleMovieGridNavigate, handleSelect: handleMovieGridSelect, handlePageSkip,
    } = useVirtualGridNavigation({
        itemCount: filteredStreams.length,
        columns,
        enabled: focusArea === 'movies',
        onExitUp: () => setFocusArea('categories'),
        onExitLeft: () => setFocusZone('sidebar'),
        onExitRight: () => {
            // Última coluna + barra A-Z visível → entra na barra
            if (alphabetIndex && alphabetIndex.size > 1) {
                setFocusArea('alphabet');
                setAlphabetIndexFocus(0);
                return true;
            }
            return false;
        },
        onSelect: (index) => {
            const movie = filteredStreams[index];
            if (movie) openMovieModal(movie);
        },
    });

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            // Header: 0 busca, 1 categorias, 2 ordenar, 3 assistidos, 4 tags, 5 filtros
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
                setFocusArea('movies');
                setFocusedMovieIndex(0);
            }
        } else if (focusArea === 'movies') {
            handleMovieGridNavigate(direction);
        } else if (focusArea === 'alphabet') {
            const letters = alphabetIndex ? [...alphabetIndex.keys()] : [];
            if (direction === 'up') setAlphabetIndexFocus(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setAlphabetIndexFocus(prev => Math.min(letters.length - 1, prev + 1));
            else if (direction === 'left') setFocusArea('movies');
        }
    };

    const cycleSort = () => {
        setSortMode(prev => {
            const next = catalogSort.next(prev);
            catalogSort.set('movies', next);
            return next;
        });
    };

    const toggleHideWatched = () => {
        setHideWatchedOn(prev => {
            hideWatched.set(!prev);
            return !prev;
        });
    };

    // Salto da barra A-Z: garante que o alvo esteja RENDERIZADO antes de focar
    /**
     * Pular pra uma letra FILTRA a grade em vez de rolar até ela.
     *
     * O salto antigo fazia `visibleCount = índice + 18`: num catálogo de 8 mil
     * títulos, escolher "S" montava ~6 mil cards no mesmo frame — 36 mil nós,
     * 6 mil downloads de capa — e a TV era encerrada pelo sistema. Filtrar
     * monta só o que interessa, e "ver só os S" é o que a pessoa queria.
     */
    const jumpToLetter = (letter: string) => {
        setLetterFilter(prev => (prev === letter ? null : letter));
        setFocusArea('movies');
        setFocusedMovieIndex(0);
    };

    // Chips de tag (item 22): OK cicla nenhum → DUB → LEG → 4K → HD → nenhum
    const cycleTagFilter = () => {
        setActiveTags(prev => {
            if (prev.length === 0) return ['DUB'];
            const index = ALL_VOD_TAGS.indexOf(prev[0]);
            const next = ALL_VOD_TAGS[index + 1];
            return next && next !== 'H265' ? [next] : [];
        });
    };

    // Filtros (item 32): OK cicla década; ← → ajustam nota mínima
    const cycleFilters = () => {
        setFilters(prev => {
            const index = DECADES.indexOf(prev.decade);
            const next = { ...prev, decade: DECADES[(index + 1) % DECADES.length] };
            catalogFilters.set('movies', next);
            return next;
        });
    };


    // Nota mínima (item 32): o filtro EXISTIA em matchesFilters e nenhuma tela
    // o escrevia — filtro morto atrás de um comentário que prometia "← → ajustam
    // nota mínima". Agora tem botão próprio, igual a todos os outros.
    const cycleNota = () => {
        setFilters(prev => {
            const i = MIN_RATINGS.indexOf(prev.minRating);
            const next = { ...prev, minRating: MIN_RATINGS[(i + 1) % MIN_RATINGS.length] };
            catalogFilters.set('movies', next);
            return next;
        });
    };

    // Menu de contexto no card (item 24): 🟡 abre sem entrar na ficha
    const openContextMenu = () => {
        const movie = filteredStreams[focusedMovieIndex];
        if (!movie) return;
        setContextItem(movie);
        setContextIndex(0);
    };

    // Filme adulto com a lista secreta ativa: só a opção secreta, sem Minha Lista
    const contextSecreto = !!contextItem && listaSecretaAtiva && ehFilmeAdulto(contextItem);
    const contextActions = contextItem ? [
        ...(contextSecreto ? [] : [{
            label: storage.isInWatchLater(String(contextItem.stream_id), 'movie')
                ? <><FaBookmark /> Tirar da Minha Lista</> : <><FaRegBookmark /> Adicionar à Lista</>,
            run: () => {
                const added = storage.toggleWatchLater({
                    id: String(contextItem.stream_id),
                    type: 'movie',
                    title: contextItem.name,
                    poster: contextItem.stream_icon || contextItem.cover,
                    rating: contextItem.rating,
                    container: contextItem.container_extension,
                });
                setToast(added ? <><FaBookmark /> Salvo na Minha Lista</> : <><FaRegBookmark /> Removido da Minha Lista</>);
            },
        }]),
        // Só filme adulto e só com a lista secreta ativa
        ...(contextSecreto ? [{
            label: secretList.has(String(contextItem.stream_id))
                ? <><FaFire /> Tirar da lista secreta</> : <><FaFire /> Lista secreta</>,
            run: () => toggleSecreto(contextItem),
        }] : []),
        {
            label: <><FaPlay /> Assistir agora</>,
            run: () => {
                setPlayingMovie(contextItem);
                setShowPlayer(true);
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
                // Sem fallback destrutivo: item novo sem branch não pode cair
                // numa ação alheia (lição registrada na R2)
                const item = toolbarItems[focusedCategoryIndex - HEADER_BASE];
                if (item === 'sort') cycleSort();
                else if (item === 'hidewatched') toggleHideWatched();
                else if (item === 'tags') cycleTagFilter();
                else if (item === 'decade') cycleFilters();
                else if (item === 'genero') botaoGenero();
                else if (item === 'nota') cycleNota();
                else if (item === 'secret') setSecretListOpen(true);
            }
        } else if (focusArea === 'alphabet') {
            const entries = alphabetIndex ? [...alphabetIndex.entries()] : [];
            const entry = entries[alphabetIndexFocus];
            if (entry) jumpToLetter(entry[0]);
        } else if (focusArea === 'movies') {
            handleMovieGridSelect();
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    const navEnabled = !error && (focusZone === 'content' && !showModal && !showPlayer && !categoryMenuOpen && !contextItem && !adultoPinAberto && !generoPickerOpen
        && !secretListOpen && !secretPlaying);

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onAction: (action) => {
            if (action === 'yellow' && focusArea === 'movies') openContextMenu();
        },
        enabled: navEnabled,
    });

    // Menu de contexto: navegação própria
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

    // CH+/CH- pulam uma página inteira da grade (item 25)
    useEffect(() => {
        if (!navEnabled || focusArea !== 'movies') return;
        const handlePageKeys = (event: KeyboardEvent) => {
            const key = event.key || String(event.keyCode);
            const code = event.keyCode;
            const isUp = key === 'MediaChannelUp' || code === 427 || key === 'PageUp' || code === 33;
            const isDown = key === 'MediaChannelDown' || code === 428 || key === 'PageDown' || code === 34;
            if (!isUp && !isDown) return;
            event.preventDefault();
            handlePageSkip(isUp ? 'up' : 'down');
        };
        window.addEventListener('keydown', handlePageKeys);
        return () => window.removeEventListener('keydown', handlePageKeys);
    }, [navEnabled, focusArea, handlePageSkip]);

    // Altura da linha: pôster 2:3 + a faixa de título + o gap entre linhas.
    const movieCardHeight = Math.round((columnWidth - CARD_GAP) * 1.5) + CARD_INFO_HEIGHT + CARD_GAP;
    const movieRowCount = Math.max(1, Math.ceil(filteredStreams.length / columns));
    const movieCellProps = useMemo<MovieCellProps>(() => ({
        items: filteredStreams,
        columns,
        focusedIndex: focusArea === 'movies' ? focusedMovieIndex : -1,
        gap: CARD_GAP,
        isBroken,
        onImageError: markBroken,
        onSelect: openMovieModal,
        selectedId: selectedMovie?.stream_id,
        nowMs,
        versionsOf,
    }), [filteredStreams, columns, focusArea, focusedMovieIndex, isBroken, markBroken, openMovieModal, selectedMovie, nowMs, versionsOf]);

    // Loading State
    if (loading) {
        return (
            <div className="movies-page">
                <div className="movies-bg-gradient" />
                <div className="movies-loading">
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
                icon={FaFilm}
                title="Erro ao carregar filmes"
                message={error}
                className="movies-error-container"
            />
        );
    }

    return (
        <div className="movies-page">
            {/* Dynamic Background */}
            <div className="movies-bg-gradient" />
            {selectedMovie && (selectedMovie.stream_icon || selectedMovie.cover) && (
                <div
                    className="movies-backdrop"
                    style={{ backgroundImage: `url(${selectedMovie.stream_icon || selectedMovie.cover})` }}
                />
            )}

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar filmes..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categoriasDoMenu}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="vod"
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 1}
                onOpenChange={setCategoryMenuOpen}
            />

            {adultoPinAberto && (
                <PinPrompt
                    title="Conteúdo adulto"
                    hint={adultoPinProvisionado
                        ? 'PIN padrão: 0000 (altere em Configurações)'
                        : 'Digite o PIN'}
                    parental
                    onSubmit={async (pin) => {
                        const ok = await parentalService.verify(pin);
                        if (ok) {
                            setAdultoPinAberto(false);
                            setAdultoDesbloqueado(true);
                            setSelectedCategory('all');
                            setGenero(GENERO_ADULTO);
                        }
                        return ok;
                    }}
                    onCancel={() => setAdultoPinAberto(false)}
                />
            )}

            {generoPickerOpen && (
                <GenrePicker
                    generos={generosDoCatalogo}
                    selecionado={genero}
                    onEscolher={escolherGenero}
                    onFechar={() => setGeneroPickerOpen(false)}
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
                    className={`toolbar-btn ${activeTags.length > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('tags') ? 'tv-focused' : ''}`}
                    onClick={cycleTagFilter}
                    title="Filtrar por Dublado/Legendado/qualidade"
                >
                    {activeTags.length > 0 ? activeTags.join('+') : <><FaTag /> Tags</>}
                </button>
                <button
                    className={`toolbar-btn ${filters.decade > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('decade') ? 'tv-focused' : ''}`}
                    onClick={cycleFilters}
                    title="Filtrar por década"
                >
                    {filters.decade > 0 ? `${filters.decade}s` : <><FaCalendarAlt /> Década</>}
                </button>
                {generosDoCatalogo.length > 0 && (
                    <button
                        className={`toolbar-btn ${genero ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('genero') ? 'tv-focused' : ''}`}
                        onClick={botaoGenero}
                        title={modoAdulto ? 'Sair do conteúdo adulto (pede o PIN pra voltar)' : 'Filtrar por gênero'}
                    >
                        {genero ? rotuloDoGenero(genero) : <><FaTheaterMasks /> Gênero</>}
                    </button>
                )}
                {listaSecretaAtiva && (
                    <button
                        className={`toolbar-btn ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('secret') ? 'tv-focused' : ''}`}
                        onClick={() => setSecretListOpen(true)}
                        title="Lista secreta"
                    >
                        <FaFire />
                    </button>
                )}
                <button
                    className={`toolbar-btn ${filters.minRating > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('nota') ? 'tv-focused' : ''}`}
                    onClick={cycleNota}
                    title="Nota mínima"
                >
                    {filters.minRating > 0 ? <><FaStar /> {filters.minRating}+</> : <><FaStar /> Nota</>}
                </button>
            </div>

            {secretListOpen && !secretPlaying && (
                <SecretList
                    onClose={() => setSecretListOpen(false)}
                    onPlay={(itens, indice, momento) => setSecretPlaying({ itens, indice, momento })}
                />
            )}

            {secretPlaying && (
                <SecretPlayer
                    itens={secretPlaying.itens}
                    indiceInicial={secretPlaying.indice}
                    momentoInicial={secretPlaying.momento}
                    // Volta pra lista (já relida, com os momentos novos)
                    onClose={() => setSecretPlaying(null)}
                />
            )}

            {/* Content Detail Modal */}
            {selectedMovie && (
                <ContentDetailModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setSelectedMovie(null);
                    }}
                    contentId={String(selectedMovie.stream_id)}
                    contentType="movie"
                    contentData={{
                        name: selectedMovie.name,
                        cover: selectedMovie.stream_icon || selectedMovie.cover,
                        rating: selectedMovie.rating,
                        plot: selectedMovie.plot,
                        genre: selectedMovie.genre,
                        cast: selectedMovie.cast,
                        director: selectedMovie.director,
                        release_date: selectedMovie.release_date,
                        container_extension: selectedMovie.container_extension,
                        runtime: selectedMovie.episode_run_time,
                        tmdbId: selectedMovie.tmdb_id,
                        // Item 18: o campo existe no Xtream e ninguém lia
                        youtubeTrailer: selectedMovie.youtube_trailer,
                    }}
                    onPlay={() => {
                        // Start video playback
                        setPlayingMovie(selectedMovie);
                        setShowPlayer(true);
                        setShowModal(false);
                    }}
                    // Saga (item 29): esta é a ÚNICA tela que tem o catálogo
                    // de filmes inteiro em mãos. Nas outras cinco que abrem a
                    // mesma ficha a fileira simplesmente não existe — melhor
                    // que um card focável que não abre nada.
                    catalogoFilmes={streams}
                    secretList={listaSecretaAtiva && ehFilmeAdulto(selectedMovie) ? {
                        active: secretList.has(String(selectedMovie.stream_id)),
                        onToggle: () => toggleSecreto(selectedMovie),
                    } : undefined}
                    onOpenRelated={(streamId) => {
                        const alvo = streams.find(m => String(m.stream_id) === streamId);
                        if (!alvo) return;
                        // Troca o conteúdo da ficha sem fechá-la: o reset de
                        // foco por contentId já cuida de reancorar o D-pad
                        setSelectedMovie(alvo);
                    }}
                    versions={(versionsOf.get(String(selectedMovie.stream_id)) || []).map(v => ({
                        id: String(v.stream_id),
                        label: versionLabel(v.name),
                    }))}
                    onSelectVersion={(versionId) => {
                        const version = (versionsOf.get(String(selectedMovie.stream_id)) || [])
                            .find(v => String(v.stream_id) === versionId);
                        if (version) {
                            // O progresso é do GRUPO (id do representante):
                            // trocar de versão não pode zerar o "continuar
                            // assistindo" nem o hide-watched do card
                            setPlayingMovie({
                                ...version,
                                stream_id: selectedMovie.stream_id,
                                playStreamId: Number(version.stream_id),
                            });
                            setShowPlayer(true);
                            setShowModal(false);
                        }
                    }}
                />
            )}

            {/* Filme adulto com a lista secreta ativa: player secreto (momentos,
                miniaturas, abre no 1º momento, sem progresso/uso) — tocado da
                grade ou da ficha, não só do botão da lista */}
            {showPlayer && playingMovie && listaSecretaAtiva && ehFilmeAdulto(playingMovie) && (() => {
                // ⏮/⏭ andam pelos filmes ADULTOS da grade atual, na ordem dela;
                // cada um traz os momentos que já tiver na lista secreta
                const id = String(playingMovie.stream_id);
                const salvos = new Map(secretList.list().map(item => [item.id, item]));
                const comoItem = (m: VODStream): ItemSecreto => salvos.get(String(m.stream_id)) ?? {
                    id: String(m.stream_id),
                    title: m.name,
                    poster: m.stream_icon || m.cover,
                    container: m.container_extension,
                    addedAt: 0,
                    moments: [],
                };
                let itens = filteredStreams.filter(ehFilmeAdulto).map(comoItem);
                let indice = itens.findIndex(item => item.id === id);
                if (indice < 0) {
                    itens = [comoItem(playingMovie), ...itens];
                    indice = 0;
                }
                return (
                    <SecretPlayer
                        key={id}
                        itens={itens}
                        indiceInicial={indice}
                        onClose={() => {
                            setShowPlayer(false);
                            setPlayingMovie(null);
                        }}
                    />
                );
            })()}

            {/* Video Player (com retomada e progresso salvo) */}
            {showPlayer && playingMovie && !(listaSecretaAtiva && ehFilmeAdulto(playingMovie)) && (
                <MoviePlayer
                    movieId={String(playingMovie.stream_id)}
                    title={playingMovie.name}
                    poster={playingMovie.stream_icon || playingMovie.cover}
                    container={playingMovie.container_extension}
                    streamId={playingMovie.playStreamId ?? playingMovie.stream_id}
                    year={playingMovie.release_date?.slice(0, 4)}
                    onClose={() => {
                        setShowPlayer(false);
                        setPlayingMovie(null);
                    }}
                />
            )}

            {/* Movies Grid — virtualizado (react-window): o catálogo pode ter
                milhares de títulos, e só a janela visível+overscan monta. */}
            <div ref={scrollContainerRef} className="movies-content">
                {filteredStreams.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon"><FaFilm /></div>
                        {contentFlags.includeVOD() ? (
                            <>
                                <p>Nenhum filme encontrado</p>
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
                        className="movies-grid-viewport"
                        gridRef={gridRef}
                        cellComponent={MovieGridCell}
                        cellProps={movieCellProps}
                        columnCount={columns}
                        columnWidth={columnWidth}
                        rowCount={movieRowCount}
                        rowHeight={movieCardHeight}
                        overscanCount={1}
                        style={{ height: '100%', width: '100%' }}
                    />
                )}
            </div>

            {/* Barra A-Z (só com ordenação por nome) */}
            {alphabetIndex && alphabetIndex.size > 1 && (
                <div className="alphabet-bar">
                    {[...alphabetIndex.keys()].map((letter, position) => (
                        <button
                            key={letter}
                            className={`alphabet-letter ${letterFilter === letter ? 'active' : ''} ${focusArea === 'alphabet' && alphabetIndexFocus === position ? 'tv-focused' : ''}`}
                            onClick={() => jumpToLetter(letter)}
                        >
                            {letter}
                        </button>
                    ))}
                </div>
            )}

            {toast && <div className="catalog-toast">{toast}</div>}

            {/* Menu de contexto do card (item 24) */}
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
            <div className="movies-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
                <RemoteColorHint color="yellow" label="Ações" />
                <span>CH± Página</span>
            </div>
        </div>
    );
}
