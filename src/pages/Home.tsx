// Home Page - Matching NeoStream Desktop

import { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { LiveChannelPreviewHandle } from '../components/LiveChannelPreview';
import { pipelineEstacionado } from '../services/pipelineEstacionado';
import {
    FaExclamationTriangle, FaClock, FaSync, FaFilm, FaTv, FaPlay,
    FaListOl, FaCalendarPlus, FaLightbulb,
} from 'react-icons/fa';
import { api } from '../services/api';
import type { VODStream, Series, LiveStream } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import type { Language } from '../i18n';
import { useFocusZone } from '../contexts/FocusContext';
import { progressService, type MovieProgress, type SeriesProgress } from '../services/progressService';
import { storage } from '../services/storage';
import { categoryAffinity, scoreRecommendations, newEpisodes, normalizeSearch } from '../services/catalogExtras';
import { usageStats } from '../services/usageStats';
import { kidsFilter, isAdultCategoryName } from '../services/kidsFilter';
import { contentFlags } from '../services/contentFlags';
import { computeDefaultVisibleChannels, withMinimum } from '../services/liveVisibility';
import { liveHealth, ultimoCanalNoAr, variantesNoAr } from '../services/liveHealth';
import { proximaVariante, variantGroup } from '../services/channelVariants';
import type { StreamErrorCause } from '../hooks/useHls';
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

// Mínimo de canais na fileira da prévia (favoritos + visíveis completando)
const MIN_PREVIEW_CHANNELS = 10;

const LOCALES: Record<Language, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** Promise.allSettled de uma promessa só — o nativo não existe no Chrome 69 (Tizen 5.5). */
function settle<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
    return p.then(
        (value): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason }),
    );
}

/** Valor de um resultado assentado, ou null se a promessa falhou. */
function settled<T>(r: PromiseSettledResult<T>): T | null {
    return r.status === 'fulfilled' ? r.value : null;
}

function getId(item: VODStream | Series) {
    return 'stream_id' in item ? item.stream_id : item.series_id;
}

/** Fisher–Yates in place. */
function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Até `k` itens distintos ao acaso, sem copiar o array inteiro. */
function sample<T>(arr: readonly T[], k: number): T[] {
    if (k >= arr.length) return shuffle([...arr]);
    const picked = new Set<number>();
    while (picked.size < k) picked.add(Math.floor(Math.random() * arr.length));
    return [...picked].map(i => arr[i]);
}

/** Capa do título: filme usa stream_icon (cai no cover), série usa cover. */
function getCover(item: VODStream | Series): string {
    if ('stream_id' in item) return item.stream_icon || item.cover || '';
    return item.cover || '';
}

export function Home({ onNavigate , onRequestExit, onCancelExit}: HomeProps) {
    const { t, currentLang } = useTranslation();
    const locale = LOCALES[currentLang];
    const { focusZone, setFocusZone } = useFocusZone();
    const [recentMovies, setRecentMovies] = useState<VODStream[]>([]);
    const [recentSeries, setRecentSeries] = useState<Series[]>([]);
    const [recommendations, setRecommendations] = useState<(VODStream | Series)[]>([]);
    // "Porque você assistiu X" (item 27): semente EXPLÍCITA e nomeada, ao
    // contrário da fileira de recomendações, que é afinidade anônima
    const [seedRow, setSeedRow] = useState<{ nome: string; itens: (VODStream | Series)[] } | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    // Foco por ID de seção: as seções condicionais (continue/newepisodes)
    // entram ASSINCRONAMENTE e deslocariam um índice posicional
    const [focusedSectionId, setFocusedSectionId] = useState('');
    const [focusedItem, setFocusedItem] = useState(0);

    // Continuar assistindo (fileira some no perfil Kids: o progresso é
    // global do aparelho e pode conter títulos adultos)
    const lerContinue = (): ContinueItem[] =>
        kidsFilter.isKidsActive() ? [] : progressService.getContinueWatching();
    const [continueRaw, setContinueRaw] = useState<ContinueItem[]>(lerContinue);
    // Títulos de categoria adulta ('m-<id>' / 's-<id>'), conhecidos depois que
    // o catálogo carrega. Até lá (null) a fileira fica escondida: o filtro só
    // pelo nome deixava passar filme adulto de nome comum.
    const [adultContinueIds, setAdultContinueIds] = useState<Set<string> | null>(null);
    const continueItems = useMemo(() => !adultContinueIds ? [] : continueRaw.filter(item => {
        const nome = item.kind === 'movie' ? item.progress.name : item.progress.seriesName;
        const chave = item.kind === 'movie' ? `m-${item.progress.id}` : `s-${item.progress.seriesId}`;
        return !isAdultCategoryName(nome || '') && !adultContinueIds.has(chave) && !!item.progress.poster;
    }), [continueRaw, adultContinueIds]);
    // OK num pôster abria a página Filmes inteira, no topo, sem o item
    // selecionado — o usuário perdia o que tinha achado
    const [detailItem, setDetailItem] = useState<VODStream | Series | null>(null);
    // A Home engolia qualquer falha e mostrava "0 canais / 0 filmes / 0
    // séries" sem uma palavra: o usuário concluía que a lista tinha sido
    // cancelada, não que a rede tinha caído
    // null = sem erro; '' = erro sem mensagem (cai no texto traduzido)
    const [loadError, setLoadError] = useState<string | null>(null);
    const [playingMovie, setPlayingMovie] = useState<PlayableMovie | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Top 10 pelos mais assistidos locais (item 33)
    const [topItems, setTopItems] = useState<Array<VODStream | Series>>([]);

    // Novos episódios de séries seguidas + roleta 🎲
    const [newEpisodesList, setNewEpisodesList] = useState<Series[]>([]);
    // Capa que não carregou: o card sai de todas as fileiras (o foco já se
    // reajusta sozinho quando a fileira encolhe — ver maxFocusedItem)
    const descartarCapa = useCallback((url: string) => {
        const fica = (item: VODStream | Series) => getCover(item) !== url;
        setRecentMovies(l => l.filter(fica));
        setRecentSeries(l => l.filter(fica));
        setRecommendations(l => l.filter(fica));
        setTopItems(l => l.filter(fica));
        setNewEpisodesList(l => l.filter(fica));
        setSeedRow(r => r && { ...r, itens: r.itens.filter(fica) });
        setContinueRaw(l => l.filter(item => item.progress.poster !== url));
    }, []);

    // Prévia de canal ao vivo (último assistido, ou sugestão aleatória
    // dentre os visíveis por padrão — ver src/services/liveVisibility.ts),
    // mais uma fileira de OUTROS canais candidatos só com a capa: clicar um
    // deles troca qual canal toca na prévia grande (não navega); clicar de
    // novo na prévia (o mesmo canal, agora já selecionado) é que abre o
    // player. `lastWatchedId` fica separado pra decidir o rótulo da seção
    // ("Continue assistindo" só quando o SELECIONADO é o último de verdade
    // — escolher outro canal na fileira já deixa de ser "continuar").
    const [channelPreviewPool, setChannelPreviewPool] = useState<{ lastWatchedId: number | null; channels: LiveStream[] } | null>(null);
    // Catálogo ao vivo já filtrado (Kids/adulto): de onde saem as variantes do failover da prévia
    const previewStreamsRef = useRef<LiveStream[]>([]);
    const previewFalhasRef = useRef(new Set<number>());
    const [selectedPreviewChannelId, setSelectedPreviewChannelId] = useState<number | null>(null);
    // Vindo da TV ao Vivo com a prévia TOCANDO: o canal estacionado vira o
    // herói JÁ, sem esperar o catálogo (aqui inclui VOD e séries e pode passar
    // do prazo do estacionamento) — a prévia assume o mesmo stream. A TV ao
    // Vivo só estaciona na desmontagem, DEPOIS deste render: daí o
    // useSyncExternalStore (re-renderiza quando ela estaciona). O valor fica
    // guardado no estado (ajuste durante o render) porque o estacionamento
    // some logo depois da entrega. Quando o catálogo chega, o herói é o
    // último assistido = o mesmo canal: a prévia não remonta.
    const canalEstacionado = useSyncExternalStore(pipelineEstacionado.assinar, pipelineEstacionado.canalEstacionado);
    const [heroEstacionado, setHeroEstacionado] = useState<LiveStream | null>(null);
    if (canalEstacionado && !heroEstacionado && !channelPreviewPool) setHeroEstacionado(canalEstacionado);

    const refreshContinue = useCallback(() => {
        setContinueRaw(kidsFilter.isKidsActive() ? [] : progressService.getContinueWatching());
    }, []);

    // Update clock on each minute boundary. Um setInterval(60s) a partir do
    // mount deixava o relógio até 59s atrasado. Fusos são minutos inteiros,
    // então a virada do minuto em UTC é a mesma do horário local.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
            timer = setTimeout(() => {
                setCurrentTime(new Date());
                schedule();
            }, 60000 - (Date.now() % 60000));
        };
        schedule();
        return () => clearTimeout(timer);
    }, []);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            try {
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
                // Cada promessa passa por settle(): um endpoint falhando (ex.: categorias de
                // séries) zerava TODAS as fileiras. Agora cada tipo só entra
                // se itens E categorias vieram — sem as categorias o filtro
                // de adulto/PIN abaixo não tem como agir, e mostrar os itens
                // sem filtro vazaria categoria travada.
                const results = await Promise.all([
                    settle(includeTV ? api.getLiveStreams() : Promise.resolve([])),
                    settle(includeVOD ? api.getVODStreams() : Promise.resolve([])),
                    settle(includeVOD ? api.getSeries() : Promise.resolve([])),
                    settle(includeTV ? api.getLiveCategories() : Promise.resolve([])),
                    settle(includeVOD ? api.getVodCategories() : Promise.resolve([])),
                    settle(includeVOD ? api.getSeriesCategories() : Promise.resolve([])),
                ]);
                const [rStreams, rMovies, rSeries, rLiveCats, rVodCats, rSeriesCats] = results;
                const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
                if (firstFailure) {
                    console.error('Failed to fetch data:', firstFailure.reason);
                    setLoadError(firstFailure.reason instanceof Error ? firstFailure.reason.message : '');
                }
                const liveCats = settled(rLiveCats) ?? [];
                const vodCats = settled(rVodCats) ?? [];
                const seriesCats = settled(rSeriesCats) ?? [];
                let streams = rLiveCats.status === 'fulfilled' ? settled(rStreams) ?? [] : [];
                let movies = rVodCats.status === 'fulfilled' ? settled(rMovies) ?? [] : [];
                let series = rSeriesCats.status === 'fulfilled' ? settled(rSeries) ?? [] : [];

                // A Home NUNCA mostra conteúdo adulto — nem com o bloqueio
                // parental desligado: é a vitrine que abre com o app, na sala.
                // Fica de fora por categoria adulta OU por nome adulto (canal
                // "[XX] ADULTO 23" pode estar fora da categoria "Adultos").
                // O perfil Kids continua com o filtro dele, mais amplo.
                const adultas = (cats: Array<{ category_id: string; category_name: string }>) =>
                    new Set(cats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                const adultLive = adultas(liveCats);
                const adultVod = adultas(vodCats);
                const adultSeries = adultas(seriesCats);
                const ehAdulto = (item: { category_id: string; name?: string }, cats: Set<string>) =>
                    cats.has(item.category_id) || isAdultCategoryName(item.name || '');
                // Catálogo de VOD falhou: sem como saber quem é adulto, a
                // fileira continua escondida
                if (rMovies.status === 'fulfilled' && rVodCats.status === 'fulfilled'
                    && rSeries.status === 'fulfilled' && rSeriesCats.status === 'fulfilled') setAdultContinueIds(new Set([
                    ...movies.filter(m => ehAdulto(m, adultVod)).map(m => `m-${m.stream_id}`),
                    ...series.filter(s => ehAdulto(s, adultSeries)).map(s => `s-${s.series_id}`),
                ]));
                if (kidsFilter.isKidsActive()) {
                    streams = kidsFilter.apply(streams, liveCats, 'live').items;
                    movies = kidsFilter.apply(movies, vodCats, 'vod').items;
                    series = kidsFilter.apply(series, seriesCats, 'vod').items;
                }
                streams = streams.filter(s => !ehAdulto(s, adultLive));
                movies = movies.filter(m => !ehAdulto(m, adultVod));
                series = series.filter(s => !ehAdulto(s, adultSeries));
                // Vitrine sem pôster vazio: filme/série sem capa não entra em
                // fileira nenhuma (a capa que existe mas não carrega sai no
                // onImageError do card — descartarCapa)
                movies = movies.filter(m => !!getCover(m));
                series = series.filter(s => !!getCover(s));

                // Prévia de canal ao vivo: o último assistido (se ainda
                // existir no catálogo já filtrado por Kids/adulto) puxa a
                // prévia grande; senão sorteia 1 dos favoritos, ou dos visíveis por
                // padrão (mesma pipeline de curadoria/dedup de TV ao Vivo —
                // ver liveVisibility.ts). A fileira de capas ao lado traz os
                // canais favoritos (até 24), completada com os visíveis até
                // MIN_PREVIEW_CHANNELS, pra trocar a prévia sem
                // sair da Home. `streams` aqui já vem vazio quando "Incluir
                // canais de TV" está desligado, então a seção some sozinha.
                previewStreamsRef.current = streams;
                if (streams.length > 0) {
                    const visible = computeDefaultVisibleChannels(streams, liveCats);
                    // A variante que está no ar, não a que caiu da última vez
                    const lastChannel = ultimoCanalNoAr(streams);
                    // Favoritos primeiro; `streams` já passou pelo filtro Kids/adulto
                    const byId = new Map(streams.map(s => [s.stream_id, s]));
                    const favChannels = storage.getFavorites()
                        .filter(f => f.type === 'channel')
                        .map(f => byId.get(Number(f.id)))
                        .filter((c): c is LiveStream => !!c);
                    const sortear = (l: LiveStream[]) => (l.length > 0 ? l[Math.floor(Math.random() * l.length)] : null);
                    const hero = lastChannel ?? sortear(favChannels) ?? sortear(visible);
                    if (hero) {
                        const semHero = (l: LiveStream[]) => l.filter(c => c.stream_id !== hero.stream_id);
                        const others = withMinimum(semHero(favChannels), semHero(visible), MIN_PREVIEW_CHANNELS).slice(0, 24);
                        // Fileira também na variante que está no ar (CNN Internacional com
                        // a HD fora abria a HD aqui, mesmo com a outra tocando bem)
                        const channels = variantesNoAr([hero, ...others], streams);
                        setChannelPreviewPool({ lastWatchedId: lastChannel ? lastChannel.stream_id : null, channels });
                        setSelectedPreviewChannelId(channels[0].stream_id);
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
                    // Completa com sorteio em vez de jogar fora os 1–4 por
                    // afinidade; sorteia só 15 índices em vez de copiar e
                    // embaralhar o catálogo inteiro (sort com Math.random é
                    // lento no main thread da TV e nem embaralha por igual)
                    const jaTem = new Set<VODStream | Series>(recommended);
                    const sorteados = shuffle([...sample(movies, 8), ...sample(series, 7)])
                        .filter(item => !jaTem.has(item));
                    recommended = [...recommended, ...sorteados].slice(0, 15);
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
                setLoadError(error instanceof Error ? error.message : '');
            }
        }

        fetchData();
    }, []);

    // Time formatting
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    // Greeting based on time of day (as per original app)
    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return t('home_good_morning');
        if (hour < 18) return t('home_good_afternoon');
        return t('home_good_evening');
    };

    // Canal selecionado na prévia (hero) + os demais candidatos, com o
    // selecionado sempre removido da fileira de capas (ele já está grande,
    // não faz sentido repetir pequeno do lado). Recalcular a cada render é
    // barato (≤25 itens) e evita guardar essa relação duas vezes.
    const previewChannels = channelPreviewPool?.channels ?? (heroEstacionado ? [heroEstacionado] : []);
    const selectedPreviewChannel = previewChannels.find(c => c.stream_id === (selectedPreviewChannelId ?? heroEstacionado?.stream_id)) ?? null;

    // Saindo da Home com a prévia ao vivo TOCANDO: estaciona o stream em vez de
    // fechar — a TV ao Vivo (ou o player do "Assistir") assume a mesma sessão.
    // Fechar e reabrir esbarrava no limite de conexões (o painel segue contando
    // a fechada por ~20s). Layout: roda na desmontagem ANTES de o ref da
    // prévia (filha) ser solto. Trocar de canal na fileira NÃO passa aqui.
    const homePreviewRef = useRef<LiveChannelPreviewHandle>(null);
    const homePreviewIdRef = useRef<number | null>(null);
    useEffect(() => { homePreviewIdRef.current = selectedPreviewChannel?.stream_id ?? null; }, [selectedPreviewChannel]);
    useLayoutEffect(() => () => {
        const id = homePreviewIdRef.current;
        const pipeline = homePreviewRef.current?.handOff();
        if (id != null && pipeline) pipelineEstacionado.estacionar(id, pipeline);
    }, []);
    const otherPreviewChannels = selectedPreviewChannel
        ? previewChannels.filter(c => c.stream_id !== selectedPreviewChannel.stream_id)
        : previewChannels;
    const isLastWatchedSelected = !!selectedPreviewChannel
        && selectedPreviewChannel.stream_id === (channelPreviewPool ? channelPreviewPool.lastWatchedId : heroEstacionado?.stream_id);

    // TV Navigation - seções dinâmicas ("continue"/"newepisodes" condicionais)
    // A ORDEM aqui tem que ser a MESMA do DOM, senão ↓ move o foco pra cima na
    // tela. E seção sem item nenhum não pode entrar: o foco sumia por três
    // apertos de ↓ numa playlist só de canais.
    const sections = [
        ...(selectedPreviewChannel ? [{ id: 'channelpreview', items: 1 + otherPreviewChannels.length }] : []),
        ...(continueItems.length > 0 ? [{ id: 'continue', items: continueItems.length }] : []),
        ...(seedRow ? [{ id: 'seed', items: seedRow.itens.length }] : []),
        ...(topItems.length > 0 ? [{ id: 'top10', items: topItems.length }] : []),
        ...(newEpisodesList.length > 0 ? [{ id: 'newepisodes', items: newEpisodesList.length }] : []),
        ...(recommendations.length > 0 ? [{ id: 'recommendations', items: recommendations.length }] : []),
        ...(recentSeries.length > 0 ? [{ id: 'series', items: recentSeries.length }] : []),
        ...(recentMovies.length > 0 ? [{ id: 'movies', items: recentMovies.length }] : [])
    ];

    const sectionIndex = (id: string) => sections.findIndex(s => s.id === id);
    const focusedSection = Math.max(0, sectionIndex(focusedSectionId));
    // A fileira focada pode ENCOLHER (Continuar Assistindo depois de fechar o
    // player): sem o clamp, o foco apontava pra um card que não existe mais
    const maxFocusedItem = Math.max(0, (sections[focusedSection]?.items ?? 1) - 1);
    if (focusedItem > maxFocusedItem) setFocusedItem(maxFocusedItem);

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
    // React.memo do HomeCard funcionar. Clique (Magic Remote/mouse/toque)
    // faz o MESMO que o OK do D-pad: abre a ficha. Antes o clique levava pra
    // página Filmes/Séries inteira e o usuário perdia o título que achou.
    const handleSelectContinue = useCallback((item: ContinueItem) => { void playContinueItem(item); }, [playContinueItem]);
    const handleSelectNewEpisode = useCallback((s: Series) => {
        // Marca como visto (o selo some) e abre a ficha da série
        newEpisodes.markSeen(String(s.series_id), s.last_modified || '0');
        openDetail(s);
    }, [openDetail]);

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

    // A prévia não subiu: tenta outra variante do MESMO canal (qualquer uma
    // que sobrar — HD fora com 4K no ar vai pra 4K), como a TV ao Vivo faz,
    // em vez de cair direto no logo. Limite de conexões: não (seria mais uma
    // conexão numa conta estourada). Devolve se trocou.
    const handlePreviewFailed = useCallback((causa?: StreamErrorCause | 'stall'): boolean => {
        const atual = selectedPreviewChannel;
        if (!atual || !channelPreviewPool || causa === 'connlimit') return false;
        const falharam = previewFalhasRef.current.add(atual.stream_id);
        const next = proximaVariante(variantGroup(previewStreamsRef.current, atual.name), atual.stream_id, falharam, liveHealth);
        if (!next) return false;
        // Era o último assistido: a variante que funciona passa a ser ele
        if (storage.getLastChannel() === atual.stream_id) storage.setLastChannel(next.stream_id);
        setChannelPreviewPool(p => p && {
            lastWatchedId: p.lastWatchedId === atual.stream_id ? next.stream_id : p.lastWatchedId,
            channels: p.channels.map(c => (c.stream_id === atual.stream_id ? next : c)),
        });
        setSelectedPreviewChannelId(next.stream_id);
        return true;
    }, [selectedPreviewChannel, channelPreviewPool]);

    // Clicar uma capa da fileira de "outros canais" só TROCA a prévia
    // grande (nova seleção) — não navega. O foco vai pra prévia: o canal
    // escolhido sai da fileira, e manter o índice deixava o destaque no
    // vizinho. Assim o segundo OK (agora na prévia) abre o player.
    const handleSelectOtherChannel = useCallback((channel: LiveStream) => {
        setSelectedPreviewChannelId(channel.stream_id);
        setFocusedSectionId('channelpreview');
        setFocusedItem(0);
    }, []);

    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        onCancelExit(); // mexeu no controle: não estava saindo
        if (direction === 'up') {
            setFocusedSectionId(sections[Math.max(0, focusedSection - 1)]?.id ?? '');
            setFocusedItem(0);
        } else if (direction === 'down') {
            setFocusedSectionId(sections[Math.min(sections.length - 1, focusedSection + 1)]?.id ?? '');
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
        if (section?.id === 'channelpreview') {
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
            if (s) handleSelectNewEpisode(s);
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
            if (loadError !== null) window.location.reload();
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
        // A fileira de capas de canais também rola (overflow-x, barra
        // escondida); nela o item 0 da seção é a prévia grande, fora da fileira
        const fileira = secao?.querySelector('.content-row, .home-channel-cover-row');
        const indice = focusedSectionId === 'channelpreview' ? focusedItem - 1 : focusedItem;
        const card = indice >= 0 ? fileira?.children[indice] as HTMLElement | undefined : undefined;
        card?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, [focusedSectionId, focusedItem]);


    const getName = (item: VODStream | Series) => {
        return item.name;
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
                            ? t('home_expired')
                            : expiryWarning === 0
                                ? t('home_expires_today')
                                : t('home_expires_in').replace('{n}', String(expiryWarning))}
                    </span>
                    <span className="home-expiry-hint"><FaClock className="home-expiry-icon" /> {t('home_remind_later')}</span>
                </div>
            )}

            {/* Header */}
            <header className="home-header">
                <div className="home-header-left">
                    <div className="home-date">{formatDate(currentTime)}</div>
                    <h1 className="home-greeting">
                        {getGreeting()}! <span className="waving-hand">👋</span>
                    </h1>
                    <p className="home-subtitle">{t('home_subtitle')}</p>
                </div>
                <div className="home-clock">{formatTime(currentTime)}</div>
            </header>

            {loadError !== null && (
                <div className="home-load-error">
                    <span className="home-load-error-text"><FaExclamationTriangle className="home-expiry-icon" /> {loadError || t('home_load_error')}</span>
                    <span className="home-load-error-hint">
                        {expiryWarning !== null
                            ? <><FaClock className="home-expiry-icon" /> {t('home_snooze_above')}</>
                            : <><FaSync className="home-expiry-icon" /> {t('home_retry')}</>}
                    </span>
                </div>
            )}

            {/* Content Rows - Matching Original App */}
            <section className="home-content">
                {/* Prévia de canal ao vivo + fileira de outros canais (só capa) */}
                {selectedPreviewChannel && (
                    <div id="home-channelpreview" className="content-section home-channel-preview-section">
                        <h2 className="section-title">
                            {isLastWatchedSelected ? t('home_live_continue') : t('home_live_preview')}
                        </h2>
                        <div className="home-channel-preview-row">
                            <HomeChannelPreview
                                key={selectedPreviewChannel.stream_id}
                                channel={selectedPreviewChannel}
                                previewRef={homePreviewRef}
                                focused={focusedSection === sectionIndex('channelpreview') && focusedItem === 0}
                                onWatch={handleWatchChannelPreview}
                                onFailed={handlePreviewFailed}
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
                        <h2 className="section-title"><FaPlay className="section-title-icon" /> {t('home_continue_watching')}</h2>
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
                                onImageError={descartarCapa}
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
                        <h2 className="section-title"><FaPlay className="section-title-icon" /> {t('home_because_watched').replace('{name}', seedRow.nome)}</h2>
                        <div className="content-row">
                            {seedRow.itens.map((item, index) => (
                                <HomeCard
                                onImageError={descartarCapa}
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
                        <h2 className="section-title"><FaListOl className="section-title-icon" /> {t('home_top10')}</h2>
                        <div className="content-row">
                            {topItems.map((item, index) => (
                                <HomeCard
                                onImageError={descartarCapa}
                                    key={getKey(item)}
                                    item={item}
                                    index={index}
                                    focused={focusedSection === sectionIndex('top10') && focusedItem === index}
                                    title={getName(item)}
                                    image={getCover(item)}
                                    onSelect={openDetail}
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
                        <h2 className="section-title"><FaCalendarPlus className="section-title-icon" /> {t('home_new_episodes')}</h2>
                        <div className="content-row">
                            {newEpisodesList.map((s, index) => (
                                <HomeCard
                                onImageError={descartarCapa}
                                    key={s.series_id}
                                    item={s}
                                    index={index}
                                    focused={focusedSection === sectionIndex('newepisodes') && focusedItem === index}
                                    title={s.name}
                                    image={s.cover}
                                    fallbackIcon={FaTv}
                                    onSelect={handleSelectNewEpisode}
                                    imageOverlay={<div className="new-episodes-badge">{t('home_new_episodes_badge')}</div>}
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
                    <h2 className="section-title"><FaLightbulb className="section-title-icon" /> {t('home_recommended')}</h2>
                    <div className="content-row">
                        {recommendations.map((item, index) => (
                            <HomeCard
                                onImageError={descartarCapa}
                                key={getKey(item)}
                                item={item}
                                index={index}
                                focused={focusedSection === sectionIndex('recommendations') && focusedItem === index}
                                title={getName(item)}
                                image={getCover(item)}
                                fallbackIcon={FaFilm}
                                onSelect={openDetail}
                            />
                        ))}
                    </div>
                </div>
                )}

                {/* Recent Series — condicional IGUAL ao array `sections` */}
                {recentSeries.length > 0 && (
                <div id="home-series" className="content-section">
                    <h2 className="section-title"><FaCalendarPlus className="section-title-icon" /> {t('home_recent_series')}</h2>
                    <div className="content-row">
                        {recentSeries.map((series, index) => (
                            <HomeCard
                                onImageError={descartarCapa}
                                key={series.series_id}
                                item={series}
                                index={index}
                                focused={focusedSection === sectionIndex('series') && focusedItem === index}
                                title={series.name}
                                image={series.cover}
                                fallbackIcon={FaTv}
                                onSelect={openDetail}
                            />
                        ))}
                    </div>
                </div>

                )}

                {/* Recent Movies — condicional IGUAL ao array `sections` */}
                {recentMovies.length > 0 && (
                <div id="home-movies" className="content-section">
                    <h2 className="section-title"><FaFilm className="section-title-icon" /> {t('home_recent_movies')}</h2>
                    <div className="content-row">
                        {recentMovies.map((movie, index) => (
                            <HomeCard
                                onImageError={descartarCapa}
                                key={movie.stream_id}
                                item={movie}
                                index={index}
                                focused={focusedSection === sectionIndex('movies') && focusedItem === index}
                                title={movie.name}
                                image={movie.stream_icon || movie.cover}
                                fallbackIcon={FaFilm}
                                onSelect={openDetail}
                            />
                        ))}
                    </div>
                </div>
                )}
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
