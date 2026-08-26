// Home Page - Matching NeoStream Desktop

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    FaExclamationTriangle, FaClock, FaSync, FaBroadcastTower, FaFilm, FaTv, FaPlay,
    FaListOl, FaCalendarPlus, FaLightbulb, FaBolt, FaHeart, FaCog, FaRandom,
} from 'react-icons/fa';
import { api } from '../services/api';
import type { VODStream, Series, LiveStream } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { progressService, type MovieProgress, type SeriesProgress } from '../services/progressService';
import { storage } from '../services/storage';
import { categoryAffinity, scoreRecommendations, spinRoulette, newEpisodes, normalizeSearch } from '../services/catalogExtras';
import { usageStats } from '../services/usageStats';
import { kidsFilter, isAdultCategoryName } from '../services/kidsFilter';
import { parentalService } from '../services/parentalService';
import { contentFlags } from '../services/contentFlags';
import { computeDefaultVisibleChannels } from '../services/liveVisibility';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import { HomeCard } from './HomeCard';
import { HomeChannelPreview, HomeChannelCoverRow } from './HomeChannelPreview';
import './Home.css';
import { accountService } from '../services/accountService';

type ContinueItem =
    | { kind: 'movie'; progress: MovieProgress }
    | { kind: 'series'; progress: SeriesProgress };

interface PlayableMovie {
    id: string;
    name: string;
    poster?: string;
    container?: string;
}

interface HomeProps {
    onNavigate?: (page: string) => void;
    /** Voltar na Home é o pedido de saída — a cadeia inteira vive no App. */
    onRequestExit: () => void;
    /** Qualquer movimento no controle cancela o aviso de saída. */
    onCancelExit: () => void;
}

interface ContentCounts {
    live: number;
    vod: number;
    series: number;
}

export function Home({ onNavigate , onRequestExit, onCancelExit}: HomeProps) {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<ContentCounts>({ live: 0, vod: 0, series: 0 });
    const [recentMovies, setRecentMovies] = useState<VODStream[]>([]);
    const [recentSeries, setRecentSeries] = useState<Series[]>([]);
    const [recommendations, setRecommendations] = useState<(VODStream | Series)[]>([]);
    // "Porque você assistiu X" (item 27): semente EXPLÍCITA e nomeada, ao
    // contrário da fileira de recomendações, que é afinidade anônima
    const [seedRow, setSeedRow] = useState<{ nome: string; itens: (VODStream | Series)[] } | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    // Foco por ID de seção: as seções condicionais (continue/newepisodes)
    // entram ASSINCRONAMENTE e deslocariam um índice posicional
    const [focusedSectionId, setFocusedSectionId] = useState('stats');
    const [focusedItem, setFocusedItem] = useState(0);

    // Continuar assistindo (fileira some no perfil Kids: o progresso é
    // global do aparelho e pode conter títulos adultos)
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());
    const [continueItems, setContinueItems] = useState<ContinueItem[]>(() =>
        kidsFilter.isKidsActive() ? [] : progressService.getContinueWatching()
    );
    // OK num pôster abria a página Filmes inteira, no topo, sem o item
    // selecionado — o usuário perdia o que tinha achado
    const [detailItem, setDetailItem] = useState<VODStream | Series | null>(null);
    // A Home engolia qualquer falha e mostrava "0 canais / 0 filmes / 0
    // séries" sem uma palavra: o usuário concluía que a lista tinha sido
    // cancelada, não que a rede tinha caído
    const [loadError, setLoadError] = useState('');
    const [playingMovie, setPlayingMovie] = useState<PlayableMovie | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Top 10 pelos mais assistidos locais (item 33)
    const [topItems, setTopItems] = useState<Array<VODStream | Series>>([]);

    // Novos episódios de séries seguidas + roleta 🎲
    const [newEpisodesList, setNewEpisodesList] = useState<Series[]>([]);
    const rouletteRef = useRef<{ pool: VODStream[]; affinity: Map<string, number> } | null>(null);

    // Prévia de canal ao vivo (último assistido, ou sugestão aleatória
    // dentre os visíveis por padrão — ver src/services/liveVisibility.ts),
    // mais uma fileira de OUTROS canais candidatos só com a capa: clicar um
    // deles troca qual canal toca na prévia grande (não navega); clicar de
    // novo na prévia (o mesmo canal, agora já selecionado) é que abre o
    // player. `lastWatchedId` fica separado pra decidir o rótulo da seção
    // ("Continue assistindo" só quando o SELECIONADO é o último de verdade
    // — escolher outro canal na fileira já deixa de ser "continuar").
    const [channelPreviewPool, setChannelPreviewPool] = useState<{ lastWatchedId: number | null; channels: LiveStream[] } | null>(null);
    const [selectedPreviewChannelId, setSelectedPreviewChannelId] = useState<number | null>(null);

    const refreshContinue = useCallback(() => {
        setContinueItems(kidsActive ? [] : progressService.getContinueWatching());
    }, [kidsActive]);

    // Update clock every minute
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true);
                // "Incluir canais de TV"/"Incluir VOD" desmarcados no login:
                // nem busca esse tipo — a fileira correspondente fica vazia
                // sozinha, sem precisar mudar a renderização de cada uma.
                const includeTV = contentFlags.includeTV();
                const includeVOD = contentFlags.includeVOD();
                // Categorias sempre juntas com os itens (não só pra kids): a
                // Home não tem "selecionar a categoria pra provar o PIN" como
                // Filmes/Séries/TV ao Vivo têm — aqui a categoria travada por
                // PIN precisa sumir incondicionalmente de toda fileira, senão
                // um filme "adulto" aparecia normal em Recentes/Recomendados/
                // Surpreenda-me sem NUNCA pedir PIN.
                const [rawStreams, rawMovies, rawSeries, liveCats, vodCats, seriesCats] = await Promise.all([
                    includeTV ? api.getLiveStreams() : Promise.resolve([]),
                    includeVOD ? api.getVODStreams() : Promise.resolve([]),
                    includeVOD ? api.getSeries() : Promise.resolve([]),
                    includeTV ? api.getLiveCategories() : Promise.resolve([]),
                    includeVOD ? api.getVodCategories() : Promise.resolve([]),
                    includeVOD ? api.getSeriesCategories() : Promise.resolve([])
                ]);
                let streams = rawStreams;
                let movies = rawMovies;
                let series = rawSeries;

                // Gate do perfil Kids (some com mais categoria que só a
                // adulta) tem prioridade; perfil normal ainda assim não vê
                // categoria travada por PIN nas fileiras da Home.
                if (kidsFilter.isKidsActive()) {
                    streams = kidsFilter.apply(streams, liveCats).items;
                    movies = kidsFilter.apply(movies, vodCats).items;
                    series = kidsFilter.apply(series, seriesCats).items;
                } else if (parentalService.getGates().adultCategories) {
                    const lockedLive = new Set(liveCats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                    const lockedVod = new Set(vodCats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                    const lockedSeries = new Set(seriesCats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                    streams = streams.filter(s => !lockedLive.has(s.category_id));
                    movies = movies.filter(m => !lockedVod.has(m.category_id));
                    series = series.filter(s => !lockedSeries.has(s.category_id));
                }

                setCounts({
                    live: streams.length,
                    vod: movies.length,
                    series: series.length
                });

                // Prévia de canal ao vivo: o último assistido (se ainda
                // existir no catálogo já filtrado por Kids/adulto) puxa a
                // prévia grande; senão sorteia 1 dentre os visíveis por
                // padrão (mesma pipeline de curadoria/dedup de TV ao Vivo —
                // ver liveVisibility.ts). Os DEMAIS canais visíveis (até 24)
                // viram a fileira de capas ao lado, pra trocar a prévia sem
                // sair da Home. `streams` aqui já vem vazio quando "Incluir
                // canais de TV" está desligado, então a seção some sozinha.
                if (streams.length > 0) {
                    const visible = computeDefaultVisibleChannels(streams, liveCats);
                    const lastChannelId = storage.getLastChannel();
                    const lastChannel = lastChannelId
                        ? streams.find(s => s.stream_id === lastChannelId)
                        : undefined;
                    const hero = lastChannel
                        ?? (visible.length > 0 ? visible[Math.floor(Math.random() * visible.length)] : null);
                    if (hero) {
                        const others = visible.filter(c => c.stream_id !== hero.stream_id).slice(0, 24);
                        setChannelPreviewPool({ lastWatchedId: lastChannel ? lastChannel.stream_id : null, channels: [hero, ...others] });
                        setSelectedPreviewChannelId(hero.stream_id);
                    } else {
                        setChannelPreviewPool(null);
                        setSelectedPreviewChannelId(null);
                    }
                } else {
                    setChannelPreviewPool(null);
                    setSelectedPreviewChannelId(null);
                }

                // Get recent items (newest first based on 'added' field)
                const sortedMovies = [...movies].sort((a, b) =>
                    parseInt(b.added || '0') - parseInt(a.added || '0')
                ).slice(0, 15);

                const sortedSeries = [...series].sort((a, b) =>
                    new Date(b.last_modified || 0).getTime() - new Date(a.last_modified || 0).getTime()
                ).slice(0, 15);

                setRecentMovies(sortedMovies);
                setRecentSeries(sortedSeries);

                // Recomendações por afinidade de categoria (histórico + favoritos);
                // sem histórico, cai no aleatório de antes
                const movieIdsWatched = progressService.getMovieIdsWithProgress();
                const seriesIdsWatched = progressService.getSeriesIdsWithProgress();
                const favorites = storage.getFavorites();
                const favMovieIds = new Set(favorites.filter(f => f.type === 'movie').map(f => f.id));
                const favSeriesIds = new Set(favorites.filter(f => f.type === 'series').map(f => f.id));

                const likedCategoryIds: string[] = [];
                for (const movie of movies) {
                    const id = String(movie.stream_id);
                    if (movieIdsWatched.has(id) || favMovieIds.has(id)) likedCategoryIds.push(movie.category_id);
                }
                for (const s of series) {
                    const id = String(s.series_id);
                    if (seriesIdsWatched.has(id) || favSeriesIds.has(id)) likedCategoryIds.push(s.category_id);
                }
                const affinity = categoryAffinity(likedCategoryIds);

                const unwatchedMovies = movies.filter(m => !movieIdsWatched.has(String(m.stream_id)));
                const unwatchedSeries = series.filter(s => !seriesIdsWatched.has(String(s.series_id)));

                let recommended: (VODStream | Series)[] = [];
                if (affinity.size > 0) {
                    // Pré-filtro pelas categorias com afinidade: evita ordenar
                    // o catálogo inteiro no main thread da TV
                    const affineMovies = unwatchedMovies.filter(m => affinity.has(m.category_id));
                    const affineSeries = unwatchedSeries.filter(s => affinity.has(s.category_id));
                    recommended = [
                        ...scoreRecommendations(affineMovies, affinity).slice(0, 8),
                        ...scoreRecommendations(affineSeries, affinity).slice(0, 7),
                    ];
                }
                if (recommended.length < 5) {
                    const randomMovies = [...movies].sort(() => Math.random() - 0.5).slice(0, 8);
                    const randomSeries = [...series].sort(() => Math.random() - 0.5).slice(0, 7);
                    recommended = [...randomMovies, ...randomSeries].sort(() => Math.random() - 0.5);
                }
                setRecommendations(recommended);

                // Fileira com SEMENTE nomeada (item 27). Resolver a semente
                // contra `movies`/`series` — que já passaram pelo gate kids —
                // é o que impede o título "Porque você assistiu <adulto>" de
                // aparecer num perfil infantil: o progresso não passa por gate
                // nenhum, o catálogo passa.
                const sementes = progressService.getWatchSeeds();
                let fileiraDaSemente: { nome: string; itens: (VODStream | Series)[] } | null = null;
                for (const semente of sementes) {
                    const noCatalogo: VODStream | Series | undefined = semente.kind === 'movie'
                        ? movies.find(m => String(m.stream_id) === semente.id)
                        : series.find(sr => String(sr.series_id) === semente.id);
                    if (!noCatalogo) continue;

                    const categoria = noCatalogo.category_id;
                    const candidatos: (VODStream | Series)[] = [
                        ...unwatchedMovies.filter(m => m.category_id === categoria),
                        ...unwatchedSeries.filter(sr => sr.category_id === categoria),
                    ].filter(item => getId(item) !== getId(noCatalogo));

                    // Menos de 4 não vira fileira: uma linha com dois cards
                    // parece defeito e ainda rouba um degrau do D-pad
                    if (candidatos.length < 4) continue;
                    candidatos.sort((a, b) => (b.rating_5based || 0) - (a.rating_5based || 0));
                    fileiraDaSemente = { nome: semente.name, itens: candidatos.slice(0, 12) };
                    break;
                }
                setSeedRow(fileiraDaSemente);

                // Top 10 (item 33): mais assistidos pelo tempo local, casados
                // com o catálogo por nome normalizado
                // Pede folga: entradas 'live' e sem match no catálogo comem vagas
                const usage = usageStats.summary(40);
                if (usage.topItems.length > 0) {
                    const byName = new Map<string, VODStream | Series>();
                    for (const movie of movies) byName.set(normalizeSearch(movie.name || ''), movie);
                    for (const s of series) byName.set(normalizeSearch(s.name || ''), s);
                    const top: Array<VODStream | Series> = [];
                    for (const entry of usage.topItems) {
                        if (entry.kind === 'live') continue;
                        // Nome COMPLETO primeiro (é o que foi gravado); só cai
                        // no prefixo pra episódio ("Série - T1 E2")
                        const full = normalizeSearch(entry.name || '');
                        const found = byName.get(full)
                            || (full.includes(' - ') ? byName.get(full.split(' - ')[0]) : undefined);
                        if (found && !top.includes(found)) top.push(found);
                        if (top.length >= 10) break;
                    }
                    setTopItems(top);
                }

                // Pool da roleta 🎲 (filmes não vistos, ponderados pelo gosto)
                rouletteRef.current = { pool: unwatchedMovies, affinity };

                // Novos episódios de séries seguidas (diff de last_modified)
                const followedIds = new Set([...seriesIdsWatched, ...favSeriesIds]);
                const followedSeries = series.filter(s => followedIds.has(String(s.series_id)));
                newEpisodes.seed(followedSeries.map(s => ({
                    seriesId: String(s.series_id),
                    lastModified: s.last_modified || '0',
                })));
                setNewEpisodesList(
                    followedSeries
                        .filter(s => newEpisodes.has(String(s.series_id), s.last_modified || '0'))
                        .slice(0, 15)
                );

            } catch (error) {
                console.error('Failed to fetch data:', error);
                // Mostrar "0 canais / 0 filmes / 0 séries" sem uma palavra
                // fazia o usuário concluir que a lista dele foi cancelada
                setLoadError(error instanceof Error ? error.message : 'Não foi possível falar com o provedor.');
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, []);

    // Time formatting
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    // Greeting based on time of day (as per original app)
    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    };

    // Cards de estatística e Acesso Rápido: ancorados por ARRAY, não por
    // índice fixo — "Incluir canais de TV"/"Incluir VOD" desligados tiram um
    // card, e um índice hardcoded (o padrão antigo) apontaria pro card
    // errado. Mesmo defeito que já mandou o foco pro botão errado em
    // Movies.tsx (toolbar ancorada por id, não por posição) — aqui a lição já
    // vale desde o primeiro commit.
    const includeTV = contentFlags.includeTV();
    const includeVOD = contentFlags.includeVOD();

    // Roleta 🎲: filme não visto, ponderado pelas categorias que o usuário curte
    const surpriseMe = () => {
        const data = rouletteRef.current;
        if (!data || data.pool.length === 0) return;
        // Refiltra na hora do sorteio: o pool do fetch pode conter um filme
        // que o usuário acabou de assistir nesta mesma sessão
        const watched = progressService.getMovieIdsWithProgress();
        const pool = data.pool.filter(m => !watched.has(String(m.stream_id)));
        const pick = spinRoulette(pool.length > 0 ? pool : data.pool, data.affinity);
        if (pick) {
            setPlayingMovie({
                id: String(pick.stream_id),
                name: pick.name,
                poster: pick.stream_icon || pick.cover,
                container: pick.container_extension,
            });
        }
    };

    // Canal selecionado na prévia (hero) + os demais candidatos, com o
    // selecionado sempre removido da fileira de capas (ele já está grande,
    // não faz sentido repetir pequeno do lado). Recalcular a cada render é
    // barato (≤25 itens) e evita guardar essa relação duas vezes.
    const previewChannels = channelPreviewPool?.channels ?? [];
    const selectedPreviewChannel = previewChannels.find(c => c.stream_id === selectedPreviewChannelId) ?? null;
    const otherPreviewChannels = selectedPreviewChannel
        ? previewChannels.filter(c => c.stream_id !== selectedPreviewChannel.stream_id)
        : previewChannels;
    const isLastWatchedSelected = !!selectedPreviewChannel && selectedPreviewChannel.stream_id === channelPreviewPool?.lastWatchedId;

    const statsCards = [
        ...(includeTV ? [{ page: 'live', icon: FaBroadcastTower, value: counts.live, label: 'Canais', cls: 'stat-card-live' }] : []),
        ...(includeVOD ? [{ page: 'movies', icon: FaFilm, value: counts.vod, label: 'Filmes', cls: 'stat-card-vod' }] : []),
        ...(includeVOD ? [{ page: 'series', icon: FaTv, value: counts.series, label: 'Séries', cls: 'stat-card-series' }] : []),
    ];
    const quickItems = [
        ...(includeTV ? [{ page: 'live', icon: FaBroadcastTower, label: 'TV ao Vivo', action: () => onNavigate?.('live') }] : []),
        ...(includeVOD ? [{ page: 'movies', icon: FaFilm, label: 'Filmes', action: () => onNavigate?.('movies') }] : []),
        ...(includeVOD ? [{ page: 'series', icon: FaTv, label: 'Séries', action: () => onNavigate?.('series') }] : []),
        { page: 'favorites', icon: FaHeart, label: 'Favoritos', action: () => onNavigate?.('favorites') },
        { page: 'settings', icon: FaCog, label: 'Configurações', action: () => onNavigate?.('settings') },
        // "Surpreenda-me" sorteia um filme não visto — sem VOD não há pool
        // nenhum, então o botão nem entra na lista quando includeVOD=false.
        ...(includeVOD ? [{ page: 'roulette', icon: FaRandom, label: 'Surpreenda-me', action: surpriseMe }] : []),
    ];

    // TV Navigation - seções dinâmicas ("continue"/"newepisodes" condicionais)
    // A ORDEM aqui tem que ser a MESMA do DOM, senão ↓ move o foco pra cima na
    // tela. E seção sem item nenhum não pode entrar: o foco sumia por três
    // apertos de ↓ numa playlist só de canais.
    const sections = [
        ...(statsCards.length > 0 ? [{ id: 'stats', items: statsCards.length }] : []),
        ...(selectedPreviewChannel ? [{ id: 'channelpreview', items: 1 + otherPreviewChannels.length }] : []),
        ...(continueItems.length > 0 ? [{ id: 'continue', items: continueItems.length }] : []),
        ...(seedRow ? [{ id: 'seed', items: seedRow.itens.length }] : []),
        ...(topItems.length > 0 ? [{ id: 'top10', items: topItems.length }] : []),
        ...(newEpisodesList.length > 0 ? [{ id: 'newepisodes', items: newEpisodesList.length }] : []),
        ...(recommendations.length > 0 ? [{ id: 'recommendations', items: recommendations.length }] : []),
        ...(recentSeries.length > 0 ? [{ id: 'series', items: recentSeries.length }] : []),
        ...(recentMovies.length > 0 ? [{ id: 'movies', items: recentMovies.length }] : []),
        { id: 'quick', items: quickItems.length }
    ];

    const sectionIndex = (id: string) => sections.findIndex(s => s.id === id);
    const focusedSection = Math.max(0, sectionIndex(focusedSectionId));

    /** Abre a ficha do título (mesmo caminho de Filmes, Séries e Favoritos). */
    const openDetail = useCallback((item: VODStream | Series) => setDetailItem(item), []);

    /** Monta a fila de episódios a partir da ficha e começa a tocar. */
    const playSeriesFromDetail = async (serie: Series, season?: number, episode?: number) => {
        try {
            const queue = await buildEpisodeQueue(
                String(serie.series_id),
                serie.name,
                serie.cover || '',
                season ?? 1,
                episode ?? 1
            );
            if (queue) {
                setSeriesQueue(queue);
                setDetailItem(null);
            }
        } catch (err) {
            console.error('Erro ao montar a fila de episódios:', err);
        }
    };

    const playContinueItem = useCallback(async (item: ContinueItem) => {
        if (item.kind === 'movie') {
            setPlayingMovie(item.progress);
        } else {
            try {
                const queue = await buildEpisodeQueue(
                    item.progress.seriesId,
                    item.progress.seriesName,
                    item.progress.poster,
                    item.progress.season,
                    item.progress.episode
                );
                if (queue) setSeriesQueue(queue);
            } catch (err) {
                console.error('Error resuming series:', err);
            }
        }
    }, []);

    // Callbacks estáveis por FILEIRA (não por card) — é o que faz o
    // React.memo do HomeCard funcionar. `onNavigate?.('stream_id' in item
    // ? 'movies' : 'series')` se repete em Top10 e Recomendados: mesmo
    // comportamento, uma função só.
    const handleSelectContinue = useCallback((item: ContinueItem) => { void playContinueItem(item); }, [playContinueItem]);
    const handleSelectCatalogNav = useCallback((item: VODStream | Series) => {
        onNavigate?.('stream_id' in item ? 'movies' : 'series');
    }, [onNavigate]);
    const handleSelectNewEpisode = useCallback((s: Series) => {
        // Marca como visto (o selo some) e vai pra Séries
        newEpisodes.markSeen(String(s.series_id), s.last_modified || '0');
        onNavigate?.('series');
    }, [onNavigate]);
    const handleSelectRecentSeries = useCallback(() => onNavigate?.('series'), [onNavigate]);
    const handleSelectRecentMovie = useCallback(() => onNavigate?.('movies'), [onNavigate]);

    // Mesmo padrão do fluxo "ligar e assistir" pós-login (App.tsx): grava o
    // canal SELECIONADO (não necessariamente o último assistido de
    // verdade — o usuário pode ter trocado clicando na fileira de capas)
    // como último assistido, marca a flag de autoplay de uma vez só
    // (LiveTV.tsx consome e apaga no mount) e troca de página — TV ao Vivo
    // já nasce tocando esse canal, sem precisar selecionar de novo.
    const handleWatchChannelPreview = useCallback(() => {
        if (!selectedPreviewChannel) return;
        storage.setLastChannel(selectedPreviewChannel.stream_id);
        sessionStorage.setItem('neostream_autoplay_last', '1');
        onNavigate?.('live');
    }, [selectedPreviewChannel, onNavigate]);

    // Clicar uma capa da fileira de "outros canais" só TROCA a prévia
    // grande (nova seleção) — não navega. Clicar de novo na prévia (agora
    // já mostrando esse canal) é que chama handleWatchChannelPreview.
    const handleSelectOtherChannel = useCallback((channel: LiveStream) => {
        setSelectedPreviewChannelId(channel.stream_id);
    }, []);

    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        onCancelExit(); // mexeu no controle: não estava saindo
        if (direction === 'up') {
            setFocusedSectionId(sections[Math.max(0, focusedSection - 1)].id);
            setFocusedItem(0);
        } else if (direction === 'down') {
            setFocusedSectionId(sections[Math.min(sections.length - 1, focusedSection + 1)].id);
            setFocusedItem(0);
        } else if (direction === 'left') {
            if (focusedItem === 0) {
                // At first item - move focus to Sidebar
                setFocusZone('sidebar');
            } else {
                setFocusedItem(prev => Math.max(0, prev - 1));
            }
        } else if (direction === 'right') {
            const maxItems = sections[focusedSection]?.items || 0;
            setFocusedItem(prev => Math.min(maxItems - 1, prev + 1));
        }
    };

    const handleEnter = () => {
        const section = sections.find(s => s.id === focusedSectionId) || sections[0];
        if (section?.id === 'stats') {
            const card = statsCards[focusedItem];
            if (card) onNavigate?.(card.page);
        } else if (section?.id === 'channelpreview') {
            if (focusedItem === 0) {
                handleWatchChannelPreview();
            } else {
                const channel = otherPreviewChannels[focusedItem - 1];
                if (channel) handleSelectOtherChannel(channel);
            }
        } else if (section?.id === 'continue') {
            const item = continueItems[focusedItem];
            if (item) void playContinueItem(item);
        } else if (section?.id === 'top10') {
            const item = topItems[focusedItem];
            if (item) openDetail(item);
        } else if (section?.id === 'newepisodes') {
            const s = newEpisodesList[focusedItem];
            if (s) {
                // Marca como visto (o selo some) e abre a ficha da série
                newEpisodes.markSeen(String(s.series_id), s.last_modified || '0');
                openDetail(s);
            }
        } else if (section?.id === 'quick') {
            const item = quickItems[focusedItem];
            if (item) item.action();
        } else if (section?.id === 'movies') {
            const item = recentMovies[focusedItem];
            if (item) openDetail(item);
        } else if (section?.id === 'seed') {
            const item = seedRow?.itens[focusedItem];
            if (item) openDetail(item);
        } else if (section?.id === 'recommendations') {
            const item = recommendations[focusedItem];
            if (item) openDetail(item);
        } else if (section?.id === 'series') {
            const item = recentSeries[focusedItem];
            if (item) openDetail(item);
        }
    };

    // Aviso de validade da lista (item 68). Adiável: 🔴 some por 24h — a Home
    // é a primeira tela do app e um aviso que não some vira ruído permanente.
    const [expiryWarning, setExpiryWarning] = useState(() =>
        accountService.shouldWarnExpiry() ? accountService.daysUntilExpiry() : null
    );

    // Only enable navigation when content is focused and no player is open
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onAction: (action) => {
            if (action !== 'red') return;
            // Os dois avisos podem aparecer JUNTOS (a validade vem do login
            // anterior, a falha de rede é deste mount). O 🔴 adia o de
            // validade primeiro — recarregar a página descartaria o adiamento
            // e o usuário veria o mesmo aviso de novo logo em seguida.
            if (expiryWarning !== null) {
                accountService.snoozeExpiry();
                setExpiryWarning(null);
                return;
            }
            if (loadError) window.location.reload();
        },
        onBack: onRequestExit,
        enabled: focusZone === 'content' && !detailItem && !playingMovie && !seriesQueue,
    });

    // Auto-scroll to focused section when it changes
    useEffect(() => {
        const element = document.getElementById(`home-${focusedSectionId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [focusedSectionId]);

    // ...e a fileira rola na HORIZONTAL junto com o item focado. Sem isso, do
    // 10º pôster em diante o destaque saía pela direita e a tela ficava
    // imóvel — parecia que o app tinha travado.
    useEffect(() => {
        const secao = document.getElementById(`home-${focusedSectionId}`);
        const fileira = secao?.querySelector('.content-row');
        const card = fileira?.children[focusedItem] as HTMLElement | undefined;
        card?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, [focusedSectionId, focusedItem]);

    // Helper to get cover image
    const getCover = (item: VODStream | Series) => {
        if ('stream_id' in item) {
            // VODStream - use stream_icon as primary
            return item.stream_icon || item.cover || '';
        }
        // Series - use cover
        return item.cover || '';
    };

    const getName = (item: VODStream | Series) => {
        return item.name;
    };

    const getId = (item: VODStream | Series) => {
        return 'stream_id' in item ? item.stream_id : item.series_id;
    };

    // Filme e série têm espaços de id INDEPENDENTES no provedor — um filme
    // #6 e uma série #6 são coisas diferentes, mas `key={getId(item)}` sozinho
    // colidia quando os dois apareciam na mesma fileira mista (seed/top10/
    // recomendados). Mesmo prefixo que a fileira "Continuar Assistindo" já usava.
    const getKey = (item: VODStream | Series) => `${'stream_id' in item ? 'm' : 's'}-${getId(item)}`;

    return (
        <div className="home-page">
            {/* Background decorations */}
            <div className="home-bg-decoration home-bg-decoration-1" />
            <div className="home-bg-decoration home-bg-decoration-2" />

            {/* Validade da lista (item 68) */}
            {expiryWarning !== null && (
                <div className={`home-expiry ${expiryWarning < 0 ? 'expired' : ''}`}>
                    <span className="home-expiry-text">
                        <FaExclamationTriangle className="home-expiry-icon" />{' '}
                        {expiryWarning < 0
                            ? 'Sua lista venceu — fale com o provedor pra renovar.'
                            : expiryWarning === 0
                                ? 'Sua lista vence hoje.'
                                : `Sua lista vence em ${expiryWarning} dia(s).`}
                    </span>
                    <span className="home-expiry-hint"><FaClock className="home-expiry-icon" /> lembrar depois</span>
                </div>
            )}

            {/* Header */}
            <header className="home-header">
                <div className="home-header-left">
                    <div className="home-date">{formatDate(currentTime)}</div>
                    <h1 className="home-greeting">
                        {getGreeting()}! <span className="waving-hand">👋</span>
                    </h1>
                    <p className="home-subtitle">O que você quer assistir hoje?</p>
                </div>
                <div className="home-clock">{formatTime(currentTime)}</div>
            </header>

            {loadError && (
                <div className="home-load-error">
                    <span className="home-load-error-text"><FaExclamationTriangle className="home-expiry-icon" /> {loadError}</span>
                    <span className="home-load-error-hint">
                        {expiryWarning !== null
                            ? <><FaClock className="home-expiry-icon" /> adia o aviso acima</>
                            : <><FaSync className="home-expiry-icon" /> tentar de novo</>}
                    </span>
                </div>
            )}

            {/* Stats Cards */}
            {statsCards.length > 0 && (
            <section id="home-stats" className="home-stats">
                {statsCards.map((card, index) => (
                    <button
                        key={card.page}
                        className={`stat-card ${card.cls} ${focusedSection === sectionIndex('stats') && focusedItem === index ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.(card.page)}
                    >
                        <div className="stat-icon"><card.icon /></div>
                        <div className="stat-value">{loading ? '...' : card.value.toLocaleString()}</div>
                        <div className="stat-label">{card.label}</div>
                    </button>
                ))}
            </section>
            )}

            {/* Content Rows - Matching Original App */}
            <section className="home-content">
                {/* Prévia de canal ao vivo + fileira de outros canais (só capa) */}
                {selectedPreviewChannel && (
                    <div id="home-channelpreview" className="content-section home-channel-preview-section">
                        <h2 className="section-title">
                            {isLastWatchedSelected ? 'Continue assistindo ao vivo' : 'Prévia de canal ao vivo'}
                        </h2>
                        <div className="home-channel-preview-row">
                            <HomeChannelPreview
                                key={selectedPreviewChannel.stream_id}
                                channel={selectedPreviewChannel}
                                focused={focusedSection === sectionIndex('channelpreview') && focusedItem === 0}
                                onWatch={handleWatchChannelPreview}
                            />
                            <HomeChannelCoverRow
                                channels={otherPreviewChannels}
                                focusedIndex={
                                    focusedSection === sectionIndex('channelpreview') ? focusedItem - 1 : -1
                                }
                                onSelect={handleSelectOtherChannel}
                            />
                        </div>
                    </div>
                )}

                {/* Continue Watching */}
                {continueItems.length > 0 && (
                    <div id="home-continue" className="content-section">
                        <h2 className="section-title"><FaPlay className="section-title-icon" /> Continuar Assistindo</h2>
                        <div className="content-row">
                            {continueItems.map((item, index) => {
                                const isMovie = item.kind === 'movie';
                                const title = isMovie ? item.progress.name : item.progress.seriesName;
                                const subtitle = isMovie
                                    ? null
                                    : `T${item.progress.season} E${item.progress.episode}`;
                                const pct = item.progress.duration > 0
                                    ? Math.min(100, (item.progress.time / item.progress.duration) * 100)
                                    : 0;
                                const key = isMovie ? `m-${item.progress.id}` : `s-${item.progress.seriesId}`;
                                return (
                                    <HomeCard
                                        key={key}
                                        item={item}
                                        index={index}
                                        focused={focusedSection === sectionIndex('continue') && focusedItem === index}
                                        title={title}
                                        image={item.progress.poster || ''}
                                        fallbackIcon={FaFilm}
                                        onSelect={handleSelectContinue}
                                        subtitle={subtitle && <span className="continue-episode"> · {subtitle}</span>}
                                        imageOverlay={(
                                            <div className="continue-progress">
                                                <div className="continue-progress-fill" style={{ width: `${pct}%` }} />
                                            </div>
                                        )}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Porque você assistiu X (item 27). A condição aqui é a MESMA
                    do array `sections`: seção que existe no DOM e não existe na
                    lista de foco vira uma fileira que o D-pad nunca alcança. */}
                {seedRow && (
                    <div id="home-seed" className="content-section">
                        <h2 className="section-title"><FaPlay className="section-title-icon" /> Porque você assistiu {seedRow.nome}</h2>
                        <div className="content-row">
                            {seedRow.itens.map((item, index) => (
                                <HomeCard
                                    key={getKey(item)}
                                    item={item}
                                    index={index}
                                    focused={focusedSection === sectionIndex('seed') && focusedItem === index}
                                    title={getName(item)}
                                    image={getCover(item)}
                                    fallbackIcon={FaFilm}
                                    onSelect={openDetail}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Top 10 (item 33) */}
                {topItems.length > 0 && (
                    <div id="home-top10" className="content-section">
                        <h2 className="section-title"><FaListOl className="section-title-icon" /> Top 10 do seu aparelho</h2>
                        <div className="content-row">
                            {topItems.map((item, index) => (
                                <HomeCard
                                    key={getKey(item)}
                                    item={item}
                                    index={index}
                                    focused={focusedSection === sectionIndex('top10') && focusedItem === index}
                                    title={getName(item)}
                                    image={getCover(item)}
                                    onSelect={handleSelectCatalogNav}
                                    cardClassName="top10-card"
                                    rankBadge={<span className="top10-rank">{index + 1}</span>}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Novos episódios de séries seguidas */}
                {newEpisodesList.length > 0 && (
                    <div id="home-newepisodes" className="content-section">
                        <h2 className="section-title"><FaCalendarPlus className="section-title-icon" /> Novos Episódios</h2>
                        <div className="content-row">
                            {newEpisodesList.map((s, index) => (
                                <HomeCard
                                    key={s.series_id}
                                    item={s}
                                    index={index}
                                    focused={focusedSection === sectionIndex('newepisodes') && focusedItem === index}
                                    title={s.name}
                                    image={s.cover}
                                    fallbackIcon={FaTv}
                                    onSelect={handleSelectNewEpisode}
                                    imageOverlay={<div className="new-episodes-badge">NOVOS EPS</div>}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Recommendations — condicional IGUAL ao array `sections`.
                    Sem isto, uma playlist sem recomendações desenhava o título
                    "Recomendados Para Você" com uma fileira vazia embaixo. */}
                {recommendations.length > 0 && (
                <div id="home-recommendations" className="content-section">
                    <h2 className="section-title"><FaLightbulb className="section-title-icon" /> Recomendados Para Você</h2>
                    <div className="content-row">
                        {recommendations.map((item, index) => (
                            <HomeCard
                                key={getKey(item)}
                                item={item}
                                index={index}
                                focused={focusedSection === sectionIndex('recommendations') && focusedItem === index}
                                title={getName(item)}
                                image={getCover(item)}
                                fallbackIcon={FaFilm}
                                onSelect={handleSelectCatalogNav}
                            />
                        ))}
                    </div>
                </div>
                )}

                {/* Recent Series — condicional IGUAL ao array `sections` */}
                {recentSeries.length > 0 && (
                <div id="home-series" className="content-section">
                    <h2 className="section-title"><FaCalendarPlus className="section-title-icon" /> Séries Recentes</h2>
                    <div className="content-row">
                        {recentSeries.map((series, index) => (
                            <HomeCard
                                key={series.series_id}
                                item={series}
                                index={index}
                                focused={focusedSection === sectionIndex('series') && focusedItem === index}
                                title={series.name}
                                image={series.cover}
                                fallbackIcon={FaTv}
                                onSelect={handleSelectRecentSeries}
                            />
                        ))}
                    </div>
                </div>

                )}

                {/* Recent Movies — condicional IGUAL ao array `sections` */}
                {recentMovies.length > 0 && (
                <div id="home-movies" className="content-section">
                    <h2 className="section-title"><FaFilm className="section-title-icon" /> Filmes Recentes</h2>
                    <div className="content-row">
                        {recentMovies.map((movie, index) => (
                            <HomeCard
                                key={movie.stream_id}
                                item={movie}
                                index={index}
                                focused={focusedSection === sectionIndex('movies') && focusedItem === index}
                                title={movie.name}
                                image={movie.stream_icon || movie.cover}
                                fallbackIcon={FaFilm}
                                onSelect={handleSelectRecentMovie}
                            />
                        ))}
                    </div>
                </div>
                )}
            </section>

            {/* Quick Access */}
            <section id="home-quick" className="home-quick-access">
                <h2 className="section-title"><FaBolt className="section-title-icon" /> Acesso Rápido</h2>
                <div className="quick-grid">
                    {quickItems.map((item, index) => (
                        <button
                            key={item.page}
                            className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === index ? 'tv-focused' : ''}`}
                            onClick={item.action}
                        >
                            <span className="quick-icon"><item.icon /></span>
                            <span className="quick-label">{item.label}</span>
                        </button>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="home-footer">
                <span>{__BRAND_FULL_NAME__}</span>
                <span>v{__APP_VERSION__}</span>
            </footer>

            {/* Continue Watching: Movie Player */}
            {detailItem && (
                <ContentDetailModal
                    isOpen={true}
                    onClose={() => setDetailItem(null)}
                    contentId={String('stream_id' in detailItem ? detailItem.stream_id : detailItem.series_id)}
                    contentType={'stream_id' in detailItem ? 'movie' : 'series'}
                    contentData={{
                        name: detailItem.name,
                        cover: 'stream_id' in detailItem
                            ? (detailItem.stream_icon || detailItem.cover || '')
                            : (detailItem.cover || ''),
                        plot: detailItem.plot,
                        genre: detailItem.genre,
                        rating: detailItem.rating,
                        release_date: detailItem.release_date,
                        container_extension: 'stream_id' in detailItem ? detailItem.container_extension : undefined,
                    }}
                    onPlay={(season, episode) => {
                        if ('stream_id' in detailItem) {
                            setPlayingMovie({
                                id: String(detailItem.stream_id),
                                name: detailItem.name,
                                poster: detailItem.stream_icon || detailItem.cover || '',
                                container: detailItem.container_extension,
                            } as PlayableMovie);
                            setDetailItem(null);
                        } else {
                            void playSeriesFromDetail(detailItem, season, episode);
                        }
                    }}
                />
            )}

            {playingMovie && (
                <MoviePlayer
                    movieId={playingMovie.id}
                    title={playingMovie.name}
                    poster={playingMovie.poster}
                    container={playingMovie.container}
                    onClose={() => {
                        setPlayingMovie(null);
                        refreshContinue();
                    }}
                />
            )}

            {/* Continue Watching: Series Player */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => {
                        setSeriesQueue(null);
                        refreshContinue();
                    }}
                />
            )}
        </div>
    );
}
