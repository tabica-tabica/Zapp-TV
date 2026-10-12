// LiveTV Page - Matching NeoStream Desktop Style
// Paridade com o desktop: EPG (get_short_epg), zapping (CH±/dígitos/overlay),
// variantes de qualidade agrupadas, ⭐ favoritos, 🙈 ocultar, 📅 só-EPG,
// 🎲 aleatório e retomada do último canal.
// Color keys: 🔴 só-EPG · 🟢 aleatório · 🟡 favorito · 🔵 ocultar

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import {
    FaExclamationTriangle, FaStar, FaRegStar, FaEye, FaEyeSlash, FaBell, FaBellSlash,
    FaBroadcastTower, FaCalendarAlt, FaThLarge, FaRandom, FaFutbol, FaPlay, FaHistory,
    FaClipboardList, FaTimes, FaVolumeUp, FaVolumeMute,
    FaLock, FaLockOpen,
} from 'react-icons/fa';
import { RemoteColorHint } from '../components/RemoteColorHint';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { epgService, epgOffset, type ChannelEpg, type EpgProgram } from '../services/epgService';
import { zapHistory, hiddenChannels, hiddenCategories, liveToggles } from '../services/liveExtras';
import { kidsFilter, isAdultCategoryName } from '../services/kidsFilter';
import { contentFlags } from '../services/contentFlags';
import { useWatchSession } from '../hooks/useWatchSession';
import { FAILOVER_RECONNECT_ATTEMPTS } from '../hooks/useVariantFailover';
import { groupChannelVariants, qualityLabel, channelDisplayName, proximaVariante, melhorVariante } from '../services/channelVariants';
import { resolverUrlFinal } from '../services/urlFinal';
import { liveHealth, ultimoCanalNoAr } from '../services/liveHealth';
import { pipelineEstacionado } from '../services/pipelineEstacionado';
import { CONNLIMIT_WINDOW_MS, type StreamErrorCause } from '../services/playerDecisions';
import {
    curatedHiddenPrefs, detectJunkCategories, detectQualityOnlyCategories,
    isQualityTaggedChannel, computeEffectiveVisibility, type DetectedGroup,
} from '../services/curatedHiddenGroups';
import { detectRegionalFamilies, detectCategoryFamilies } from '../services/regionalVariants';
import { regionalPrefs } from '../services/regionalPrefs';
import type { LiveStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useMeasuredColumns } from '../hooks/useMeasuredColumns';
import { useBrokenImages } from '../hooks/useBrokenImages';
import { parentalService } from '../services/parentalService';
import { PinPrompt } from '../components/PinPrompt';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { ChannelAgendaOverlay } from '../components/ChannelAgendaOverlay';
import { EpgGrid } from '../components/EpgGrid';
import { FavoritesNowPanel, SportsPanel } from '../components/LivePanels';
import { reminderService } from '../services/reminderService';
import { favoriteOrder, isRadioChannel, isSportsCategory, type SportsEvent } from '../services/liveDiscovery';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { VideoPlayer, type PlayerChannel } from '../components/VideoPlayer';
import { readRaw, writeRaw } from '../services/safeStorage';
import { LiveChannelPreview, type LiveChannelPreviewHandle, type LivePipeline } from '../components/LiveChannelPreview';
import { ChannelGrid, CARD_WIDTH, CARD_GAP, type ChannelGridHandle } from './ChannelGrid';
import './LiveTV.css';
import { readCatalog, writeCatalog, dropCatalog, trimLive, trimCategory, type CachedLiveStream } from '../services/catalogCache';
import { ErrorScreen } from '../components/ErrorScreen';

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Referência estável (fora do componente, nunca recriada por render) — o
// filtro "só com tag de qualidade" roda DEPOIS do agrupamento agora, então
// esse estágio anterior (processedStreams) nunca precisa dessa lista.
const EMPTY_QUALITY_ONLY_MAP = new Map<string, DetectedGroup>();
/** Intervalo mínimo entre trocas AUTOMÁTICAS de fonte (a conexão velha segue contando no painel) */
const INTERVALO_TROCA_AUTO_MS = CONNLIMIT_WINDOW_MS;

const PREVIEW_MUTED_KEY = 'neostream_preview_muted';

/** Canal adulto: de categoria adulta OU de nome adulto ("[XX] ADULTO 23" fora da categoria) */
function canalAdulto(canal: LiveStream, categoriasAdultas: Set<string>): boolean {
    return categoriasAdultas.has(canal.category_id) || isAdultCategoryName(canal.name || '');
}

export function LiveTV() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Catálogo CRU (só o filtro Kids); `streams` mais abaixo é a visão do modo adulto
    const [todosOsCanais, setStreams] = useState<LiveStream[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedChannel, setSelectedChannel] = useState<LiveStream | null>(null);
    const [playingChannel, setPlayingChannel] = useState<LiveStream | null>(null);
    const { isBroken, markBroken } = useBrokenImages<number>();
    const { containerRef: scrollContainerRef, columns, columnWidth } = useMeasuredColumns({
        cardWidth: CARD_WIDTH, gap: CARD_GAP, minColumns: 3, maxColumns: 10,
    });
    // Canais adultos SÓ no modo adulto (botão "Adulto" da barra, com PIN):
    // fora dele somem de tudo — grade, Todos, favoritos, busca, jogos, zap
    // aleatório, troca de canal e o menu de categorias. Dentro dele, só eles.
    // Apertar o botão de novo sai e TRANCA: voltar pede o PIN outra vez.
    // Perfil Kids nunca vê o botão (o kidsFilter já tirou os canais adultos).
    const [modoAdulto, setModoAdulto] = useState(false);
    const [adultoPinAberto, setAdultoPinAberto] = useState(false);
    const [adultoPinProvisionado, setAdultoPinProvisionado] = useState(false);
    const categoriasAdultas = useMemo(
        () => new Set(categories.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id)),
        [categories],
    );
    const streams = useMemo(
        () => todosOsCanais.filter(s => canalAdulto(s, categoriasAdultas) === modoAdulto),
        [todosOsCanais, categoriasAdultas, modoAdulto],
    );
    const temAdulto = useMemo(
        () => !kidsFilter.isKidsActive() && todosOsCanais.some(s => canalAdulto(s, categoriasAdultas)),
        [todosOsCanais, categoriasAdultas],
    );
    const categoriasDoMenu = useMemo(
        () => categories.filter(c => categoriasAdultas.has(c.category_id) === modoAdulto),
        [categories, categoriasAdultas, modoAdulto],
    );

    // Filtros/toggles persistidos
    const [onlyWithEpg, setOnlyWithEpg] = useState(() => liveToggles.getOnlyWithEpg());
    // Só leitura aqui: o toggle mora em Configurações agora (não tem mais
    // botão na TV ao Vivo pra ele) — se o usuário mudar lá, esta página pega
    // o novo valor na próxima montagem.
    const [groupVariantsOn] = useState(() => liveToggles.getGroupVariants());
    // Categorias "ruído" ocultas por padrão — gerenciamento mora em
    // Configurações; aqui só lê o que já foi desocultado.
    const [curatedUnhiddenGroups] = useState(() => curatedHiddenPrefs.getUnhiddenGroups());
    const [curatedChannelOverrides] = useState(() => curatedHiddenPrefs.getChannelOverrides());
    const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => hiddenChannels.get());
    const [showOnlyHidden, setShowOnlyHidden] = useState(false);
    const [favTick, setFavTick] = useState(0);

    // EPG
    const [previewEpg, setPreviewEpg] = useState<ChannelEpg | null>(null);
    // De QUAL canal é o previewEpg: na troca A→B o dado velho de A não pode
    // alimentar a ficha nem o ⏮ Reiniciar de B (timeshift do trecho errado)
    const [previewEpgFor, setPreviewEpgFor] = useState<number | null>(null);
    const [playerEpg, setPlayerEpg] = useState<ChannelEpg | null>(null);

    // Preview de vídeo mudo da ficha (item da sessão): debounce de 400ms —
    // igual ao lookup de EPG do zap-list em VideoPlayer.tsx — pra não ligar
    // HLS a cada canal que o usuário só passou o olho antes de trocar de novo.
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    // Prévia com som; o mudo é lembrado entre aberturas
    const [previewMuted, setPreviewMuted] = useState(() => readRaw(PREVIEW_MUTED_KEY) === '1');
    const togglePreviewMuted = useCallback(() => {
        const next = !previewMuted;
        setPreviewMuted(next);
        writeRaw(PREVIEW_MUTED_KEY, next ? '1' : '0');
    }, [previewMuted]);
    // Sessão já aberta pela prévia (URL com ?token=). Abrir o MESMO canal com
    // ela reaproveita a conexão: com a URL original o provedor abre outra, e
    // conta de 1 conexão recusa ("Maximum number of connections reached")
    // porque a da prévia ainda conta por uns 20s depois de fechada.
    const [previewSession, setPreviewSession] = useState<{ id: number; url: string } | null>(null);
    // Failover da PRÉVIA: a fonte do canal selecionado falhou → a prévia anda
    // pelas variantes (mesma rotação/benchmark/salvaguarda do player). `de` é
    // o canal selecionado a que isto se refere; trocar a seleção descarta.
    const [previaVariante, setPreviaVariante] = useState<{ de: number; canal: LiveStream; falharam: ReadonlySet<number> } | null>(null);
    // Handoff do pipeline: a prévia entrega o <video> + hls.js TOCANDO pro
    // player (ver VideoPlayer `adopt`). previewStreamIdRef diz de que canal é a
    // prévia montada agora; handoffRef carrega o pipeline até o player montar.
    const previewRef = useRef<LiveChannelPreviewHandle>(null);
    const previewStreamIdRef = useRef<number | null>(null);
    const previewSrcRef = useRef<string | null>(null);
    // Prévia cujo <video> o player está usando NO LUGAR (LivePipeline.noLugar):
    // fica montada, escondida e CONGELADA (canal/src do Assistir) enquanto o
    // player toca — se ela desmontasse ou trocasse de src, levava o <video>
    // do player junto. `geracaoPrevia` remonta do zero quando o player
    // fechou sem devolver (ele zera o <video>).
    const [previaNoPlayer, setPreviaNoPlayer] = useState<{ canal: LiveStream; src: string } | null>(null);
    const [geracaoPrevia, setGeracaoPrevia] = useState(0);
    const handoffRef = useRef<LivePipeline | null>(null);
    // E a volta: Voltar no player devolve o pipeline TOCANDO, e a prévia do
    // mesmo canal assume (canal segue no ar, sem reconectar). Lido só na
    // montagem da prévia; zerado depois do commit pra não reaproveitar um
    // pipeline velho numa montagem futura.
    const devolucaoRef = useRef<{ id: number; pipeline: LivePipeline } | null>(null);
    useEffect(() => { devolucaoRef.current = null; }, [playingChannel]);

    // Toast OSD da página (favorito/oculto/failover — R1 item 53)
    const [toast, setToast] = useState<ReactNode | null>(null);
    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Catch-up (itens 2/4/10): fila de programas do arquivo via timeshift
    const [archivePlayback, setArchivePlayback] = useState<{
        channel: LiveStream;
        programs: EpgProgram[];
        index: number;
    } | null>(null);
    const [showAgenda, setShowAgenda] = useState(false);
    // Guia multi-canal (item 1): canais nas linhas, tempo nas colunas
    const [showGuide, setShowGuide] = useState(false);
    // Canal em que o guia abre: lido do foco da grade na hora de abrir
    const [guiaCanalId, setGuiaCanalId] = useState<number | undefined>();

    // Categorias inteiras ocultas (item 16)
    const [hiddenCatIds, setHiddenCatIds] = useState<Set<string>>(() => hiddenCategories.get());

    // R4: painéis, lembretes e ordem manual dos favoritos
    const [showFavoritesPanel, setShowFavoritesPanel] = useState(false);
    const [showSportsPanel, setShowSportsPanel] = useState(false);
    const [favOrderTick, setFavOrderTick] = useState(0);

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    // 'preview' = botões da ficha do canal (Assistir/⭐/🙈/variantes)
    // 'categories' = header: 0 busca, 1 menu, 2+ botões da toolbar
    const [focusArea, setFocusArea] = useState<'categories' | 'channels' | 'preview'>('channels');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [previewFocusIndex, setPreviewFocusIndex] = useState(0);
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const searchRef = useRef<AnimatedSearchBarHandle>(null);
    const categoryMenuRef = useRef<CategoryMenuHandle>(null);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            // "Incluir canais de TV" desmarcado no login: nem busca. Sem isto a
            // flag só escondia o botão da sidebar — quem chegasse aqui por
            // outro caminho (ex.: "ligar e assistir") via a busca rodar normal.
            if (!contentFlags.includeTV()) {
                setLoading(false);
                return;
            }

            // A flag de "ligar e assistir" é consumida AQUI, antes de qualquer
            // await. Consumi-la só depois do fetch fazia duas coisas erradas:
            // se o fetch falhava ela sobrevivia e disparava autoplay numa
            // visita futura; e com o cache na tela o usuário já estava
            // navegando quando o player abria por cima dele.
            const wantsAutoplay = sessionStorage.getItem('neostream_autoplay_last') === '1';
            sessionStorage.removeItem('neostream_autoplay_last');

            /** Pré-seleciona (e só no boot, dá play) o último canal assistido. */
            const restoreLastChannel = (items: LiveStream[], cats: Category[]) => {
                // Vindo da Home com a prévia dela TOCANDO: esse canal manda (o
                // stream estacionado é assumido, sem conexão nova)
                const estacionado = pipelineEstacionado.canal();
                // Senão o último assistido, na variante que está no ar (a mesma da Home)
                const found = estacionado != null ? items.find(item => item.stream_id === estacionado) : ultimoCanalNoAr(items);
                if (!found) return;
                // Último canal adulto não volta sozinho (a prévia toca na hora)
                const adultas = new Set(cats.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id));
                if (canalAdulto(found, adultas)) return;
                // Prévia presa NESTA variante (a estacionada, ou a última
                // assistida — que tocou bem): o "melhor" do benchmark podia ser
                // outra, e aí o stream estacionado ficaria sem dono e a volta
                // pra Home (que mostra o último assistido) não casaria
                setPreviaVariante({ de: found.stream_id, canal: found, falharam: new Set() });
                setSelectedChannel(found);
                if (wantsAutoplay) {
                    // "Assistir" da Home: o player assume o stream estacionado
                    handoffRef.current = pipelineEstacionado.retirar(found.stream_id);
                    setPlayingChannel(found);
                    storage.setLastChannel(found.stream_id);
                    zapHistory.push(found.stream_id);
                }
            };

            // Stale-while-revalidate (item 70): o catálogo de ontem entra na
            // tela imediatamente enquanto o de hoje ainda está vindo. Numa TV
            // isso é a diferença entre 4 s de "carregando" e nada.
            const cachedStreams = readCatalog<CachedLiveStream>('live');
            const cachedCategories = readCatalog<Category>('live-cats');
            let servedFromCache = false;
            if (cachedStreams && cachedCategories) {
                // O que veio do cache é PODADO: completa os campos que a
                // grade não usa mas o tipo exige, pra ninguém ler lixo
                const restored = cachedStreams.map(item => ({
                    ...item,
                    stream_type: 'live',
                    added: '',
                    custom_sid: '',
                    direct_source: '',
                    tv_archive_duration: 0,
                } satisfies LiveStream));
                const gatedCache = kidsFilter.apply(restored, cachedCategories);
                setStreams(gatedCache.items);
                setCategories(gatedCache.categories);
                setLoading(false);
                servedFromCache = true;
                // Restaura JUNTO com o cache: assim o player (se for o caso)
                // abre antes de o usuário começar a navegar, e não no meio
                restoreLastChannel(gatedCache.items, gatedCache.categories);
            }

            try {
                if (!servedFromCache) setLoading(true);
                const [streamsData, categoriesData] = await Promise.all([
                    api.getLiveStreams(),
                    api.getLiveCategories()
                ]);
                // Os dois andam juntos: categorias guardadas sem os canais
                // correspondentes dariam um menu cheio de categorias vazias
                if (writeCatalog('live', streamsData, trimLive)) {
                    writeCatalog('live-cats', categoriesData, trimCategory);
                } else {
                    dropCatalog('live-cats');
                }
                // Gate do perfil Kids (remove categorias adultas e seus canais)
                const gated = kidsFilter.apply(streamsData, categoriesData);
                setStreams(gated.items);
                setCategories(gated.categories);
                // Só restaura aqui se o cache não deu conta: repetir abriria o
                // player por cima de quem já está navegando
                if (!servedFromCache) restoreLastChannel(gated.items, gated.categories);
            } catch (err: unknown) {
                // Com o cache na tela, uma falha de rede não pode apagar o que
                // o usuário já está vendo — ele continua navegando o de ontem
                if (!servedFromCache) {
                    setError(err instanceof Error ? err.message : 'Erro ao carregar canais');
                }
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Canais favoritos (categoria virtual FAVORITES)
    const favoriteChannelIds = useMemo(() => {
        return new Set(
            storage.getFavorites()
                .filter(f => f.type === 'channel')
                .map(f => Number(f.id))
        );
        // favTick força recomputo após toggle
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [favTick]);

    // Categorias "ruído" detectadas dinamicamente na playlist ativa
    // (curiosidades/treino/câmeras/rádios/shows/24h etc.) — recalculado
    // sempre que a lista de categorias mudar, não uma lista fixa.
    const junkGroupsByCategory = useMemo(() => {
        return new Map(detectJunkCategories(categories).map(g => [g.categoryId, g]));
    }, [categories]);

    // Categorias "só com tag de qualidade" (Esportes/Variedades): ocultação
    // POR CANAL, não por bloco — ver comentário em detectQualityOnlyCategories.
    // Aplicado DEPOIS do agrupamento de qualidade (mais abaixo), não aqui —
    // se aplicasse antes, "GNT" (sem tag) seria descartado ANTES de poder
    // virar variante de fallback dentro do grupo de "GNT FHD" (a mesma
    // marca, a mesma categoria, só que sem tag no nome).
    const qualityOnlyGroupsByCategory = useMemo(() => {
        return new Map(detectQualityOnlyCategories(categories).map(g => [g.categoryId, g]));
    }, [categories]);

    // Cadeia de filtros (memoizada — lista pode ter milhares de canais)
    const processedStreams = useMemo(() => {
        let list = streams;

        if (showOnlyHidden) {
            list = list.filter(s => hiddenIds.has(s.stream_id));
        } else if (hiddenIds.size > 0) {
            list = list.filter(s => !hiddenIds.has(s.stream_id));
        }

        // Categorias ocultas somem da visão geral; selecionar a própria
        // categoria no menu ainda mostra (caminho pra rever/desocultar)
        if (hiddenCatIds.size > 0 && selectedCategory !== 'FAVORITES' && !hiddenCatIds.has(selectedCategory)) {
            list = list.filter(s => !hiddenCatIds.has(s.category_id));
        }

        // Categorias curadas (curiosidades/treino/câmeras/rádios/shows/24h
        // etc.) ocultas por padrão — gerenciado em Configurações, não aqui.
        // "Só com tag de qualidade" (qualityOnlyGroupsByCategory) NÃO entra
        // aqui de propósito — esse corte roda DEPOIS do agrupamento de
        // qualidade, mais abaixo, senão perderia a chance de virar fallback.
        list = list.filter(s => curatedHiddenPrefs.isVisible(s.name, s.category_id, s.stream_id, junkGroupsByCategory, curatedUnhiddenGroups, EMPTY_QUALITY_ONLY_MAP, curatedChannelOverrides));

        if (onlyWithEpg) {
            list = list.filter(s => !!s.epg_channel_id);
        }

        if (selectedCategory === 'FAVORITES') {
            list = list.filter(s => favoriteChannelIds.has(s.stream_id));
        } else if (selectedCategory !== 'all') {
            list = list.filter(s => s.category_id === selectedCategory);
        }

        const query = searchQuery.toLowerCase();
        if (query) {
            list = list.filter(s => (s.name || '').toLowerCase().includes(query));
        }

        return list;
    }, [streams, hiddenIds, hiddenCatIds, junkGroupsByCategory, curatedUnhiddenGroups, curatedChannelOverrides, showOnlyHidden, onlyWithEpg, selectedCategory, favoriteChannelIds, searchQuery]);

    // Agrupamento de variantes FHD/HD/SD (port do desktop)
    const { groups: rawGrouped, variantsOf } = useMemo(() => {
        if (!groupVariantsOn) {
            return { groups: processedStreams, variantsOf: new Map<string, LiveStream[]>() };
        }
        return groupChannelVariants(processedStreams);
    }, [processedStreams, groupVariantsOn]);

    // "Só com tag de qualidade" (Esportes/Variedades) — AGORA sim, depois do
    // agrupamento: olha o REPRESENTANTE do grupo (a melhor variante), não
    // cada stream_id cru. Um grupo com QUALQUER variante taggeada passa
    // inteiro (o representante, por definição, é a de melhor qualidade —
    // "GNT FHD" ganha de "GNT"/"GNT H265" na hora de virar representante);
    // só fica de fora o grupo em que NENHUMA variante tem tag nenhuma.
    const qualityGrouped = useMemo(() => {
        if (qualityOnlyGroupsByCategory.size === 0) return rawGrouped;
        return rawGrouped.filter(s => {
            if (!qualityOnlyGroupsByCategory.has(s.category_id)) return true;
            const defaultVisible = isQualityTaggedChannel(s.name);
            return computeEffectiveVisibility(s.stream_id, defaultVisible, curatedChannelOverrides);
        });
    }, [rawGrouped, qualityOnlyGroupsByCategory, curatedChannelOverrides]);

    // Afiliadas/praças regionais da mesma marca ("RedeTV! Guará"/"Imperial"/
    // "Paraná"): detecta DEPOIS do agrupamento de qualidade (uma afiliada com
    // variantes FHD/HD já virou uma entrada só) e mantém só as que o usuário
    // selecionou em Configurações — padrão é só a primeira detectada.
    const filteredStreams = useMemo(() => {
        const families = detectRegionalFamilies(qualityGrouped);
        // Redes de TV aberta nacionais (Globo/SBT/RecordTV/Band/"Abertos"): a
        // categoria INTEIRA já é a rede, então vira 1 família por categoria —
        // ver o comentário em detectCategoryFamilies.
        const categoryFamilies = detectCategoryFamilies(qualityGrouped, categories);
        if (families.size === 0 && categoryFamilies.size === 0) return qualityGrouped;
        const hidden = new Set<number>();
        for (const [familyKey, members] of [...families, ...categoryFamilies]) {
            const selected = regionalPrefs.getSelected(familyKey, members[0].stream_id);
            for (const member of members) {
                if (!selected.has(member.stream_id)) hidden.add(member.stream_id);
            }
        }
        if (hidden.size === 0) return qualityGrouped;
        return qualityGrouped.filter(s => !hidden.has(s.stream_id));
    }, [qualityGrouped, categories]);

    // Canais favoritos na ORDEM MANUAL do usuário (item 17)
    const favoriteChannels = useMemo(() => {
        const list = streams.filter(s => favoriteChannelIds.has(s.stream_id));
        return favoriteOrder.apply(list);
        // favOrderTick força recomputo depois de mover um canal
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streams, favoriteChannelIds, favOrderTick]);

    // Canais de esporte pro painel "Jogos de hoje" (item 12)
    const sportsChannels = useMemo(() => {
        const sportsCategoryIds = new Set(
            categories.filter(c => isSportsCategory(c.category_name)).map(c => c.category_id)
        );
        if (sportsCategoryIds.size === 0) return [];
        return streams.filter(s => sportsCategoryIds.has(s.category_id));
    }, [streams, categories]);

    // Nome da categoria por id (detecção de rádio — item 13)
    const categoryNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const category of categories) map.set(category.category_id, category.category_name);
        return map;
    }, [categories]);

    // Lista de canais pro player (zapping). `num` é a posição sequencial
    // NESTA lista (1, 2, 3...), não o número bruto do provedor — com canal
    // oculto (manual, categoria ou grupo curado) de fora, o número bruto
    // tinha buraco (1, 2, 5, 8...); o zap-banner, a tira de preview do zap e
    // o pulo por dígito em VideoPlayer.tsx todos leem esse campo, então a
    // renumeração vale nos três de graça.
    const playerChannelList = useMemo<PlayerChannel[]>(
        () => filteredStreams.map((s, index) => ({
            stream_id: s.stream_id,
            name: channelDisplayName(s.name),
            num: index + 1,
            stream_icon: s.stream_icon,
            direct_source: s.direct_source,
        })),
        [filteredStreams]
    );

    // Variante tocando → representante do grupo (senão o CH± e o overlay
    // do player não acham o canal atual na lista agrupada)
    const representativeOf = useMemo(() => {
        const map = new Map<number, number>();
        for (const [repId, variants] of variantsOf) {
            for (const variant of variants) {
                map.set(variant.stream_id, Number(repId));
            }
        }
        return map;
    }, [variantsOf]);

    // Variante pra a prévia COMEÇAR: com o benchmark conhecendo o canal, a
    // mais confiável (liveHealth); sem histórico, a padrão do catálogo.
    // Calculado uma vez por seleção (o benchmark lê o storage).
    const melhorDoGrupo = useCallback((canal: LiveStream) => {
        const repId = representativeOf.get(canal.stream_id) ?? canal.stream_id;
        return melhorVariante(variantsOf.get(String(repId)) ?? [canal], canal, liveHealth);
    }, [representativeOf, variantsOf]);
    const padraoDaPrevia = useMemo(
        () => (selectedChannel ? melhorDoGrupo(selectedChannel) : null),
        [selectedChannel, melhorDoGrupo],
    );
    // O que a prévia está tocando DE FATO: a variante fixada pra esta seleção
    // (failover da prévia, ou a que o player tocou), senão a melhor/padrão
    const canalDaPrevia = selectedChannel && previaVariante?.de === selectedChannel.stream_id
        ? previaVariante.canal
        : padraoDaPrevia;
    const srcDaPrevia = canalDaPrevia ? canalDaPrevia.direct_source || api.getLiveStreamUrl(canalDaPrevia.stream_id) : null;
    // Congelada só enquanto o player estiver aberto (ver previaNoPlayer)
    const previaFixa = playingChannel ? previaNoPlayer : null;
    // Canal da prévia que pode ir pra Home ao sair da página: nunca no modo
    // adulto (a Home nunca mostra adulto)
    const previewCanalRef = useRef<LiveStream | null>(null);
    useEffect(() => {
        previewStreamIdRef.current = canalDaPrevia && !playingChannel && previewSrc && !previewFailed
            ? canalDaPrevia.stream_id : null;
        previewSrcRef.current = previewSrc;
        previewCanalRef.current = previewStreamIdRef.current != null && !modoAdulto ? canalDaPrevia : null;
    }, [canalDaPrevia, playingChannel, previewSrc, previewFailed, modoAdulto]);
    // Saindo da página com a prévia TOCANDO: estaciona o stream pra a Home
    // assumir (mesmo motivo do lado de lá: não esbarrar no limite de
    // conexões). Só se for o canal que a Home vai mostrar (o último
    // assistido): outro ficaria sem dono segurando uma conexão a mais
    // enquanto a Home abre a dela. Layout: roda antes de o ref da prévia
    // ser solto.
    useLayoutEffect(() => () => {
        const canal = previewCanalRef.current;
        if (!canal || canal.stream_id !== storage.getLastChannel()) return;
        const pipeline = previewRef.current?.handOff();
        if (pipeline) pipelineEstacionado.estacionar(canal.stream_id, pipeline, canal);
    }, []);

    const playerCurrentChannelId = playingChannel
        ? (representativeOf.get(playingChannel.stream_id) ?? playingChannel.stream_id)
        : undefined;

    // Foco da grade mora no ChannelGrid (ver o cabeçalho de lá): aqui só o ref.
    const gradeRef = useRef<ChannelGridHandle>(null);
    const sairDaGradePraCima = useCallback(() => setFocusArea('categories'), []);
    const sairDaGradePraEsquerda = useCallback(() => setFocusZone('sidebar'), [setFocusZone]);
    const abrirFichaDaGrade = useCallback((channel: LiveStream) => {
        // 1º OK abre a ficha com foco no "Assistir"; 2º OK dá play
        setSelectedChannel(channel);
        setFocusArea('preview');
        setPreviewFocusIndex(0);
    }, []);
    const canalFocadoNaGrade = () => filteredStreams[gradeRef.current?.focusedIndex() ?? -1];
    const abrirGuia = () => {
        setGuiaCanalId(selectedChannel?.stream_id ?? canalFocadoNaGrade()?.stream_id);
        setShowGuide(true);
    };

    // Seleção/foco resetam ao trocar filtro — o canal focado pode não
    // pertencer mais ao resultado filtrado. Só na TROCA de verdade, nunca na
    // montagem: com o catálogo em cache, a restauração do canal (último
    // assistido / stream estacionado vindo da Home) roda ANTES deste efeito
    // no mesmo commit, e ele zerava a seleção — a prévia nunca montava e o
    // stream estacionado morria sem dono.
    const filtroAnteriorRef = useRef<string | null>(null);
    useEffect(() => {
        const filtro = JSON.stringify([searchQuery, selectedCategory, onlyWithEpg, showOnlyHidden, modoAdulto]);
        const anterior = filtroAnteriorRef.current;
        filtroAnteriorRef.current = filtro;
        if (anterior === null || anterior === filtro) return;
        setSelectedChannel(null);
        gradeRef.current?.focus(0);
        setFocusArea(prev => (prev === 'preview' ? 'channels' : prev));
    }, [searchQuery, selectedCategory, onlyWithEpg, showOnlyHidden, modoAdulto]);

    // Variantes de qualidade do canal selecionado (botões da ficha)
    const selectedVariants = selectedChannel
        ? variantsOf.get(String(selectedChannel.stream_id)) || []
        : [];

    // EPG válido só se pertence ao canal selecionado ATUAL (na troca A→B o
    // dado velho de A não pode alimentar a ficha nem o ⏮ Reiniciar de B)
    const activePreviewEpg = selectedChannel && previewEpgFor === selectedChannel.stream_id
        ? previewEpg
        : null;

    // Botões da toolbar na ordem do JSX — vira a extensão da zona do header
    // (sem isso, ⭐ Agora e ⚽ Jogos só abriam por mouse)
    const favFilterOn = selectedCategory === 'FAVORITES';
    const toolbarItems: Array<'favfilter' | 'onlyepg' | 'guide' | 'random' | 'hidden' | 'favpanel' | 'sports' | 'adulto'> = [
        // Filtro ★ precisa existir enquanto ligado, mesmo sem favoritos: é ele que desliga
        ...(favoriteChannels.length > 0 || favFilterOn ? (['favfilter'] as const) : []),
        'onlyepg',
        'guide',
        'random',
        // O botão 🙈 também precisa existir ENQUANTO o modo está ligado: era
        // ele que desligava o modo, e ao desocultar o último canal ele sumia,
        // deixando a grade vazia sem nenhuma tecla que resolvesse
        ...(hiddenIds.size > 0 || showOnlyHidden ? (['hidden'] as const) : []),
        ...(favoriteChannels.length > 0 ? (['favpanel'] as const) : []),
        ...(sportsChannels.length > 0 ? (['sports'] as const) : []),
        ...(temAdulto ? (['adulto'] as const) : []),
    ];
    // Botão "Adulto": entra pedindo o PIN (sem PIN ainda, cria o "0000" e SÓ
    // DEPOIS abre o prompt — o hash é assíncrono); sai na hora, trancando
    const botaoAdulto = () => {
        if (modoAdulto) {
            setModoAdulto(false);
            setSelectedCategory('all');
            return;
        }
        if (!parentalService.isSet()) {
            parentalService.autoProvisionAdultLock().then(() => {
                setAdultoPinProvisionado(true);
                setAdultoPinAberto(true);
            });
            return;
        }
        setAdultoPinAberto(true);
    };
    // Botão ★ da toolbar: alterna a grade entre favoritos e todos os canais
    const toggleFavFilter = () => {
        if (favFilterOn) setSelectedCategory('all');
        else setSelectedCategory('FAVORITES');
    };
    const HEADER_BASE = 2; // 0 = busca, 1 = menu de categorias
    const toolbarFocusIndex = (item: string) => HEADER_BASE + toolbarItems.indexOf(item as typeof toolbarItems[number]);

    // Ações da ficha (ordem dos botões navegáveis por D-pad; variantes depois).
    // 'restart' entra no FIM: o EPG chega assíncrono e inseri-lo no meio
    // mudaria o significado do índice já focado. tv_archive vem como número
    // OU string dependendo do painel — coerção obrigatória.
    const canRestart = !!(selectedChannel && Number(selectedChannel.tv_archive) > 0 && activePreviewEpg?.now);
    const previewItems: Array<'play' | 'mute' | 'restart' | 'fav' | 'hide' | 'agenda'> = [
        'play',
        'mute',
        'fav',
        'hide',
        ...(canRestart ? (['restart'] as const) : []),
        'agenda',
    ];
    const previewActionIndex = (action: (typeof previewItems)[number]) => previewItems.indexOf(action);

    // Sessão de uso do canal ao vivo (estatísticas)
    useWatchSession('live', playingChannel?.name || '');

    // EPG da ficha do canal selecionado
    useEffect(() => {
        if (!selectedChannel) return;
        let cancelled = false;
        epgService.getChannelEpg(selectedChannel.stream_id).then(epg => {
            if (!cancelled) {
                setPreviewEpg(epg);
                setPreviewEpgFor(selectedChannel.stream_id);
            }
        });
        return () => { cancelled = true; };
    }, [selectedChannel]);

    // Preview de vídeo mudo da ficha: só liga o HLS depois de 400ms parado
    // no mesmo canal — sem isto, passear pela grade com o D-pad ligaria e
    // desligaria stream a cada canal que a seleção só passou de raspão.
    // Segue a fonte que a prévia deve tocar (a do canal ou a variante do failover)
    useEffect(() => {
        setPreviewFailed(false);
        setPreviewSrc(null);
        if (!srcDaPrevia) return;
        // Stream estacionado (vindo da Home) pra este canal: monta JÁ — o
        // debounce é pra quem passeia pela grade, e cada instante fora da
        // página é o vídeo assumido parado
        const estacionado = canalDaPrevia && pipelineEstacionado.canal() === canalDaPrevia.stream_id;
        const timer = setTimeout(() => setPreviewSrc(srcDaPrevia), estacionado ? 0 : 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- canalDaPrevia segue srcDaPrevia
    }, [srcDaPrevia]);

    // EPG do canal tocando (mini-EPG do player, atualiza a cada 60s)
    useEffect(() => {
        if (!playingChannel) {
            setPlayerEpg(null);
            return;
        }
        let cancelled = false;
        const load = () => {
            epgService.getChannelEpg(playingChannel.stream_id).then(epg => {
                if (!cancelled) setPlayerEpg(epg);
            });
        };
        load();
        const interval = setInterval(load, 60000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [playingChannel]);

    // Reproduzir canal (registra último canal + histórico de zapping)
    // Failover ao vivo — o foco é o stream não parar:
    // - variantes que já falharam NESTA sessão do canal (escolher um canal
    //   na mão zera); a rotação pula elas e, sem nenhuma sobrando, o player
    //   volta a reconectar a atual em vez de girar sem fim;
    // - atraso atrás da borda pra fonte nova entrar no MESMO ponto da que caiu
    //   (o provedor não manda PROGRAM-DATE-TIME: alinhar exato é impossível);
    // - sessão já aberta (URL com token) da variante preparada de antemão.
    const [falhasDoCanal, setFalhasDoCanal] = useState<ReadonlySet<number>>(() => new Set());
    const [atrasoAoVivo, setAtrasoAoVivo] = useState<number | null>(null);
    const [sessaoAquecida, setSessaoAquecida] = useState<{ id: number; url: string } | null>(null);
    const playingChannelRef = useRef<LiveStream | null>(null);
    // Última troca AUTOMÁTICA de fonte: cada troca deixa a conexão velha
    // contando no painel por ~20s, então troca em rajada estoura a conta
    const ultimaTrocaAutoRef = useRef(0);
    useEffect(() => { playingChannelRef.current = playingChannel; }, [playingChannel]);

    const playChannel = useCallback((stream: LiveStream, failover?: { atraso: number | null; url?: string | null }) => {
        // Mesmo canal da prévia tocando → o player assume o pipeline dela, NO
        // LUGAR: a prévia fica montada (congelada) segurando o <video>
        const entregue = previewStreamIdRef.current === stream.stream_id
            ? previewRef.current?.handOff() ?? null
            : null;
        const srcDaPreviaAgora = previewSrcRef.current;
        handoffRef.current = entregue ? { ...entregue, noLugar: !!srcDaPreviaAgora } : null;
        if (entregue && srcDaPreviaAgora) setPreviaNoPlayer({ canal: stream, src: srcDaPreviaAgora });
        if (failover) {
            setAtrasoAoVivo(failover.atraso);
            setSessaoAquecida(failover.url ? { id: stream.stream_id, url: failover.url } : null);
        } else {
            setFalhasDoCanal(new Set());
            setAtrasoAoVivo(null);
            setSessaoAquecida(null);
        }
        // A prévia fica presa NESTA variante (é a que o player devolve no
        // Voltar) — sem isto o "melhor" do benchmark podia ser outra
        setPreviaVariante({ de: stream.stream_id, canal: stream, falharam: new Set() });
        setSelectedChannel(stream);
        setPlayingChannel(stream);
        storage.setLastChannel(stream.stream_id);
        zapHistory.push(stream.stream_id);
    }, []);
    // "Abrir este canal" sem escolher variante (CH±, guia, painéis, aleatório):
    // vai na de melhor histórico, como a prévia. Sem isto a padrão do catálogo
    // que está fora do ar era tentada TODA vez e o failover achava a boa de
    // novo — a que funciona nunca virava a padrão. playChannel direto fica pra
    // variante escolhida (botão de qualidade, failover, o que a prévia toca).
    const tocarCanal = useCallback((canal: LiveStream) => playChannel(melhorDoGrupo(canal)), [playChannel, melhorDoGrupo]);

    // Failover: stream morreu de vez → tenta a próxima variante do grupo
    const handleStreamFailed = useCallback((porLimite?: boolean) => {
        if (!playingChannel) return;
        // Salvaguarda: painel recusando por LIMITE de conexões. Trocar de
        // variante abriria mais uma conexão numa conta já estourada (foi assim
        // que a conta de 1 conexão chegou a 3 e travou tudo) — não troca.
        if (porLimite) {
            setToast(<><FaExclamationTriangle /> Limite de conexões da conta — aguarde alguns segundos e tente de novo</>);
            return;
        }
        // Benchmark: só conta contra o canal se o painel NÃO estava recusando por limite
        liveHealth.registrar(playingChannel.stream_id, 'falha');
        // Caiu tocando pela sessão da prévia (token vencido?): antes de trocar
        // de variante, tenta o mesmo canal pela URL normal
        if (previewSession?.id === playingChannel.stream_id) {
            setPreviewSession(null);
            return;
        }
        const repId = representativeOf.get(playingChannel.stream_id) ?? playingChannel.stream_id;
        const variants = variantsOf.get(String(repId));
        if (!variants || variants.length < 2) return;
        const falharam = new Set(falhasDoCanal).add(playingChannel.stream_id);
        setFalhasDoCanal(falharam);
        const next = proximaVariante(variants, playingChannel.stream_id, falharam, liveHealth);
        if (next) {
            setToast(<><FaExclamationTriangle /> Falha no stream — trocando para {qualityLabel(next.name)}</>);
            // Troca recente ainda pesa na conta: espera o resto do intervalo
            // mínimo (a imagem já parou, então troca de qualquer jeito depois)
            const espera = Math.max(0, ultimaTrocaAutoRef.current + INTERVALO_TROCA_AUTO_MS - Date.now());
            const atual = playingChannel.stream_id;
            setTimeout(() => {
                if (playingChannelRef.current?.stream_id !== atual) return;
                ultimaTrocaAutoRef.current = Date.now();
                playChannel(next, { atraso: atrasoAoVivo });
            }, espera);
        } else {
            setToast(<><FaExclamationTriangle /> Todas as variantes deste canal falharam</>);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playingChannel, representativeOf, variantsOf, previewSession, falhasDoCanal, atrasoAoVivo]);

    // Aviso antecipado do player (buffer secando, imagem ainda andando):
    // abre a sessão da próxima variante AGORA, enquanto o buffer toca, e só
    // então troca — no mesmo atraso atrás da borda. São 2 conexões por alguns
    // segundos (o painel tolerou 2 no teste; 4 bloquearam a conta).
    const handleStreamDegrading = useCallback((atraso: number | null, porLimite: boolean) => {
        const atual = playingChannel;
        if (!atual) return;
        // Salvaguarda: com o painel no limite, ou com uma troca automática há
        // menos de INTERVALO_TROCA_AUTO_MS, NÃO prepara outra fonte (seria mais
        // uma conexão contando). A rede de segurança do player segue valendo.
        if (porLimite || Date.now() - ultimaTrocaAutoRef.current < INTERVALO_TROCA_AUTO_MS) return;
        liveHealth.registrar(atual.stream_id, 'falha');
        const repId = representativeOf.get(atual.stream_id) ?? atual.stream_id;
        const variants = variantsOf.get(String(repId));
        if (!variants || variants.length < 2) return;
        const next = proximaVariante(variants, atual.stream_id, new Set(falhasDoCanal).add(atual.stream_id), liveHealth);
        if (!next) return; // nada pra preparar: a rede de segurança reconecta a atual
        setToast(<><FaExclamationTriangle /> Sinal fraco — preparando {qualityLabel(next.name)}</>);
        void resolverUrlFinal(next.direct_source || api.getLiveStreamUrl(next.stream_id), 4000).then(url => {
            // Enquanto preparava, a rede de segurança (ou a pessoa) já trocou
            if (playingChannelRef.current?.stream_id !== atual.stream_id) return;
            setFalhasDoCanal(prev => new Set(prev).add(atual.stream_id));
            ultimaTrocaAutoRef.current = Date.now();
            playChannel(next, { atraso, url });
        });
    }, [playingChannel, representativeOf, variantsOf, falhasDoCanal, playChannel]);

    // A prévia não subiu (erro ou pendurada): tenta a próxima variante do canal
    // selecionado. Painel recusando por limite → para no logo (salvaguarda:
    // outra variante seria mais uma conexão numa conta já estourada).
    const handlePreviewFailed = (causa?: StreamErrorCause | 'stall') => {
        const selecionado = selectedChannel;
        const atual = canalDaPrevia;
        if (!selecionado || !atual) return;
        if (causa === 'connlimit') {
            setPreviewFailed(true);
            return;
        }
        liveHealth.registrar(atual.stream_id, 'falha');
        const repId = representativeOf.get(selecionado.stream_id) ?? selecionado.stream_id;
        const variants = variantsOf.get(String(repId)) ?? [];
        const anteriores = previaVariante?.de === selecionado.stream_id ? previaVariante.falharam : new Set<number>();
        const falharam = new Set(anteriores).add(atual.stream_id);
        const next = proximaVariante(variants, atual.stream_id, falharam, liveHealth);
        if (!next) {
            setPreviewFailed(true);
            return;
        }
        setToast(<><FaExclamationTriangle /> Prévia: trocando para {qualityLabel(next.name)}</>);
        setPreviaVariante({ de: selecionado.stream_id, canal: next, falharam });
        // Era o último assistido: a variante que funciona passa a ser ele — a
        // Home (e o stream estacionado entre as páginas) já abre nela, em vez
        // de tentar a quebrada de novo toda vez
        if (storage.getLastChannel() === atual.stream_id) storage.setLastChannel(next.stream_id);
    };

    // Variantes do canal TOCANDO (não o pré-visualizado) → menu unificado do player
    const playingVariants = useMemo(
        () => playingChannel
            ? variantsOf.get(String(representativeOf.get(playingChannel.stream_id) ?? playingChannel.stream_id)) || []
            : [],
        [playingChannel, representativeOf, variantsOf]
    );

    // Ainda há variante que não falhou nesta sessão → failover rápido (ver handleStreamFailed)
    const hasNextVariant = !!playingChannel
        && proximaVariante(playingVariants, playingChannel.stream_id, falhasDoCanal) !== null;
    // Fontes que sobram pro watchdog trocar: sessão da prévia → URL normal → variante
    const hasAlternativeSource = hasNextVariant
        || (!!playingChannel && previewSession?.id === playingChannel.stream_id);

    const playerQualityVariants = useMemo(
        () => playingVariants.length > 1
            ? playingVariants.map(v => ({
                  id: String(v.stream_id),
                  label: qualityLabel(v.name),
                  selected: v.stream_id === playingChannel?.stream_id,
              }))
            : undefined,
        [playingVariants, playingChannel?.stream_id]
    );

    const handleSelectQualityVariant = useCallback((id: string) => {
        const variant = playingVariants.find(v => String(v.stream_id) === id);
        if (variant) playChannel(variant);
    }, [playingVariants, playChannel]);

    // Zapping vindo do player (CH±, dígitos, overlay)
    const handleSwitchChannel = useCallback((streamId: number) => {
        const found = streams.find(s => s.stream_id === streamId);
        if (found) tocarCanal(found);
    }, [streams, tocarCanal]);

    // Ações dos atalhos coloridos
    const toggleChannelFavorite = useCallback((stream: LiveStream) => {
        const added = storage.toggleFavorite({
            id: String(stream.stream_id),
            type: 'channel',
            title: stream.name,
            poster: stream.stream_icon || undefined,
        });
        setFavTick(t => t + 1);
        setToast(added
            ? <><FaStar /> {stream.name} favoritado</>
            : <><FaRegStar /> {stream.name} removido dos favoritos</>);
    }, []);

    const toggleChannelHidden = useCallback((stream: LiveStream) => {
        const set = hiddenChannels.toggle(stream.stream_id);
        setHiddenIds(new Set(set));
        setToast(set.has(stream.stream_id)
            ? <><FaEyeSlash /> {stream.name} oculto</>
            : <><FaEye /> {stream.name} visível de novo</>);
    }, []);

    // Tocar programas do arquivo como FILA (agenda ou reiniciar): no fim de
    // cada um, avança pro próximo — e ao alcançar o programa no ar, volta ao
    // vivo (item 10)
    // Programas de catch-up emendados sozinhos (item 51) — a contagem tem que
    // sobreviver ao remount do player, que troca de key a cada programa
    const archiveAutoAdvanceRef = useRef(0);

    const playArchive = (channel: LiveStream, programs: EpgProgram[], index: number) => {
        archiveAutoAdvanceRef.current = 0;
        setShowAgenda(false);
        // O player ao vivo desmonta sem devolver (zera o <video> da prévia)
        if (previaNoPlayer) {
            setPreviaNoPlayer(null);
            setGeracaoPrevia(g => g + 1);
        }
        setPlayingChannel(null);
        setArchivePlayback({ channel, programs, index });
    };

    // Programa reproduzível na fila: passado e com arquivo (campo ausente
    // conta como reproduzível — o canal já passou pelo gate de tv_archive)
    const isArchivable = (program: EpgProgram, nowMs: number) =>
        program.end <= nowMs && program.hasArchive !== false;

    const advanceArchive = () => {
        if (!archivePlayback) return;
        const nowMs = Date.now();
        // Pula programas sem arquivo no meio da fila (senão a URL dá 404 e trava)
        let nextIndex = archivePlayback.index + 1;
        while (
            nextIndex < archivePlayback.programs.length &&
            archivePlayback.programs[nextIndex].end <= nowMs &&
            archivePlayback.programs[nextIndex].hasArchive === false
        ) {
            nextIndex++;
        }
        const next = archivePlayback.programs[nextIndex];
        // Sem próximo, próximo ainda no futuro, ou próximo é o programa NO AR
        // → volta pro canal ao vivo
        if (!next || next.start > nowMs || next.end > nowMs) {
            const channel = archivePlayback.channel;
            setArchivePlayback(null);
            tocarCanal(channel);
            return;
        }
        setArchivePlayback({ ...archivePlayback, index: nextIndex });
    };

    const previousArchiveIndex = (): number => {
        if (!archivePlayback) return -1;
        const nowMs = Date.now();
        for (let i = archivePlayback.index - 1; i >= 0; i--) {
            if (isArchivable(archivePlayback.programs[i], nowMs)) return i;
        }
        return -1;
    };

    const previousArchive = () => {
        const prevIndex = previousArchiveIndex();
        if (!archivePlayback || prevIndex < 0) return;
        setArchivePlayback({ ...archivePlayback, index: prevIndex });
    };

    // Reiniciar o programa atual via timeshift (só quando tv_archive > 0)
    const restartProgram = () => {
        if (!selectedChannel || !activePreviewEpg?.now) return;
        const programs = activePreviewEpg.programs.length > 0 ? activePreviewEpg.programs : [activePreviewEpg.now];
        const index = Math.max(0, programs.findIndex(p => p.start === activePreviewEpg.now?.start));
        playArchive(selectedChannel, programs, index);
    };

    // Lembrete de programa (item 3)
    const toggleReminder = useCallback((channel: LiveStream, program: { title: string; start: number }) => {
        const active = reminderService.toggle({
            streamId: channel.stream_id,
            channelName: channel.name,
            programTitle: program.title,
            startMs: program.start,
        });
        setToast(active
            ? <><FaBell /> Lembrete criado: {program.title}</>
            : <><FaBellSlash /> Lembrete removido: {program.title}</>);
        return active;
    }, []);

    // Reordenar favoritos (item 17)
    const moveFavorite = useCallback((channel: LiveStream, direction: -1 | 1) => {
        const ids = favoriteChannels.map(c => c.stream_id);
        favoriteOrder.move(ids, channel.stream_id, direction);
        setFavOrderTick(t => t + 1);
    }, [favoriteChannels]);

    // Pause live via timeshift (item 8): só em canal com catch-up
    const handleRequestPauseLive = useCallback((pausedAtMs: number): string | null => {
        if (!playingChannel || Number(playingChannel.tv_archive) <= 0) return null;
        // pausedAtMs é Date.now() REAL — o offset de EPG só corrige horários
        // vindos do guia, nunca o relógio do aparelho
        return api.getTimeshiftUrl(playingChannel.stream_id, pausedAtMs, 180);
    }, [playingChannel]);

    const randomZap = useCallback(() => {
        const pool = filteredStreams.filter(s => s.stream_id !== playingChannel?.stream_id);
        if (pool.length === 0) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        tocarCanal(pick);
    }, [filteredStreams, playingChannel, tocarCanal]);

    const toggleOnlyEpg = useCallback(() => {
        setOnlyWithEpg(prev => {
            liveToggles.setOnlyWithEpg(!prev);
            return !prev;
        });
    }, []);

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            // Header: 0 = busca, 1 = menu de categorias
            if (direction === 'left') {
                if (focusedCategoryIndex === 0) {
                    setFocusZone('sidebar');
                } else {
                    setFocusedCategoryIndex(prev => prev - 1);
                }
            } else if (direction === 'right') {
                setFocusedCategoryIndex(prev => Math.min(HEADER_BASE + toolbarItems.length - 1, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('channels');
                gradeRef.current?.focus(0);
            }
        } else if (focusArea === 'preview') {
            const totalPreviewItems = previewItems.length + selectedVariants.length;
            if (direction === 'left') {
                setPreviewFocusIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                setPreviewFocusIndex(prev => Math.min(totalPreviewItems - 1, prev + 1));
            } else if (direction === 'down' || direction === 'up') {
                setFocusArea('channels');
            }
        } else if (focusArea === 'channels') {
            gradeRef.current?.navigate(direction);
        }
    };

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
                const item = toolbarItems[focusedCategoryIndex - HEADER_BASE];
                if (item === 'favfilter') toggleFavFilter();
                else if (item === 'onlyepg') toggleOnlyEpg();
                else if (item === 'guide') abrirGuia();
                else if (item === 'random') randomZap();
                else if (item === 'hidden') setShowOnlyHidden(prev => !prev);
                else if (item === 'favpanel') setShowFavoritesPanel(true);
                else if (item === 'sports') setShowSportsPanel(true);
                else if (item === 'adulto') botaoAdulto();
            }
        } else if (focusArea === 'preview') {
            if (!selectedChannel) return;
            if (previewFocusIndex < previewItems.length) {
                const action = previewItems[previewFocusIndex];
                if (action === 'play') playChannel(canalDaPrevia ?? selectedChannel);
                else if (action === 'mute') togglePreviewMuted();
                else if (action === 'restart') restartProgram();
                else if (action === 'fav') toggleChannelFavorite(selectedChannel);
                else if (action === 'hide') toggleChannelHidden(selectedChannel);
                // Sem fallback destrutivo: item novo sem branch não pode ocultar canal
                else if (action === 'agenda') setShowAgenda(true);
            } else {
                const variant = selectedVariants[previewFocusIndex - previewItems.length];
                if (variant) playChannel(variant);
            }
        } else if (focusArea === 'channels') {
            gradeRef.current?.select();
        }
    };

    const handleBack = () => {
        if (focusArea === 'preview' || selectedChannel) {
            setSelectedChannel(null);
            setFocusArea('channels');
            return;
        }
        // Na raiz da página, Voltar devolve o foco pra sidebar — sem isto a
        // tecla não fazia nada e o usuário ficava preso na grade de canais.
        setFocusZone('sidebar');
    };

    // Color keys: 🔴 só-EPG · 🟢 aleatório · 🟡 favorito · 🔵 ocultar
    const handleAction = (action: string) => {
        if (action === 'red') {
            toggleOnlyEpg();
        } else if (action === 'green') {
            randomZap();
        } else if (action === 'yellow' || action === 'blue') {
            const channel = (focusArea === 'channels' && canalFocadoNaGrade()) || selectedChannel;
            if (channel) {
                if (action === 'yellow') toggleChannelFavorite(channel);
                else toggleChannelHidden(channel);
            }
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        onAction: handleAction,
        enabled: focusZone === 'content' && !error && !playingChannel && !archivePlayback && !showAgenda && !showGuide && !categoryMenuOpen && !showFavoritesPanel && !showSportsPanel && !adultoPinAberto,
    });

    const getLivePlaybackUrl = (stream: LiveStream) => {
        if (sessaoAquecida?.id === stream.stream_id) return sessaoAquecida.url;
        if (previewSession?.id === stream.stream_id) return previewSession.url;
        return stream.direct_source || api.getLiveStreamUrl(stream.stream_id);
    };

    // Loading State with Animation
    if (loading) {
        return (
            <div className="livetv-loading-container">
                <div className="livetv-bg-gradient" />
                <div className="livetv-bg-glow" />

                <div className="loading-icon-wrapper">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="loading-ring" style={{ animationDelay: `${i * 0.5}s` }} />
                    ))}
                    <div className="loading-tv-icon"><FaBroadcastTower /></div>
                </div>

                <div className="loading-text">
                    <span>Carregando canais</span>
                    <div className="loading-dots">
                        {[0, 1, 2].map(i => (
                            <span key={i} className="loading-dot" style={{ animationDelay: `${i * 0.2}s` }} />
                        ))}
                    </div>
                </div>

                <div className="loading-skeleton-grid">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="skeleton-card">
                            <div className="skeleton-icon" />
                            <div className="skeleton-text">
                                <div className="skeleton-line skeleton-line-long" />
                                <div className="skeleton-line skeleton-line-short" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <ErrorScreen
                icon={FaBroadcastTower}
                title="Erro ao carregar canais"
                message={error}
                className="livetv-error-container"
            />
        );
    }

    return (
        <div className="livetv-page">
            {/* Animated Background */}
            <div className="livetv-bg-gradient" />
            <div className="livetv-bg-glow" />

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar canais..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categoriasDoMenu}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="live"
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 1}
                onOpenChange={setCategoryMenuOpen}
                extraCategories={[{ category_id: 'FAVORITES', category_name: 'Favoritos', parent_id: 0 }]}
                hiddenCategoryIds={hiddenCatIds}
                onToggleHideCategory={(id) => setHiddenCatIds(new Set(hiddenCategories.toggle(id)))}
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
                            setSelectedCategory('all');
                            setModoAdulto(true);
                        }
                        return ok;
                    }}
                    onCancel={() => setAdultoPinAberto(false)}
                />
            )}

            {/* Toolbar de filtros */}
            <div className="livetv-toolbar">
                {(favoriteChannels.length > 0 || favFilterOn) && (
                    <button
                        className={`toolbar-btn ${favFilterOn ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('favfilter') ? 'tv-focused' : ''}`}
                        onClick={toggleFavFilter}
                        title={favFilterOn ? 'Mostrar todos os canais' : 'Mostrar só os favoritos'}
                    >
                        <FaStar /> Favoritos
                    </button>
                )}
                <button
                    className={`toolbar-btn ${onlyWithEpg ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('onlyepg') ? 'tv-focused' : ''}`}
                    onClick={toggleOnlyEpg}
                    title="Só canais com EPG"
                >
                    <FaCalendarAlt />
                </button>
                <button
                    className={`toolbar-btn ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('guide') ? 'tv-focused' : ''}`}
                    onClick={abrirGuia}
                    title="Guia de programação (grade multi-canal)"
                >
                    <FaThLarge />
                </button>
                <button
                    className={`toolbar-btn ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('random') ? 'tv-focused' : ''}`}
                    onClick={randomZap}
                    title="Canal aleatório"
                >
                    <FaRandom />
                </button>
                {(hiddenIds.size > 0 || showOnlyHidden) && (
                    <button
                        className={`toolbar-btn ${showOnlyHidden ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('hidden') ? 'tv-focused' : ''}`}
                        onClick={() => setShowOnlyHidden(prev => !prev)}
                        title="Ver canais ocultos"
                    >
                        <FaEyeSlash /> {hiddenIds.size}
                    </button>
                )}
                {favoriteChannels.length > 0 && (
                    <button
                        className={`toolbar-btn ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('favpanel') ? 'tv-focused' : ''}`}
                        onClick={() => setShowFavoritesPanel(true)}
                        title="Agora nos favoritos"
                    >
                        <FaStar /> Agora
                    </button>
                )}
                {sportsChannels.length > 0 && (
                    <button
                        className={`toolbar-btn ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('sports') ? 'tv-focused' : ''}`}
                        onClick={() => setShowSportsPanel(true)}
                        title="Jogos de hoje"
                    >
                        <FaFutbol /> Jogos
                    </button>
                )}
                {temAdulto && (
                    <button
                        className={`toolbar-btn ${modoAdulto ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('adulto') ? 'tv-focused' : ''}`}
                        onClick={botaoAdulto}
                        title={modoAdulto ? 'Sair do conteúdo adulto (pede o PIN pra voltar)' : 'Conteúdo adulto (pede o PIN)'}
                    >
                        {modoAdulto ? <FaLockOpen /> : <FaLock />} Adulto
                    </button>
                )}
            </div>

            {/* Channel Preview (when selected) — não junto com o player cheio
                tocando: a ficha ficava montada por baixo do VideoPlayer,
                com a própria prévia de vídeo ainda tentando manter conexão
                HLS atrás da tela cheia — canal duplicado consumindo uma
                conexão à toa (achado ao verificar a prévia muda do zap-list:
                a conta de teste aguenta 2 conexões simultâneas só, e essa
                sobrava escondida gastando uma). Fechar o player (onClose)
                não limpa `selectedChannel` de propósito — o usuário volta
                pra ficha, não pra grade — então a prévia reaparece sozinha
                quando `playingChannel` volta a null. */}
            {selectedChannel && (!playingChannel || previaFixa) && (
                <div className={`channel-preview ${previaFixa ? 'channel-preview-sob-player' : ''}`}>
                    <div className="preview-header">
                        <h2 className="preview-title">{channelDisplayName(selectedChannel.name)}</h2>
                        <button
                            className="preview-close"
                            onClick={() => {
                                setSelectedChannel(null);
                                setFocusArea('channels');
                            }}
                        ><FaTimes /></button>
                    </div>
                    <div className="preview-content">
                        <div className="preview-video">
                            {/* Vídeo mudo só depois do debounce (previewSrc) — antes
                                disso, ou se o stream falhar, cai no logo estático de
                                sempre. `key` força remontar o preview (e portanto o
                                useHls por trás) quando o canal muda mesmo que o src
                                resolvido dê na mesma URL por acidente. */}
                            {previaFixa || (previewSrc && !previewFailed) ? (
                                <LiveChannelPreview
                                    ref={previewRef}
                                    key={`${(previaFixa?.canal ?? canalDaPrevia)?.stream_id ?? selectedChannel.stream_id}-${geracaoPrevia}`}
                                    src={previaFixa?.src ?? previewSrc ?? ''}
                                    canalId={(previaFixa?.canal ?? canalDaPrevia)?.stream_id}
                                    adopt={devolucaoRef.current && devolucaoRef.current.id === canalDaPrevia?.stream_id ? devolucaoRef.current.pipeline : null}
                                    muted={previewMuted}
                                    // Sem gravar: barrado agora não quer dizer que o usuário prefira mudo
                                    onAutoMuted={() => setPreviewMuted(true)}
                                    onResolvedUrl={url => canalDaPrevia && setPreviewSession({ id: canalDaPrevia.stream_id, url })}
                                    onError={handlePreviewFailed}
                                />
                            ) : (
                                <div className="preview-placeholder">
                                    {isBroken(selectedChannel.stream_id) || !selectedChannel.stream_icon ? (
                                        <span className="placeholder-emoji"><FaBroadcastTower /></span>
                                    ) : (
                                        <img decoding="async"
                                            src={selectedChannel.stream_icon}
                                            alt={selectedChannel?.name || 'Canal'}
                                            onError={() => markBroken(selectedChannel.stream_id)}
                                        />
                                    )}
                                </div>
                            )}
                            <div className="live-badge">
                                <span className="live-dot" />
                                {/* O <span> não é decorativo: texto solto vira
                                    item flex ANÔNIMO, que nenhum seletor CSS
                                    alcança — e o fallback de gap some. */}
                                <span>AO VIVO</span>
                            </div>
                        </div>
                        <div className="preview-details">
                            {/* EPG agora / a seguir */}
                            {activePreviewEpg?.now ? (
                                <div className="preview-epg">
                                    <div className="preview-epg-now">
                                        <span className="epg-label">AGORA</span>
                                        <span className="epg-title">{activePreviewEpg.now.title}</span>
                                        <span className="epg-time">
                                            {formatClock(activePreviewEpg.now.start)} – {formatClock(activePreviewEpg.now.end)}
                                        </span>
                                    </div>
                                    <div className="preview-epg-progress">
                                        <div
                                            className="preview-epg-progress-fill"
                                            style={{ width: `${epgService.progressPct(activePreviewEpg.now) ?? 0}%` }}
                                        />
                                    </div>
                                    {activePreviewEpg.next && (
                                        <div className="preview-epg-next">
                                            <span className="epg-label">A SEGUIR</span>
                                            <span className="epg-title-next">{activePreviewEpg.next.title}</span>
                                            <span className="epg-time">{formatClock(activePreviewEpg.next.start)}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="preview-epg preview-epg-empty">Sem programação disponível</div>
                            )}

                            {/* Variantes de qualidade */}
                            {selectedVariants.length > 1 && (
                                <div className="preview-variants">
                                    {selectedVariants.map((variant, vIndex) => (
                                        <button
                                            key={variant.stream_id}
                                            className={`variant-btn ${focusArea === 'preview' && previewFocusIndex === previewItems.length + vIndex ? 'tv-focused' : ''}`}
                                            onClick={() => playChannel(variant)}
                                        >
                                            {qualityLabel(variant.name)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="preview-actions">
                                <button
                                    className={`play-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('play') ? 'tv-focused' : ''}`}
                                    onClick={() => playChannel(canalDaPrevia ?? selectedChannel)}
                                >
                                    <FaPlay /> Assistir
                                </button>
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('mute') ? 'tv-focused' : ''}`}
                                    onClick={togglePreviewMuted}
                                    title={previewMuted ? 'Ligar o som da prévia' : 'Silenciar a prévia'}
                                >
                                    {previewMuted ? <><FaVolumeMute /> Som</> : <><FaVolumeUp /> Mudo</>}
                                </button>
                                <button
                                    className={`info-button ${favoriteChannelIds.has(selectedChannel.stream_id) ? 'active' : ''} ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('fav') ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelFavorite(selectedChannel)}
                                    title="Favorito"
                                >
                                    {favoriteChannelIds.has(selectedChannel.stream_id) ? <><FaStar /> Favorito</> : <><FaRegStar /> Favoritar</>}
                                </button>
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('hide') ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelHidden(selectedChannel)}
                                    title="Ocultar canal"
                                >
                                    {hiddenIds.has(selectedChannel.stream_id) ? <><FaEye /> Mostrar</> : <><FaEyeSlash /> Ocultar</>}
                                </button>
                                {canRestart && (
                                    <button
                                        className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('restart') ? 'tv-focused' : ''}`}
                                        onClick={restartProgram}
                                        title="Reiniciar o programa atual (catch-up)"
                                    >
                                        <FaHistory /> Reiniciar
                                    </button>
                                )}
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('agenda') ? 'tv-focused' : ''}`}
                                    onClick={() => setShowAgenda(true)}
                                    title="Programação do dia"
                                >
                                    <FaClipboardList /> Agenda
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Channels Grid — virtualizado (react-window): o catálogo pode
                ter milhares de canais, e só a janela visível+overscan monta. */}
            <div ref={scrollContainerRef} className="livetv-content">
                {filteredStreams.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon"><FaBroadcastTower /></div>
                        {contentFlags.includeTV() ? (
                            <>
                                <p>Nenhum canal encontrado</p>
                                <span>Tente buscar por outro termo</span>
                            </>
                        ) : (
                            <>
                                <p>TV ao vivo desativada para esta playlist</p>
                                <span>Mude isso ao adicionar a playlist de novo, em Configurações</span>
                            </>
                        )}
                    </div>
                ) : (
                    <ChannelGrid
                        ref={gradeRef}
                        items={filteredStreams}
                        columns={columns}
                        columnWidth={columnWidth}
                        active={focusArea === 'channels'}
                        isBroken={isBroken}
                        onImageError={markBroken}
                        onSelect={setSelectedChannel}
                        onOpen={abrirFichaDaGrade}
                        onExitUp={sairDaGradePraCima}
                        onExitLeft={sairDaGradePraEsquerda}
                        selectedId={selectedChannel?.stream_id}
                        favoriteIds={favoriteChannelIds}
                    />
                )}
            </div>

            {/* Footer Hints */}
            <div className="livetv-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Ficha / Assistir</span>
                <span>← Voltar</span>
                <RemoteColorHint color="red" label="Só EPG" />
                <RemoteColorHint color="green" label="Aleatório" />
                <RemoteColorHint color="yellow" label="Favorito" />
                <RemoteColorHint color="blue" label="Ocultar" />
            </div>

            {/* Agenda do dia do canal (itens 2+4) */}
            {showAgenda && selectedChannel && (
                <ChannelAgendaOverlay
                    channel={selectedChannel}
                    onClose={() => setShowAgenda(false)}
                    onPlayArchive={(programs, index) => {
                        if (selectedChannel) playArchive(selectedChannel, programs, index);
                    }}
                    onToggleReminder={(program) => {
                        if (!selectedChannel) return false;
                        return toggleReminder(selectedChannel, program);
                    }}
                    isReminded={(program) =>
                        !!selectedChannel && reminderService.has(selectedChannel.stream_id, program.start)}
                />
            )}

            {/* Catch-up: fila de programas do arquivo via timeshift (itens 4+10).
                start é DES-ofsetado: program.start inclui o ajuste de fuso do
                usuário, mas a URL de timeshift precisa do epoch real do provedor */}
            {archivePlayback && (() => {
                const program = archivePlayback.programs[archivePlayback.index];
                if (!program) return null;
                const realStart = program.start - epgOffset.get() * 3600 * 1000;
                // Programa NO AR: pedir só o já gravado (fim clampado ao agora);
                // painéis variam no tratamento de duração futura
                const effectiveEnd = Math.min(program.end, Date.now());
                const durationMin = Math.max(1, Math.ceil((effectiveEnd - program.start) / 60000));
                return (
                    <VideoPlayer
                        key={`${archivePlayback.channel.stream_id}-${program.start}`}
                        autoAdvanceCountRef={archiveAutoAdvanceRef}
                        src={api.getTimeshiftUrl(archivePlayback.channel.stream_id, realStart, durationMin)}
                        title={`Replay: ${program.title} — ${archivePlayback.channel.name}`}
                        poster={archivePlayback.channel.stream_icon || undefined}
                        autoPlay
                        // A fila do arquivo sempre emenda: é ela que devolve o
                        // usuário ao AO VIVO quando alcança o programa no ar.
                        // Isso não pode depender da opção "emendar episódio".
                        autoAdvance
                        onNextEpisode={advanceArchive}
                        onPreviousEpisode={previousArchive}
                        canGoNext
                        canGoPrevious={previousArchiveIndex() >= 0}
                        onClose={() => setArchivePlayback(null)}
                    />
                );
            })()}

            {/* Guia de programação multi-canal (item 1) */}
            {showGuide && (
                <EpgGrid
                    channels={filteredStreams}
                    initialChannelId={guiaCanalId}
                    onClose={() => setShowGuide(false)}
                    onPlay={(canal) => {
                        setShowGuide(false);
                        tocarCanal(canal);
                    }}
                    onPlayArchive={(canal, programas, index) => {
                        setShowGuide(false);
                        playArchive(canal, programas, index);
                    }}
                    onToggleReminder={(canal, programa) => toggleReminder(canal, programa)}
                    isReminded={(canal, programa) => reminderService.has(canal.stream_id, programa.start)}
                />
            )}

            {/* Agora nos favoritos (item 7) + reordenar (item 17) */}
            {showFavoritesPanel && (
                <FavoritesNowPanel
                    channels={favoriteChannels}
                    onClose={() => setShowFavoritesPanel(false)}
                    onPlay={(channel) => {
                        setShowFavoritesPanel(false);
                        tocarCanal(channel);
                    }}
                    onMove={moveFavorite}
                />
            )}

            {/* Jogos de hoje (item 12) */}
            {showSportsPanel && (
                <SportsPanel
                    channels={sportsChannels}
                    onClose={() => setShowSportsPanel(false)}
                    onPlay={(channel) => {
                        setShowSportsPanel(false);
                        tocarCanal(channel);
                    }}
                    onRemind={(event: SportsEvent) => toggleReminder(event.channel, event.program)}
                    isReminded={(event: SportsEvent) =>
                        reminderService.has(event.channel.stream_id, event.program.start)}
                />
            )}

            {toast && <div className="livetv-toast">{toast}</div>}

            {playingChannel && !archivePlayback && (
                <VideoPlayer
                    src={getLivePlaybackUrl(playingChannel)}
                    title={channelDisplayName(playingChannel.name)}
                    poster={playingChannel.stream_icon}
                    isLive
                    autoPlay
                    contentType="live"
                    liveEpg={playerEpg}
                    channelList={playerChannelList}
                    currentChannelId={playerCurrentChannelId}
                    onSwitchChannel={handleSwitchChannel}
                    contentKey={`live-${playingChannel.stream_id}`}
                    onStreamFailed={handleStreamFailed}
                    onStreamDegrading={handleStreamDegrading}
                    onLiveHealthy={() => liveHealth.registrar(playingChannel.stream_id, 'ok')}
                    liveSyncDuration={atrasoAoVivo}
                    maxReconnectAttempts={hasAlternativeSource ? FAILOVER_RECONNECT_ATTEMPTS : undefined}
                    hasAlternativeSource={hasAlternativeSource}
                    adopt={handoffRef.current}
                    onRequestPauseLive={handleRequestPauseLive}
                    isRadio={isRadioChannel(playingChannel, categoryNameById.get(playingChannel.category_id))}
                    qualityVariants={playerQualityVariants}
                    onSelectQualityVariant={handleSelectQualityVariant}
                    onClose={(devolvido) => {
                        handoffRef.current = null;
                        const fixa = previaNoPlayer;
                        setPreviaNoPlayer(null);
                        if (devolvido && fixa && fixa.canal.stream_id === playingChannel.stream_id
                            && previewRef.current?.retomar(devolvido)) {
                            // A prévia reassumiu o pipeline com o <video> no lugar
                        } else if (devolvido) {
                            // A prévia só assume se for montar AGORA, neste mesmo
                            // commit, pro canal que estava tocando: previewSrc
                            // pronto (o debounce de 400ms de um zap recente pode
                            // não ter passado). Senão o pipeline morre aqui.
                            if (previewSrc && !previewFailed && canalDaPrevia?.stream_id === playingChannel.stream_id) {
                                devolucaoRef.current = { id: playingChannel.stream_id, pipeline: devolvido };
                            } else {
                                devolvido.hls.destroy();
                                devolvido.video.pause();
                                devolvido.video.removeAttribute('src');
                                devolvido.video.load();
                            }
                        } else if (fixa) {
                            setGeracaoPrevia(g => g + 1);
                        }
                        setPlayingChannel(null);
                    }}
                />
            )}
        </div>
    );
}
