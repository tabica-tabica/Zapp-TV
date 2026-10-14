// VideoPlayer Component - Premium player with HLS support for TV
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import {
    FaPlay, FaPause, FaCog, FaStepForward, FaStepBackward, FaListUl, FaMoon, FaExpand,
    FaVolumeUp, FaVolumeDown, FaVolumeMute, FaTimes, FaBroadcastTower, FaSync,
    FaExclamationTriangle, FaHeadphones, FaThumbtack, FaBackward, FaForward, FaImages,
} from 'react-icons/fa';
import { useHls, type StreamErrorCause } from '../../hooks/useHls';
import {
    MAX_RECONNECT_ATTEMPTS, isTerminalCause, reconnectDelayMs, liveFeedStalled, liveBufferDying, CONNLIMIT_WINDOW_MS,
    LIVE_ADOPT_GRACE_MS,
} from '../../services/playerDecisions';
import { playbackPrefs } from '../../services/playbackPrefs';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import { useFocusZone } from '../../contexts/FocusContext';
import { epgService, type EpgProgram } from '../../services/epgService';
import { aspectPrefs, ASPECT_MODES, ASPECT_LABELS, zapHistory, type AspectMode } from '../../services/liveExtras';
import {
    qualityByContent,
    qualityCap,
    subtitleSize as subtitleSizePref,
    statsOverlay,
    playerVolume,
    SUBTITLE_SIZES,
    SUBTITLE_SIZE_LABELS,
    type SubtitleSize,
} from '../../services/playerPrefs';
import { storage } from '../../services/storage';
import { searchSubtitles, resolveSubtitleTrack, type SubtitleResult } from '../../services/openSubtitles';
import type { LivePipeline } from '../LiveChannelPreview';
import { nextMoment, prevMoment, TOLERANCIA_MOMENTO_S } from '../../services/secretList';
import { useLogoPequeno } from '../../services/logoPequeno';
import { elevarQuadro } from '../../services/camadaVideo';
import './VideoPlayer.css';

export interface PlayerChannel {
    stream_id: number;
    name: string;
    num?: number;
    stream_icon?: string;
    /** Só pra prévia muda do overlay de zapping — mesma preferência de LiveTV.tsx (direct_source > URL montada). */
    direct_source?: string;
}

export interface VideoPlayerProps {
    src: string;
    title?: string;
    poster?: string;
    /**
     * Fechou. Com `adopt` (pipeline da prévia), o player DEVOLVE o pipeline
     * ainda tocando quando dá — quem chamou decide se a prévia assume ou se
     * destrói (ver LiveTV). Sem `adopt`, nunca vem pipeline.
     */
    onClose?: (devolvido?: LivePipeline) => void;
    isLive?: boolean;
    autoPlay?: boolean;
    resumeTime?: number | null;
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
    contentType?: 'movie' | 'series' | 'live';
    /** Mini-EPG do canal ao vivo (agora / a seguir) */
    liveEpg?: { now: EpgProgram | null; next: EpgProgram | null } | null;
    /** Lista de canais pro zapping (CH+/CH−, dígitos e overlay 📺) */
    channelList?: PlayerChannel[];
    currentChannelId?: number;
    onSwitchChannel?: (streamId: number) => void;
    /** Chave pra lembrar a proporção por conteúdo (ex.: "live-123") */
    contentKey?: string;
    /** Todas as tentativas de reconexão falharam (LiveTV usa pra failover de variante) */
    /**
     * Fonte desistida. `porLimite`: o painel estava recusando por limite de
     * conexões da conta — a culpa não é do canal (o benchmark não conta).
     */
    onStreamFailed?: (porLimite?: boolean) => void;
    /** Ao vivo: a fonte tocou 10s seguidos sem travar (benchmark, ver liveHealth). Uma vez por fonte. */
    onLiveHealthy?: () => void;
    /** Tentativas antes de desistir (e chamar onStreamFailed). Menor quando há variante pra failover. */
    maxReconnectAttempts?: number;
    /**
     * Pause live (item 8): o canal tem catch-up, então pausar troca pro
     * timeshift daquele instante. A página devolve a URL; null = sem suporte.
     */
    onRequestPauseLive?: (pausedAtMs: number) => string | null;
    /**
     * Ao vivo, com fonte alternativa: o buffer está acabando e nada novo chega
     * (liveBufferDying) — a imagem AINDA anda. Avisa UMA vez por fonte, com o
     * atraso atual atrás da borda (s), pra quem chamou preparar a troca
     * enquanto o buffer toca. O liveFeedStalled segue de rede de segurança.
     */
    onStreamDegrading?: (atrasoS: number | null, porLimite: boolean) => void;
    /** Ao vivo: atraso atrás da borda pra começar esta fonte (ver useHls) */
    liveSyncDuration?: number | null;
    /** Canal de rádio (item 13): UI de áudio, sem vídeo */
    isRadio?: boolean;
    /**
     * Emendar o próximo item ao terminar. Sem valor, segue a preferência de
     * "emendar o próximo episódio" das Configurações — que é sobre SÉRIES.
     * A fila de catch-up passa `true`: é ela que devolve o usuário ao AO VIVO
     * quando alcança o programa no ar, e isso não pode depender daquela opção.
     */
    autoAdvance?: boolean;
    /** Desliga o D-pad do player à força (raro; o overlay do App já é tratado) */
    navEnabled?: boolean;
    /**
     * O player É o overlay do momento — caso da Busca Global, que abre o
     * player de dentro dela e desliga a própria navegação. Sem esta isenção o
     * player também se desligaria (a zona é 'overlay') e NINGUÉM escutaria as
     * teclas: nem seta, nem OK, nem Voltar.
     */
    isOverlayOwner?: boolean;
    /**
     * Contador de episódios emendados sozinhos (item 51). Precisa vir do PAI:
     * quem usa fila de episódios remonta o player a cada avanço (key por
     * episódio), e um contador interno voltaria a zero toda vez.
     */
    autoAdvanceCountRef?: React.MutableRefObject<number>;
    /** Variantes de qualidade (URLs diferentes) do canal ATUAL, se houver 2+. */
    qualityVariants?: Array<{ id: string; label: string; selected: boolean }>;
    /** Usuário escolheu uma variante no menu — troca de URL via o dono (LiveTV). */
    onSelectQualityVariant?: (id: string) => void;
    /**
     * Identidade pro OpenSubtitles. Ausente = grupo "OpenSubtitles" nunca
     * aparece no menu de legendas — é assim que TV ao vivo fica de fora sem
     * código extra lá.
     */
    subtitleQuery?: { title: string; year?: string; season?: number; episode?: number; imdbId?: string };
    /**
     * Pipeline da prévia já tocando (TV ao Vivo): o player assume o MESMO
     * <video> + hls.js — sem requisição nova, sem segunda conexão no provedor.
     * Lido só na montagem.
     */
    adopt?: LivePipeline | null;
    /** Há outra fonte pra tentar (sessão → URL normal → variante): troca já no travamento. */
    hasAlternativeSource?: boolean;
    /**
     * Momentos salvos do filme (lista secreta): 🟢 ou 📌 marca o instante,
     * CH+/CH− pulam entre eles, e eles aparecem como marcas na barra.
     */
    moments?: {
        list: number[];
        /** Miniatura por segundo do momento (a tira de momentos acima da barra) */
        thumbs?: Record<string, string>;
        onAdd: (t: number, thumb?: string) => void;
        onRemove: (t: number) => void;
        /**
         * Tira com a SEQUÊNCIA inteira (momentos de todos os filmes da lista,
         * em ordem). Sem ela, a tira mostra só os momentos deste vídeo.
         * Item de outro filme (doAtual=false) chama onEscolher em vez de seek.
         */
        sequencia?: MomentoDaFaixa[];
        onEscolher?: (item: MomentoDaFaixa) => void;
        /** Foco do controle chegou nesta miniatura (pré-carga de quem usa) */
        onFocar?: (item: MomentoDaFaixa) => void;
        /**
         * Tira de miniaturas visível. Controlado POR FORA (o SecretPlayer):
         * o player remonta a cada troca de filme e perderia a escolha.
         * Sem onAlternarTira, a tira fica sempre visível e o botão não aparece.
         */
        tiraVisivel?: boolean;
        onAlternarTira?: () => void;
        /**
         * Índice da sequência pra já abrir com o foco NA TIRA (lido só na
         * montagem): escolher momento de outro filme remonta o player, e o
         * foco voltava pro play — a pessoa perdia o lugar na lista.
         */
        focoInicial?: number | null;
    };
    /**
     * `crossorigin="anonymous"` no <video>: só com uma URL cujo servidor manda
     * CORS em TODOS os saltos (o SecretPlayer resolve o redirect antes). É o
     * que deixa capturar o quadro do momento sem "sujar" o canvas.
     */
    crossOrigin?: 'anonymous';
    /**
     * Começa EXATAMENTE aqui (segundos), ignorando a preferência de retomar e
     * o recuo de 5s do resume — é o "abrir no momento salvo".
     */
    startAt?: number | null;
}

// Control buttons: close, prev, play, next, options, channels, volume, sleep, aspect
type ControlButton = 'close' | 'prev' | 'play' | 'golive' | 'next' | 'momprev' | 'pin' | 'momnext' | 'strip' | 'options' | 'channels' | 'volume' | 'sleep' | 'aspect';
// 'seekbar' = barra de progresso focada (seek por D-pad, item 37)
type PlayerFocus = 'controls' | 'menu' | 'zap-list' | 'seekbar' | 'moments';

const SEM_FAIXA: MomentoDaFaixa[] = [];

/**
 * Onde o foco entra na tira: o último momento JÁ PASSADO deste filme; filme
 * sem momento, o primeiro item dele na sequência; nada dele, o 0.
 */
function indiceAtualNaFaixa(lista: MomentoDaFaixa[], t: number): number {
    let atual = lista.findIndex(m => m.doAtual);
    lista.forEach((m, i) => { if (m.doAtual && m.t <= t + TOLERANCIA_MOMENTO_S) atual = i; });
    return Math.max(0, atual);
}

export interface MomentoDaFaixa {
    /** Filme dono do momento */
    filmeId: string;
    titulo: string;
    t: number;
    thumb?: string;
    /** É do vídeo tocando agora (OK faz seek em vez de trocar de filme) */
    doAtual: boolean;
}
// Uma tela por vez; 'root' lista as seções (item 39/40/41/48)
type MenuId = 'root' | 'quality' | 'audio' | 'subs' | 'subsize';

interface MenuEntry {
    label: string;
    hint?: string;
    selected?: boolean;
    /** Só setado quando o menu mistura 2+ fontes lógicas (ex.: variante de canal + ABR). */
    group?: string;
    run: () => void;
}

const SLEEP_CHOICES = [null, 30, 60, 90] as const;
// Seek por D-pad (item 37): passo cresce enquanto a tecla é martelada
const SEEK_REPEAT_MS = 500;   // acima disso o contador de aceleração zera
const SEEK_COMMIT_MS = 450;   // pulos são acumulados e aplicados de uma vez
const SEEK_STEPS = [10, 30, 60];
// Retomar recuando um pouco reancora o contexto da cena (item 49)
const RESUME_REWIND_SECONDS = 5;
// Episódios emendados sem NENHUM toque no controle antes de perguntar (item 51)
const AUTO_EPISODE_LIMIT = 3;
const STILL_WATCHING_TIMEOUT_MS = 90000;
const DIGIT_TIMEOUT_MS = 1400;
const ZAP_WINDOW = 9; // linhas visíveis no overlay de zapping
// Zapar rápido (CH+/CH−) só troca o HLS de verdade depois de parado por
// isto — cada tecla nesse intervalo só troca a IMAGEM de preview, sem
// destruir/recriar o player a cada canal que a pessoa só passou de raspão.
const ZAP_SETTLE_MS = 550;

const STALL_LIMIT_MS = 12000; // watchdog: tempo parado antes de reconectar

// Mensagem acionável por causa (R1 item 45)
const CAUSE_MESSAGES: Record<string, string> = {
    notfound: 'Canal indisponível no provedor (404). Tente outra variante ou canal.',
    network: 'Falha de rede. Verifique a conexão da TV.',
    media: 'Falha ao decodificar o vídeo (codec não suportado?).',
    stall: 'O stream congelou.',
    connlimit: 'O provedor não liberou a conexão a tempo (limite de conexões da conta).',
    fatal: 'Erro no stream.',
};

// Segura o screensaver do sistema durante a reprodução (Tizen)
function holdSystemScreenSaver(hold: boolean): void {
    try {
        const webapis = (window as unknown as {
            webapis?: { appcommon?: {
                setScreenSaver: (state: number, ok?: () => void, err?: () => void) => void;
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
            } };
        }).webapis;
        const appcommon = webapis?.appcommon;
        if (!appcommon) return;
        const state = hold
            ? appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF
            : appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON;
        appcommon.setScreenSaver(state, undefined, undefined);
    } catch {
        // Fora do Tizen (dev no browser) — sem screensaver pra segurar
    }
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function epgProgressPct(program: EpgProgram): number {
    const total = program.end - program.start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((Date.now() - program.start) / total) * 100));
}

/** Relógio do modo rádio: a tela fica parada, então o horário é o conteúdo. */
function RadioClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, []);
    return (
        <div className="radio-clock">
            {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
        </div>
    );
}

/**
 * Quadro atual em JPEG pequeno (160px de largura, ~3 KB) pra miniatura do
 * momento. Vídeo de outra origem sem CORS "suja" o canvas e o toDataURL lança
 * — aí não tem miniatura e o momento é salvo mesmo assim.
 */
function capturarQuadro(video: HTMLVideoElement): string | undefined {
    try {
        if (!video.videoWidth || !video.videoHeight) return undefined;
        const largura = 160;
        const altura = Math.round(largura * video.videoHeight / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(video, 0, 0, largura, altura);
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch {
        return undefined;
    }
}

export function VideoPlayer({
    src,
    title,
    poster,
    onClose,
    isLive = false,
    autoPlay = false,
    resumeTime,
    onTimeUpdate,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    contentType = 'movie',
    liveEpg,
    channelList,
    currentChannelId,
    onSwitchChannel,
    contentKey,
    onStreamFailed,
    maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
    onRequestPauseLive,
    onStreamDegrading,
    liveSyncDuration,
    onLiveHealthy,
    isRadio = false,
    autoAdvanceCountRef,
    navEnabled = true,
    autoAdvance,
    isOverlayOwner = false,
    qualityVariants,
    onSelectQualityVariant,
    subtitleQuery,
    adopt,
    hasAlternativeSource = false,
    moments,
    startAt,
    crossOrigin,
}: VideoPlayerProps) {
    // Um overlay do App (o aviso de lembrete) toma as teclas mudando a zona
    // pra 'overlay'. Sem consultar isso aqui, o MESMO OK pausava o vídeo por
    // baixo do aviso e ainda trocava o "último canal" do usuário.
    const { focusZone: appFocusZone } = useFocusZone();

    const videoRef = useRef<HTMLVideoElement>(null);
    // Pipeline adotado (congelado na montagem). O <video> dele é colocado no
    // host no MESMO commit em que o React tira a prévia da tela — volta pro
    // documento antes do "stable state" em que o navegador pausaria um
    // elemento de mídia removido, então segue tocando sem engasgar.
    const [adopted] = useState<LivePipeline | null>(() => adopt ?? null);
    const hostRef = useRef<HTMLDivElement>(null);
    // No lugar: o <video> fica na prévia (montada e escondida) e só vira tela
    // cheia por CSS — mover derrubaria o pipeline no webOS (ver LivePipeline)
    const noLugar = !!adopted?.noLugar;
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!adopted || (!host && !noLugar)) return;
        if (!noLugar && host) host.appendChild(adopted.video);
        adopted.video.playsInline = true;
        videoRef.current = adopted.video;
        // Estacionado entre páginas (Home → TV ao Vivo) pode chegar pausado
        if (adopted.video.paused) adopted.video.play().catch(() => { });
    }, [adopted, noLugar]);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const resumeAppliedRef = useRef(false);
    const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const zapSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Canal-alvo do zap em andamento — base pro PRÓXIMO CH+/CH− durante a
    // janela de assentamento, já que currentChannelId (prop) só muda quando o
    // switch de verdade é commitado. Sem isto, zapar duas vezes rápido
    // recalculava a partir do canal REAL parado (ainda não trocou) e as duas
    // teclas apontavam pro mesmo canal em vez de avançar dois.
    const zapPreviewChannelRef = useRef<PlayerChannel | null>(null);

    const isLiveContent = isLive || contentType === 'live';
    const canZap = isLiveContent && !!channelList?.length && !!onSwitchChannel;

    // Video state
    // <video> adotado da prévia já chega TOCANDO: o 'playing'/'canplay' dele
    // disparou antes do player existir e não volta. Sem ler o estado real, o
    // spinner ficava pra sempre na tela (e o botão mostrava ▶ com o canal no ar).
    const [playing, setPlaying] = useState(() => !!adopt && !adopt.video.paused);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [loading, setLoading] = useState(() => !(adopt && adopt.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA));
    const [error, setError] = useState<string | null>(null);
    const [showControls, setShowControls] = useState(true);
    // Lido no listener de timeupdate (efeito de deps vazias)
    const showControlsRef = useRef(showControls);
    useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);

    // Focus management
    const [menu, setMenu] = useState<MenuId | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const [playerFocus, setPlayerFocus] = useState<PlayerFocus>(() => (moments?.focoInicial != null ? 'moments' : 'controls'));
    const [focusedControl, setFocusedControl] = useState<ControlButton>('play');
    // Miniatura focada na tira de momentos (playerFocus === 'moments')
    const [momentFocus, setMomentFocus] = useState(() => moments?.focoInicial ?? 0);
    const momentStripRef = useRef<HTMLDivElement>(null);
    // Miniatura focada sempre visível (a tira rola com até 50 momentos), e
    // avisa quem usa (o SecretPlayer pré-carrega o filme dela)
    useEffect(() => {
        if (playerFocus !== 'moments') return;
        const focada = faixaRef.current[momentFocus];
        if (focada) momentsRef.current?.onFocar?.(focada);
        const alvo = momentStripRef.current?.children[momentFocus] as HTMLElement | undefined;
        alvo?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, [playerFocus, momentFocus]);

    // Preferências persistidas do player (itens 41 e 48)
    const [subSize, setSubSize] = useState<SubtitleSize>(() => subtitleSizePref.get());
    const [showStats, setShowStats] = useState(() => statsOverlay.get());

    // Legendas por busca (OpenSubtitles) — busca preguiçosa, uma vez por instância
    // do player (MoviePlayer/SeriesQueuePlayer remontam por key a cada conteúdo)
    const [osResults, setOsResults] = useState<SubtitleResult[]>([]);
    const [osStatus, setOsStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
    const [osDownloadFailed, setOsDownloadFailed] = useState(false);
    const [activeTrack, setActiveTrack] = useState<{ blobUrl: string; label: string; lang: string } | null>(null);

    // Volume do elemento <video> (independente do volume de hardware da TV)
    const [volume, setVolume] = useState<number>(() => playerVolume.get().volume);
    const [muted, setMuted] = useState<boolean>(() => playerVolume.get().muted);
    // Mostra a barra em foco e por um instante depois de ajustar (sem :hover na TV)
    const [volumeActive, setVolumeActive] = useState(false);
    const volumeActiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
            videoRef.current.muted = muted;
        }
        playerVolume.set(volume, muted);
    }, [volume, muted]);

    const flashVolumeActive = useCallback(() => {
        setVolumeActive(true);
        if (volumeActiveTimeoutRef.current) clearTimeout(volumeActiveTimeoutRef.current);
        volumeActiveTimeoutRef.current = setTimeout(() => setVolumeActive(false), 1800);
    }, []);

    useEffect(() => () => {
        if (volumeActiveTimeoutRef.current) clearTimeout(volumeActiveTimeoutRef.current);
    }, []);

    const toggleMute = useCallback(() => {
        setMuted(prev => !prev);
        flashVolumeActive();
    }, [flashVolumeActive]);

    const adjustVolume = useCallback((delta: number) => {
        setVolume(prev => {
            const next = Math.max(0, Math.min(1, prev + delta));
            if (next > 0) setMuted(false);
            return next;
        });
        flashVolumeActive();
    }, [flashVolumeActive]);
    const [stats, setStats] = useState<{
        bitrate: number; width: number; height: number; dropped: number; buffer: number;
    } | null>(null);

    // Seek acelerado por D-pad (item 37): alvo em ref (o commit roda num
    // timeout e precisa do valor mais recente), display em estado
    const seekTargetRef = useRef<number | null>(null);
    const seekCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekAccelRef = useRef({ last: 0, count: 0 });
    const [seekDisplay, setSeekDisplay] = useState<{ target: number; step: number } | null>(null);

    // "Ainda está assistindo?" (item 51): conta episódios emendados sozinhos.
    // Qualquer interação com o controle zera a contagem — quem está ali
    // assistindo de verdade não precisa levar pergunta na cara.
    const localAutoAdvanceRef = useRef(0);
    const autoAdvanceRef = autoAdvanceCountRef ?? localAutoAdvanceRef;
    const [stillWatching, setStillWatching] = useState(false);

    // Zapping (live)
    const [digitBuffer, setDigitBuffer] = useState('');
    const [zapIndex, setZapIndex] = useState(0);
    // EPG do canal focado no overlay de zapping (item 6)
    const [zapEpg, setZapEpg] = useState<{ id: number; title: string } | null>(null);
    // Banner "onde eu caí": aparece por alguns segundos a cada troca de canal
    const [zapBanner, setZapBanner] = useState<{ num?: number; name: string } | null>(null);
    // Canal-alvo do CH+/CH− ainda não commitado — enquanto existir, só a
    // imagem troca (ver .zap-preview-stage); o HLS de verdade só troca
    // quando isto volta a null (ZAP_SETTLE_MS depois do último aperto)
    const [zapPreview, setZapPreview] = useState<PlayerChannel | null>(null);
    // Depois do commit, o mesmo palco (logo + nome do canal NOVO) fica até o
    // vídeo novo tocar: a troca leva 4–6 s, ou 8–30 s no limite de 1 conexão,
    // e antes era tela preta + "Aguardando o provedor…" (LG, 14/10/2026)
    const [zapCarregando, setZapCarregando] = useState<PlayerChannel | null>(null);
    useEffect(() => {
        if (playerFocus !== 'zap-list' || !channelList) return;
        const channel = channelList[zapIndex];
        if (!channel) return;
        let cancelled = false;
        const timeout = setTimeout(() => {
            epgService.getChannelEpg(channel.stream_id).then(epg => {
                if (!cancelled && epg.now) {
                    setZapEpg({ id: channel.stream_id, title: epg.now.title });
                }
            });
        }, 400); // debounce: busca quando o foco assenta
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [playerFocus, zapIndex, channelList]);

    // O banner some sozinho
    useEffect(() => {
        if (!zapBanner) return;
        const timeout = setTimeout(() => setZapBanner(null), 4000);
        return () => clearTimeout(timeout);
    }, [zapBanner]);

    // Aviso "a seguir" nos últimos 5 min do programa (item 9) — tick de 30s
    const [nextSoonTick, setNextSoonTick] = useState(0);
    useEffect(() => {
        if (!isLiveContent) return;
        const interval = setInterval(() => setNextSoonTick(t => t + 1), 30000);
        return () => clearInterval(interval);
    }, [isLiveContent]);
    void nextSoonTick;
    const nextSoon = isLiveContent && liveEpg?.now && liveEpg.next &&
        liveEpg.now.end - Date.now() > 0 && liveEpg.now.end - Date.now() < 5 * 60 * 1000
        ? liveEpg.next
        : null;

    // Sleep timer
    const [sleepChoiceIndex, setSleepChoiceIndex] = useState(0);
    const [sleepUntil, setSleepUntil] = useState<number | null>(null);
    const [sleepRemainingMin, setSleepRemainingMin] = useState<number | null>(null);

    // Proporção/zoom (lembrada por conteúdo quando contentKey existe)
    const [aspectMode, setAspectMode] = useState<AspectMode>(() =>
        contentKey ? aspectPrefs.get(contentKey) : 'original'
    );

    // O player fica MONTADO durante o zapping (só o src muda) — estados
    // derivados do conteúdo precisam resetar aqui, no render (padrão React
    // de ajuste durante render; effect com setState síncrono é proibido).
    const [lastSrc, setLastSrc] = useState(src);
    if (src !== lastSrc) {
        setLastSrc(src);
        if (canZap && title) setZapBanner({ num: channelList?.find(c => c.stream_id === currentChannelId)?.num, name: title });
        setError(null);
        setLoading(true);
        setDigitBuffer('');
        setAspectMode(contentKey ? aspectPrefs.get(contentKey) : 'original');
    }

    // Ref não pode ser escrita durante o render — resets por troca de src
    useEffect(() => {
        resumeAppliedRef.current = false;
        reconnectAttemptRef.current = 0;
        streamFailedRef.current = false;
        reloadResumeRef.current = null;
        resumeAfterReloadRef.current = false;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        setReconnectAttempt(0);
        setReconnecting(false);
        setIsBehindLive(false);
        setPausedLiveSrc(null);
    }, [src]);

    // Atrás do vivo? (pausou/atrasou num canal ao vivo → botão AO VIVO)
    const [isBehindLive, setIsBehindLive] = useState(false);
    // Pause live (item 8): URL de timeshift criada ao pausar o ao vivo
    const [pausedLiveSrc, setPausedLiveSrc] = useState<string | null>(null);
    // Espelho em ref: listeners de deps vazias precisam do valor atual
    const pausedLiveSrcRef = useRef<string | null>(null);
    useEffect(() => {
        pausedLiveSrcRef.current = pausedLiveSrc;
    }, [pausedLiveSrc]);

    // Reconexão com backoff (R1 itens 43/44/74): tentativa visível + watchdog
    const [reconnectAttempt, setReconnectAttempt] = useState(0);
    const [reconnecting, setReconnecting] = useState(false);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    // Espera pelo limite de conexões do provedor (ver scheduleReconnect)
    const connlimitSinceRef = useRef(0);
    const [waitingConnection, setWaitingConnection] = useState(false);
    // VOD: posição capturada antes do reload (o pipeline recomeça em 0)
    const reloadResumeRef = useRef<number | null>(null);
    // O reload veio de uma RECONEXÃO com o vídeo tocando? Então a volta tem
    // que voltar TOCANDO — mesmo dentro do pause-live, cujas duas defesas
    // (autoplay desligado + pausa no loadedmetadata) travariam o player.
    const resumeAfterReloadRef = useRef(false);
    // Terminal: tentativas esgotadas — watchdog para de re-agendar
    const streamFailedRef = useRef(false);

    // Enquanto pausado-no-vivo, a fonte é o timeshift daquele instante
    const effectiveSrc = pausedLiveSrc || src;

    // HLS hook with quality support
    const {
        hlsRef,
        handOff,
        cleanup,
        reload,
        qualityLevels,
        currentQualityIndex,
        setQuality,
        isAutoQuality,
        setAutoQuality,
        audioTracks,
        currentAudioTrack,
        setAudioTrack,
        subtitleTracks,
        currentSubtitleTrack,
        setSubtitleTrack
    } = useHls({
        src: effectiveSrc,
        videoRef,
        // Ao trocar pro timeshift da PAUSA o autoplay não pode disparar —
        // senão o vídeo volta a tocar sozinho e a pausa não acontece
        autoPlay: autoPlay && !pausedLiveSrc,
        isLive: isLive || contentType === 'live',
        onError: (cause) => setError(CAUSE_MESSAGES[cause || 'fatal']),
        onStreamError: (cause) => scheduleReconnect(cause || 'fatal'),
        adopt: adopted?.hls,
        adoptMovido: !noLugar,
        liveSyncDuration,
    });

    // Qualidade manual lembrada por conteúdo (item 46). Guardada por ALTURA:
    // o índice do nível muda entre variantes do mesmo canal.
    const qualityAppliedRef = useRef<string>('');
    useEffect(() => {
        // reload() (retry/watchdog/standby) zera os níveis sem trocar o src:
        // liberar a trava aqui é o que faz a preferência voltar depois dele
        if (qualityLevels.length === 0) {
            qualityAppliedRef.current = '';
            return;
        }
        if (qualityAppliedRef.current === effectiveSrc) return;
        qualityAppliedRef.current = effectiveSrc;
        const savedHeight = qualityByContent.get(contentKey);
        if (savedHeight == null) return;
        // O teto global ganha da preferência por canal: quem limitou a
        // qualidade fez isso por causa da rede, não por causa deste canal
        const cap = qualityCap.get();
        if (cap > 0 && savedHeight > cap) return;
        const match = qualityLevels.find(level => level.height === savedHeight);
        if (match) setQuality(match.index);
    }, [qualityLevels, effectiveSrc, contentKey, setQuality]);

    // Estatísticas do stream (item 48) — só roda com o overlay ligado
    useEffect(() => {
        if (!showStats) return;
        const interval = setInterval(() => {
            const video = videoRef.current;
            if (!video) return;
            const hls = hlsRef.current;
            const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
            const quality = typeof video.getVideoPlaybackQuality === 'function'
                ? video.getVideoPlaybackQuality()
                : null;
            const bufferEnd = video.buffered.length > 0
                ? video.buffered.end(video.buffered.length - 1)
                : video.currentTime;
            setStats({
                bitrate: level?.bitrate || 0,
                width: level?.width || video.videoWidth || 0,
                height: level?.height || video.videoHeight || 0,
                dropped: quality?.droppedVideoFrames ?? 0,
                buffer: Math.max(0, bufferEnd - video.currentTime),
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [showStats, hlsRef]);

    // Volta do standby / troca de fonte da TV (item 52): o pipeline do MSE
    // morre em silêncio enquanto a página fica escondida — o vídeo volta
    // congelado sem disparar nenhum erro. Re-inicializa se a ausência foi longa.
    useEffect(() => {
        let hiddenWhilePlaying = false;
        const handleVisibility = () => {
            if (document.hidden) {
                // PRIMEIRO: matar a reconexão pendente. O backoff vai até 16s
                // e dispara com a tela apagada; o reload() reconstrói o
                // pipeline e o MANIFEST_PARSED chama play(). A TV passaria a
                // noite baixando e segurando um slot de conexão da conta.
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = null;
                    setReconnecting(false);
                }
                const video = videoRef.current;
                hiddenWhilePlaying = !!video && !video.paused;
                // Só solta a conexão do que estava TOCANDO. Pausado já parou de
                // pedir fragmentos (o buffer encheu), não segura conexão do
                // provedor — e destruir o pipeline aqui deixaria o player MORTO
                // na volta rápida, porque não sobra nada pra retomar.
                if (!hiddenWhilePlaying || !video) return;
                // A posição do VOD é reaplicada no loadedmetadata do reload
                if (!isLiveContent && video.currentTime > 5) {
                    reloadResumeRef.current = video.currentTime;
                }
                video.pause();
                cleanup();
                // cleanup() destrói o pipeline do HLS — mas filme e episódio
                // são URL direta (.mp4/.mkv) e não passam por ele: sem soltar
                // o src, o <video> continua baixando em standby. A posição já
                // foi guardada acima e volta no loadedmetadata do reload.
                video.removeAttribute('src');
                video.load();
                return;
            }
            // Estava tocando → o pipeline foi destruído ao esconder, então a
            // volta SEMPRE reconstrói. Não existe mais janela de "voltou
            // rápido, aproveita o que está vivo": não ficou nada vivo.
            if (!hiddenWhilePlaying) return;
            hiddenWhilePlaying = false;
            reload();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [reload, isLiveContent, cleanup]);

    // onStreamFailed via ref: o watchdog roda num effect de deps vazias e não
    // pode capturar a closure do primeiro render (variantes do LiveTV mudam)
    const onStreamFailedRef = useRef(onStreamFailed);
    const maxReconnectAttemptsRef = useRef(maxReconnectAttempts);
    useEffect(() => {
        onStreamFailedRef.current = onStreamFailed;
        maxReconnectAttemptsRef.current = maxReconnectAttempts;
    }, [onStreamFailed, maxReconnectAttempts]);

    // Agenda uma reconexão com backoff exponencial; esgotou → erro + failover
    const scheduleReconnect = useCallback((cause: StreamErrorCause | 'stall') => {
        if (reconnectTimerRef.current || streamFailedRef.current) return; // já agendada / terminal
        // Limite de conexões: a conexão anterior ainda conta no painel por uns
        // 20s. Trocar de variante abriria OUTRA conexão (recusada igual) — o
        // certo é insistir na MESMA fonte a cada 3s até a velha cair.
        // A janela abre UMA vez por incidente (até voltar a tocar): sem isto,
        // cada recusa depois dela abria outra e o player alternava entre
        // "Aguardando…" e "Reconectando…" pra sempre, sem nunca desistir.
        if (cause === 'connlimit') {
            const agora = Date.now();
            if (!connlimitSinceRef.current) connlimitSinceRef.current = agora;
            if (agora - connlimitSinceRef.current < CONNLIMIT_WINDOW_MS) {
                setWaitingConnection(true);
                setReconnecting(true);
                setError(null);
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectTimerRef.current = null;
                    reload();
                }, 3000);
                return;
            }
            // Passou da janela: segue o fluxo normal (tentativas → erro/failover).
            // connlimitSinceRef só zera no `playing`.
            setWaitingConnection(false);
        }
        // 404/403 é o provedor dizendo que o canal não existe naquela URL —
        // repetir 4 vezes com backoff só gasta 30s antes de tentar a variante
        // seguinte, que é o que de fato pode funcionar.
        if (isTerminalCause(cause)) {
            streamFailedRef.current = true;
            videoRef.current?.pause();
            setReconnecting(false);
            // 403 depois de uma espera por limite de conexões é o mesmo
            // incidente — "canal indisponível (404)" mandaria a pessoa pro lado errado
            setError(connlimitSinceRef.current ? CAUSE_MESSAGES.connlimit : CAUSE_MESSAGES.notfound);
            onStreamFailedRef.current?.(connlimitSinceRef.current > 0);
            return;
        }
        const attempt = reconnectAttemptRef.current + 1;
        if (attempt > maxReconnectAttemptsRef.current) {
            streamFailedRef.current = true;
            videoRef.current?.pause();
            setReconnecting(false);
            setError(CAUSE_MESSAGES[cause] || CAUSE_MESSAGES.fatal);
            onStreamFailedRef.current?.(connlimitSinceRef.current > 0);
            return;
        }
        reconnectAttemptRef.current = attempt;
        setReconnectAttempt(attempt);
        setReconnecting(true);
        setError(null);
        const delayMs = reconnectDelayMs(attempt);
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            const video = videoRef.current;
            // Estava tocando? Então tem que voltar tocando. Sem isto, uma
            // reconexão dentro do pause-live parava para sempre em
            // "Reconectando… 1/4": o pipeline voltava mudo e nada mais
            // disparava, porque o reset só acontece no evento `playing`.
            resumeAfterReloadRef.current = !!video && !video.paused;
            // Guarda a posição pra reaplicar. Vale também pro timeshift da
            // pausa, que é ancorado no mesmo instante.
            if (video && video.currentTime > 5 && (!isLiveContent || pausedLiveSrcRef.current)) {
                reloadResumeRef.current = video.currentTime;
            }
            reload();
        }, delayMs);
    }, [reload, isLiveContent]);

    // Voltou a tocar → zera o ciclo de reconexão
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handlePlaying = () => {
            reconnectAttemptRef.current = 0;
            connlimitSinceRef.current = 0;
            setWaitingConnection(false);
            streamFailedRef.current = false;
            setReconnectAttempt(0);
            setReconnecting(false);
            // Voltou a tocar = não há mais erro. O hls.js se recupera sozinho
            // de falha de decodificação em 1-2s, e o aviso ficava na tela por
            // cima de um vídeo que estava funcionando.
            setError(null);
        };
        const handleLoadedMetadata = () => {
            // Posição do VOD capturada antes do reload do watchdog
            if (reloadResumeRef.current != null && video) {
                video.currentTime = reloadResumeRef.current;
                reloadResumeRef.current = null;
            }
            // Voltando de uma reconexão que estava TOCANDO: retoma. Este
            // ramo tem que vir ANTES da pausa do pause-live, senão o player
            // fica congelado com o overlay de "Reconectando" pra sempre.
            if (resumeAfterReloadRef.current && video) {
                resumeAfterReloadRef.current = false;
                video.play().catch(() => { });
                return;
            }
            // Cinto e suspensório do pause live: a fonte de pausa nunca
            // pode começar tocando (o usuário acabou de apertar pausa)
            if (pausedLiveSrcRef.current && video && !video.paused) {
                video.pause();
            }
        };
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        return () => {
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, []);

    // Rede voltou (evento do sistema) → tenta na hora
    useEffect(() => {
        const handleOnline = () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (reconnectAttemptRef.current > 0 || error) {
                setError(null);
                setReconnecting(true);
                reload();
            }
        };
        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
         
    }, [error, reload]);

    // Watchdog anti-travamento: tocando mas o relógio do vídeo não anda
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let lastTime = -1;
        let stalledSince = 0;
        const interval = setInterval(() => {
            if (!video) return;
            // AO VIVO: pausado ou >30s atrás do edge
            if (isLiveContent) {
                const edge = hlsRef.current?.liveSyncPosition;
                setIsBehindLive(video.paused || (typeof edge === 'number' && edge - video.currentTime > 30));
            }
            if (video.paused || video.ended) {
                stalledSince = 0;
                return;
            }
            // Ao vivo usa o watchdog de quadros/buffer abaixo
            if (isLiveContent) return;
            if (video.currentTime === lastTime) {
                if (stalledSince === 0) stalledSince = Date.now();
                else if (Date.now() - stalledSince >= STALL_LIMIT_MS && !reconnectTimerRef.current) {
                    stalledSince = 0;
                    scheduleReconnect('stall');
                }
            } else {
                stalledSince = 0;
            }
            lastTime = video.currentTime;
        }, 4000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scheduleReconnect, isLiveContent]);

    // Watchdog AO VIVO por quadros e buffer: o feed parou de entregar (ou
    // nunca subiu) → troca de fonte na hora se houver outra; senão reconecta.
    // Diferente do de cima, NÃO pula vídeo pausado: stream que nunca subiu
    // fica pausado pra sempre e era justamente o caso que ninguém pegava.
    const hasAlternativeRef = useRef(hasAlternativeSource);
    useEffect(() => { hasAlternativeRef.current = hasAlternativeSource; }, [hasAlternativeSource]);
    const onStreamDegradingRef = useRef(onStreamDegrading);
    useEffect(() => { onStreamDegradingRef.current = onStreamDegrading; }, [onStreamDegrading]);
    const onLiveHealthyRef = useRef(onLiveHealthy);
    useEffect(() => { onLiveHealthyRef.current = onLiveHealthy; }, [onLiveHealthy]);
    // Só a PRIMEIRA fonte é a adotada; troca de variante depois já é fonte nova
    const adotadoPendenteRef = useRef(adopted !== null && !noLugar);
    useEffect(() => {
        if (!isLiveContent) return;
        const video = videoRef.current;
        if (!video) return;
        // Fonte nova: o "desistiu" da anterior não vale pra esta
        streamFailedRef.current = false;
        // Pipeline assumido da prévia (webOS): o <video> movido refaz o
        // MediaSource e leva 6–16 s pra voltar a tocar (visto na LG,
        // 12/10/2026). Com os 10 s de partida o watchdog desistia no meio,
        // marcava falha no canal e reconectava com sessão NOVA — o painel de
        // 1 conexão recusava (403) e o player abria com erro. Agora: mais
        // prazo, e o 1º remédio é refazer o MediaSource na MESMA sessão.
        let adotado = adotadoPendenteRef.current;
        adotadoPendenteRef.current = false;
        let startedAt = Date.now() + (adotado ? LIVE_ADOPT_GRACE_MS : 0);
        let lastFrameAt = 0;
        let lastBufferGrowthAt = 0;
        let lastFrames = -1;
        let lastBufferEnd = -1;
        let avisouDegradando = false; // um aviso por fonte
        // Benchmark: 10s seguidos com quadro andando = fonte boa (uma vez por fonte).
        // Eram 60s (12/10/2026): a variante que o failover achava (CNN
        // Internacional, HD fora) quase nunca chegava lá antes de a pessoa
        // trocar de canal — sem acerto, a HD fora seguia ganhando pelo
        // histórico antigo e voltava como padrão. A prévia já conta no 1º quadro.
        let saudavelDesde = 0;
        let avisouSaudavel = false;
        const interval = setInterval(() => {
            const v = videoRef.current;
            if (!v) return;
            const now = Date.now();
            // Pausa do usuário (tem dado e está parado) ou timeshift da pausa:
            // não é travamento. Reconexão em andamento também não.
            if (pausedLiveSrcRef.current || reconnectTimerRef.current || streamFailedRef.current
                || (v.paused && v.readyState >= 3)) {
                lastFrameAt = lastBufferGrowthAt = now;
                return;
            }
            const quality = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
            const frames = quality ? quality.totalVideoFrames : Math.round(v.currentTime * 25);
            if (frames > lastFrames && lastFrames >= 0) lastFrameAt = now;
            lastFrames = frames;
            if (lastFrameAt && now - lastFrameAt < 3000) {
                if (!saudavelDesde) saudavelDesde = now;
                if (!avisouSaudavel && now - saudavelDesde >= 10000) {
                    avisouSaudavel = true;
                    onLiveHealthyRef.current?.();
                }
            } else {
                saudavelDesde = 0;
            }
            const bufferEnd = v.buffered.length > 0 ? v.buffered.end(v.buffered.length - 1) : 0;
            if (bufferEnd > lastBufferEnd && lastBufferEnd >= 0) lastBufferGrowthAt = now;
            lastBufferEnd = bufferEnd;
            // Painel recusando por limite de conexões: trocar/preparar outra
            // fonte só soma conexão numa conta já estourada — espera a velha cair
            const limiteAtivo = connlimitSinceRef.current > 0 && now - connlimitSinceRef.current < CONNLIMIT_WINDOW_MS;
            // Aviso antecipado: o buffer está secando e ainda toca — dá tempo
            // de abrir a outra fonte antes da imagem parar
            if (!avisouDegradando && !limiteAtivo && hasAlternativeRef.current && onStreamDegradingRef.current
                && liveBufferDying({ now, lastBufferGrowthAt, bufferAheadS: Math.max(0, bufferEnd - v.currentTime) })) {
                avisouDegradando = true;
                const atraso = hlsRef.current?.latency;
                onStreamDegradingRef.current(typeof atraso === 'number' && Number.isFinite(atraso) ? atraso : null, connlimitSinceRef.current > 0);
                return;
            }
            if (!liveFeedStalled({ now, startedAt, lastFrameAt, lastBufferGrowthAt })) return;
            // Recomeça a contagem: depois da reconexão, a mesma fonte ganha
            // outra janela inteira antes de ser julgada de novo
            startedAt = now;
            lastFrameAt = lastBufferGrowthAt = 0;
            lastFrames = lastBufferEnd = -1;
            if (adotado && hlsRef.current) {
                adotado = false;
                hlsRef.current.recoverMediaError();
                return;
            }
            if (limiteAtivo) {
                scheduleReconnect('connlimit');
            } else if (hasAlternativeRef.current && onStreamFailedRef.current) {
                streamFailedRef.current = true;
                onStreamFailedRef.current(connlimitSinceRef.current > 0);
            } else {
                scheduleReconnect('stall');
            }
        }, 1000);
        return () => clearInterval(interval);
        // effectiveSrc: fonte nova (troca/variante) reinicia a contagem
    }, [isLiveContent, effectiveSrc, scheduleReconnect, hlsRef]);

    // Limpa o timer de reconexão ao desmontar
    useEffect(() => {
        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };
    }, []);

    // Segura o screensaver do sistema enquanto o player existe (R1 item 77)
    useEffect(() => {
        holdSystemScreenSaver(true);
        // Marca pro CSS: o anti burn-in (item 78) escurece a interface parada,
        // mas não pode escurecer o que a pessoa está assistindo
        document.documentElement.dataset.playing = '1';
        return () => {
            holdSystemScreenSaver(false);
            delete document.documentElement.dataset.playing;
        };
    }, []);

    // Botão 🖼 da tira: só quando há o que mostrar (em algum filme da sequência)
    const temTira = !!moments?.onAlternarTira && (moments.sequencia?.length ?? moments.list.length) > 0;

    // Build list of available control buttons
    const getControlButtons = useCallback((): ControlButton[] => {
        const buttons: ControlButton[] = ['close'];
        if (canGoPrevious && onPreviousEpisode) buttons.push('prev');
        buttons.push('play');
        if (isLiveContent && isBehindLive) buttons.push('golive');
        if (canGoNext && onNextEpisode) buttons.push('next');
        // Botões de momento pra quem usa mouse (CH+/CH− só existem no controle/teclado)
        if (moments && moments.list.length > 0) buttons.push('momprev');
        if (moments) buttons.push('pin');
        if (moments && moments.list.length > 0) buttons.push('momnext');
        if (temTira) buttons.push('strip');
        // ⚙ sempre aparece: mesmo sem níveis de qualidade ele dá acesso a
        // áudio, legenda e estatísticas
        buttons.push('options');
        if (canZap) buttons.push('channels');
        buttons.push('volume');
        buttons.push('sleep');
        buttons.push('aspect');
        return buttons;
    }, [canGoPrevious, canGoNext, onPreviousEpisode, onNextEpisode, canZap, isLiveContent, isBehindLive, moments, temTira]);

    // ----- Zapping helpers (live) -----
    const currentChannelIndex = useMemo(() => {
        if (!channelList || currentChannelId == null) return -1;
        return channelList.findIndex(c => c.stream_id === currentChannelId);
    }, [channelList, currentChannelId]);

    const switchRelative = useCallback((delta: number) => {
        if (!canZap || !channelList || channelList.length === 0) return;
        // Base é o canal já pré-visualizado (se houver zap em andamento), não
        // o currentChannelIndex real — esse só muda quando o switch commita.
        const baseId = zapPreviewChannelRef.current?.stream_id;
        const baseIndex = baseId != null ? channelList.findIndex(c => c.stream_id === baseId) : -1;
        const base = baseIndex >= 0 ? baseIndex : (currentChannelIndex >= 0 ? currentChannelIndex : 0);
        const next = (base + delta + channelList.length) % channelList.length;
        const target = channelList[next];
        zapPreviewChannelRef.current = target;
        setZapPreview(target);
        if (zapSettleTimeoutRef.current) clearTimeout(zapSettleTimeoutRef.current);
        zapSettleTimeoutRef.current = setTimeout(() => {
            zapSettleTimeoutRef.current = null;
            zapPreviewChannelRef.current = null;
            setZapPreview(null);
            setZapCarregando(target);
            onSwitchChannel?.(target.stream_id);
        }, ZAP_SETTLE_MS);
    }, [canZap, channelList, currentChannelIndex, onSwitchChannel]);

    // Canal de verdade mudou (nosso commit acima ou outro caminho, tipo
    // digit-jump/overlay de zapping) — nenhuma pré-visualização pendente
    // continua fazendo sentido.
    useEffect(() => {
        if (zapSettleTimeoutRef.current) {
            clearTimeout(zapSettleTimeoutRef.current);
            zapSettleTimeoutRef.current = null;
        }
        zapPreviewChannelRef.current = null;
        setZapPreview(null);
    }, [currentChannelId]);

    // Palco do canal novo sai no primeiro `playing` depois do commit (ou no
    // erro; 30 s no máximo, pra nunca ficar preso por cima de um vídeo tocando)
    useEffect(() => {
        const v = videoRef.current;
        if (!zapCarregando || !v) return;
        const sair = () => setZapCarregando(null);
        v.addEventListener('playing', sair);
        v.addEventListener('error', sair);
        const limite = setTimeout(sair, 30000);
        return () => {
            v.removeEventListener('playing', sair);
            v.removeEventListener('error', sair);
            clearTimeout(limite);
        };
    }, [zapCarregando]);

    // Desmontagem com um zap em andamento não pode disparar onSwitchChannel
    // num componente que já não existe mais (o efeito acima só limpa quando
    // currentChannelId muda, não no unmount).
    useEffect(() => {
        return () => {
            if (zapSettleTimeoutRef.current) clearTimeout(zapSettleTimeoutRef.current);
        };
    }, []);

    // Digit-jump: número digitado vira canal após pequena pausa
    useEffect(() => {
        if (!digitBuffer) return;
        if (digitTimeoutRef.current) clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = setTimeout(() => {
            digitTimeoutRef.current = null;
            const num = Number(digitBuffer);
            setDigitBuffer('');
            // Coerção: muitos painéis Xtream mandam num como string no JSON
            const found = channelList?.find(c => Number(c.num) === num);
            if (found) onSwitchChannel?.(found.stream_id);
        }, DIGIT_TIMEOUT_MS);
        return () => {
            if (digitTimeoutRef.current) {
                clearTimeout(digitTimeoutRef.current);
                digitTimeoutRef.current = null;
            }
        };
    }, [digitBuffer, channelList, onSwitchChannel]);

    // Teclas extras do controle: CH+/CH− (427/428, PageUp/PageDown) e dígitos.
    // Só na camada de controles — com menu/overlay aberto, zapear por baixo
    // deixaria o foco dessas camadas apontando pro conteúdo errado.
    const playerFocusRef = useRef(playerFocus);
    useEffect(() => {
        playerFocusRef.current = playerFocus;
    }, [playerFocus]);

    // Auto-hide dos controles.
    //
    // Antes o timer só era armado quando chegava uma tecla — quem abria um
    // filme pela Home (o OK é consumido pela página) e largava o controle
    // assistia o filme inteiro com a barra e o título por cima da imagem,
    // queimando elementos estáticos num painel OLED. Agora um effect é o dono:
    // ele arma na montagem, a cada play/pause e a cada sinal de atividade.
    const [activityTick, setActivityTick] = useState(0);

    const resetHideControlsTimer = useCallback(() => {
        // Qualquer sinal de vida zera a contagem de episódios emendados
        autoAdvanceRef.current = 0;
        setShowControls(true);
        setActivityTick(tick => tick + 1);
    }, [autoAdvanceRef]);

    useEffect(() => {
        if (!showControls) return;
        const timeout = setTimeout(() => {
            // Esconder a barra (ou a tira de momentos) com ela FOCADA deixaria
            // o seek às cegas
            if (playing && !menu && playerFocusRef.current !== 'seekbar' && playerFocusRef.current !== 'moments') {
                setShowControls(false);
            }
        }, 3000);
        return () => clearTimeout(timeout);
    }, [showControls, playing, menu, activityTick]);
    useEffect(() => {
        if (!canZap) return;
        const handleExtraKeys = (event: KeyboardEvent) => {
            if (playerFocusRef.current !== 'controls') return;
            const key = event.key || String(event.keyCode);
            const code = event.keyCode;

            if (key === 'MediaChannelUp' || code === 427 || key === 'PageUp' || code === 33) {
                event.preventDefault();
                // Trocar de canal reexibe a barra: sem isso o usuário zapeava
                // sem nenhuma pista de onde tinha caído
                resetHideControlsTimer();
                switchRelative(-1);
            } else if (key === 'MediaChannelDown' || code === 428 || key === 'PageDown' || code === 34) {
                event.preventDefault();
                resetHideControlsTimer();
                switchRelative(1);
            } else if (/^[0-9]$/.test(key) || (code >= 48 && code <= 57) || (code >= 96 && code <= 105)) {
                event.preventDefault();
                const digit = /^[0-9]$/.test(key) ? key : String(code >= 96 ? code - 96 : code - 48);
                setDigitBuffer(prev => (prev + digit).slice(0, 4));
            }
        };
        window.addEventListener('keydown', handleExtraKeys);
        return () => window.removeEventListener('keydown', handleExtraKeys);
    }, [canZap, switchRelative, resetHideControlsTimer]);

    // ----- Sleep timer -----
    // O estado "remaining" é setado no handler (cycleSleep) e no callback do
    // interval — nunca no corpo do effect (regra react-hooks/set-state-in-effect).
    useEffect(() => {
        if (!sleepUntil) return;
        const interval = setInterval(() => {
            const remaining = sleepUntil - Date.now();
            if (remaining <= 0) {
                videoRef.current?.pause();
                setSleepUntil(null);
                setSleepChoiceIndex(0);
                setSleepRemainingMin(null);
            } else {
                setSleepRemainingMin(Math.ceil(remaining / 60000));
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [sleepUntil]);

    const cycleSleep = useCallback(() => {
        const nextIndex = (sleepChoiceIndex + 1) % SLEEP_CHOICES.length;
        setSleepChoiceIndex(nextIndex);
        const minutes = SLEEP_CHOICES[nextIndex];
        setSleepUntil(minutes ? Date.now() + minutes * 60000 : null);
        setSleepRemainingMin(minutes ?? null);
    }, [sleepChoiceIndex]);

    // ----- Proporção/zoom -----
    const cycleAspect = useCallback(() => {
        setAspectMode(prev => {
            const next = ASPECT_MODES[(ASPECT_MODES.indexOf(prev) + 1) % ASPECT_MODES.length];
            if (contentKey) aspectPrefs.set(contentKey, next);
            return next;
        });
    }, [contentKey]);

    // Voltar ao edge do ao vivo (R1 item 42)
    const seekToLive = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const edge = hlsRef.current?.liveSyncPosition;
        if (typeof edge === 'number' && Number.isFinite(edge)) {
            video.currentTime = edge;
        } else if (Number.isFinite(video.duration)) {
            video.currentTime = video.duration;
        }
        video.play().catch(() => { });
        setIsBehindLive(false);
        // Volta pro stream ao vivo de verdade (larga o timeshift da pausa)
        setPausedLiveSrc(null);
        // O botão golive some — foco não pode ficar órfão nele
        setFocusedControl(prev => (prev === 'golive' ? 'play' : prev));
    }, [hlsRef]);

    // ----- Overlay de zapping -----
    const openZapList = useCallback(() => {
        setPlayerFocus('zap-list');
        setZapIndex(currentChannelIndex >= 0 ? currentChannelIndex : 0);
    }, [currentChannelIndex]);

    const closeZapList = useCallback(() => {
        setPlayerFocus('controls');
    }, []);

    // Início exato (momento salvo): uma vez, assim que o vídeo tem metadado
    const startAppliedRef = useRef(false);
    useEffect(() => {
        const video = videoRef.current;
        if (startAt == null || !video || startAppliedRef.current) return;
        const apply = () => {
            if (startAppliedRef.current) return;
            startAppliedRef.current = true;
            video.currentTime = startAt;
        };
        if (video.readyState >= 1) apply();
        else video.addEventListener('loadedmetadata', apply, { once: true });
        return () => video.removeEventListener('loadedmetadata', apply);
    }, [startAt, src]);

    // Resume time - apply once when video is ready
    useEffect(() => {
        // "Retomar de onde parou" é opcional (item 66): quem prefere sempre
        // do começo não quer ser jogado no meio do filme
        if (!playbackPrefs.get().resume) return;
        if (!resumeTime || !videoRef.current || resumeAppliedRef.current) return;

        const video = videoRef.current;

        const applyResumeTime = () => {
            if (video && resumeTime && !resumeAppliedRef.current) {
                // Recuar alguns segundos reancora a cena (item 49)
                const target = Math.max(0, resumeTime - RESUME_REWIND_SECONDS);
                if (Math.abs(video.currentTime - target) > 5) {
                    video.currentTime = target;
                }
                resumeAppliedRef.current = true;
            }
        };

        if (video.readyState >= 2) {
            applyResumeTime();
        } else {
            video.addEventListener('loadedmetadata', applyResumeTime, { once: true });
        }

        return () => video.removeEventListener('loadedmetadata', applyResumeTime);
    }, [resumeTime, src]);

    // Time update callback for progress tracking
    useEffect(() => {
        if (!onTimeUpdate || !videoRef.current) return;

        const video = videoRef.current;
        let lastReportedTime = 0;

        const handleTimeUpdate = () => {
            if (Math.abs(video.currentTime - lastReportedTime) >= 5) {
                onTimeUpdate(video.currentTime, video.duration || 0);
                lastReportedTime = video.currentTime;
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate]);

    // Fim do vídeo = assistido (item 50). Sem isso, o último timeupdate podia
    // ficar 5s antes do fim e o título nunca saía de "Continuar assistindo".
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !onTimeUpdate) return;
        const handleEnded = () => {
            const total = video.duration || 0;
            if (total > 0) onTimeUpdate(total, total);
        };
        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onTimeUpdate]);

    // Auto go to next episode when video ends
    useEffect(() => {
        if (!videoRef.current || !onNextEpisode || !canGoNext) return;

        const video = videoRef.current;
        const handleEnded = () => {
            // Emendar o próximo é opcional (item 66); o botão ⏭ continua valendo.
            // Lido AQUI (não no render) pra não ler localStorage durante o render.
            const emendar = autoAdvance ?? playbackPrefs.get().autoNextEpisode;
            if (!emendar) return;
            autoAdvanceRef.current += 1;
            if (autoAdvanceRef.current >= AUTO_EPISODE_LIMIT) {
                // Não emenda: pergunta e para de consumir banda até responder
                setStillWatching(true);
                return;
            }
            onNextEpisode();
        };

        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onNextEpisode, canGoNext, autoAdvanceRef, autoAdvance]);

    // Sem resposta = a TV ficou ligada sozinha: fecha o player
    useEffect(() => {
        if (!stillWatching) return;
        const timeout = setTimeout(() => handleCloseRef.current?.(), STILL_WATCHING_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, [stillWatching]);

    // Cleanup on unmount — adiado um tique: o StrictMode do dev desmonta e
    // remonta na hora, e zerar o src aqui mataria o MediaSource do pipeline
    // adotado da prévia (que não tem como ser recriado sem conexão nova).
    // Remontou → cancela. Desmontou de verdade → limpa.
    const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // <video> devolvido pra prévia ao fechar: a desmontagem não pode zerá-lo
    const devolvidoRef = useRef(false);
    useEffect(() => {
        if (teardownTimerRef.current) {
            clearTimeout(teardownTimerRef.current);
            teardownTimerRef.current = null;
        }
        const video = videoRef.current;
        return () => {
            teardownTimerRef.current = setTimeout(() => {
                teardownTimerRef.current = null;
                cleanup();
                if (video && !devolvidoRef.current) {
                    video.pause();
                    video.src = '';
                    video.load();
                }
            }, 0);
        };
    }, [cleanup]);

    // handleClose é declarado depois; o timeout do "ainda está assistindo"
    // precisa da versão mais recente sem virar dependência circular
    const handleCloseRef = useRef<(() => void) | null>(null);


    // Video event handlers
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handlePlay = () => setPlaying(true);
        const handlePause = () => setPlaying(false);
        // Performance na TV: timeupdate dispara ~4×/s e cada setState re-renderiza
        // o player INTEIRO. currentTime só serve à tela (relógio, barra, momento
        // perto): em segundos inteiros o React pula o render repetido, e com os
        // controles escondidos nem atualiza — volta em ≤250ms quando aparecem.
        // Quem precisa do instante exato lê videoRef.current.currentTime.
        const handleTimeUpdateLocal = () => {
            if (!showControlsRef.current) return;
            setCurrentTime(Math.floor(video.currentTime));
        };
        // Stream sem duração conhecida chega como Infinity: deixar isso passar
        // habilitava a barra de seek com ←→ que não faziam nada
        const handleDurationChange = () =>
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
        // Mesmo motivo do timeupdate: 'progress' dispara várias vezes por
        // segundo baixando, e o buffer só aparece na barra (com controles)
        const handleProgress = () => {
            if (!showControlsRef.current || video.buffered.length === 0) return;
            setBuffered(Math.floor(video.buffered.end(video.buffered.length - 1)));
        };
        const handleWaiting = () => setLoading(true);
        // Tocando de novo: qualquer erro na tela já passou
        const handlePlaying = () => { setLoading(false); setError(null); };
        const handleCanPlay = () => setLoading(false);
        // webOS: o <video> assumido da prévia, ao refazer o MediaSource
        // (recoverMediaError), dispara 'error' SEM erro (video.error null) e
        // volta a tocar em seguida — mostrava "Erro ao reproduzir" à toa.
        const handleError = () => { if (video.error) setError('Erro ao reproduzir vídeo'); };

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdateLocal);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('progress', handleProgress);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('error', handleError);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdateLocal);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('progress', handleProgress);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('error', handleError);
        };
    }, []);

    // Mouse move handler for controls (dev no navegador; a TV não tem mouse)
    useEffect(() => {
        const handleMouseMove = () => resetHideControlsTimer();
        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, [resetHideControlsTimer]);

    // Close handler
    const handleClose = useCallback(() => {
        if (onTimeUpdate && videoRef.current) {
            onTimeUpdate(videoRef.current.currentTime, videoRef.current.duration || 0);
        }
        // Veio da prévia (adopt) e ainda está no ar: devolve o pipeline TOCANDO
        // em vez de matar — Voltar não derruba o canal nem abre outra conexão.
        // Pausado no timeshift não volta: a fonte ali não é mais o ao vivo.
        const video = videoRef.current;
        if (adopted && video && isLiveContent && !pausedLiveSrc && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            const hls = handOff();
            if (hls) {
                devolvidoRef.current = true;
                video.querySelectorAll('track').forEach(t => t.remove());
                onClose?.({ video, hls });
                return;
            }
        }
        cleanup();
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        onClose?.();
    }, [cleanup, onClose, onTimeUpdate, adopted, isLiveContent, pausedLiveSrc, handOff]);

    useEffect(() => {
        handleCloseRef.current = handleClose;
    }, [handleClose]);

    /** Confirma que ainda há alguém assistindo e emenda o próximo episódio. */
    const confirmStillWatching = useCallback(() => {
        autoAdvanceRef.current = 0;
        setStillWatching(false);
        onNextEpisode?.();
    }, [onNextEpisode, autoAdvanceRef]);

    // Controls
    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            // .catch obrigatório: play() rejeita com AbortError quando um
            // load()/troca de src acontece perto — e uma rejeição solta aqui
            // acorda o overlay de erro do boot por cima do app inteiro
            video.play().catch(() => { });
            return;
        }
        video.pause();
        // Canal ao vivo com catch-up: troca pro timeshift do instante da
        // pausa, então retomar continua de onde parou (item 8)
        if (isLiveContent && !pausedLiveSrc && onRequestPauseLive) {
            const url = onRequestPauseLive(Date.now());
            if (url) {
                // Uma reconexão pendente pode ter armado a retomada: entrar na
                // pausa AGORA vence, senão o vídeo voltava a tocar sozinho
                resumeAfterReloadRef.current = false;
                setPausedLiveSrc(url);
                setIsBehindLive(true);
            }
        }
         
    }, [isLiveContent, pausedLiveSrc, onRequestPauseLive]);

    const videoClassName = `video-element aspect-${aspectMode} sub-${subSize} ${isRadio ? 'radio-hidden' : ''}`;

    // <video> adotado não passa pelo JSX: espelha nele o que o JSX faria
    const togglePlayRef = useRef(togglePlay);
    useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);
    useLayoutEffect(() => {
        if (!adopted) return;
        const video = adopted.video;
        video.className = noLugar ? `${videoClassName} video-no-lugar` : videoClassName;
        if (isRadio || !poster) video.removeAttribute('poster');
        else video.poster = poster;
    }, [adopted, noLugar, videoClassName, isRadio, poster]);
    useLayoutEffect(() => (noLugar && adopted ? elevarQuadro(adopted.video) : undefined), [adopted, noLugar]);
    useEffect(() => {
        if (!adopted) return;
        const onClick = () => togglePlayRef.current();
        adopted.video.addEventListener('click', onClick);
        return () => adopted.video.removeEventListener('click', onClick);
    }, [adopted]);
    useEffect(() => {
        if (!adopted) return;
        const video = adopted.video;
        video.querySelectorAll('track').forEach(t => t.remove());
        if (!activeTrack) return;
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = activeTrack.blobUrl;
        track.srclang = activeTrack.lang || 'und';
        track.label = activeTrack.label;
        track.default = true;
        video.appendChild(track);
        // Faixa inserida depois do load não liga sozinha como o `default` do JSX
        track.track.mode = 'showing';
    }, [adopted, activeTrack]);

    const seek = useCallback((time: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
        }
    }, []);

    // ----- Momentos (lista secreta) -----
    const [momentToast, setMomentToast] = useState<{ text: string; img?: string } | null>(null);
    const momentToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashMoment = useCallback((text: string, img?: string) => {
        setMomentToast({ text, img });
        if (momentToastTimerRef.current) clearTimeout(momentToastTimerRef.current);
        momentToastTimerRef.current = setTimeout(() => setMomentToast(null), 2200);
    }, []);
    useEffect(() => () => {
        if (momentToastTimerRef.current) clearTimeout(momentToastTimerRef.current);
    }, []);
    const momentsRef = useRef(moments);
    useEffect(() => { momentsRef.current = moments; }, [moments]);
    // O que a tira mostra: a sequência da lista inteira, ou só este vídeo
    const faixaCompleta = useMemo<MomentoDaFaixa[]>(() => {
        if (!moments) return [];
        if (moments.sequencia) return moments.sequencia;
        return moments.list.map(t => ({ filmeId: '', titulo: title ?? '', t, thumb: moments.thumbs?.[String(t)], doAtual: true }));
    }, [moments, title]);
    const faixa = moments?.onAlternarTira && !moments.tiraVisivel ? SEM_FAIXA : faixaCompleta;
    const faixaRef = useRef(faixa);
    useEffect(() => { faixaRef.current = faixa; }, [faixa]);
    // 🖼 ligando: o foco já entra na tira, no momento atual (sem ↓↑↑ até ela)
    const alternarTira = useCallback(() => {
        const m = momentsRef.current;
        if (!m?.onAlternarTira) return;
        const ligando = !m.tiraVisivel;
        m.onAlternarTira();
        if (ligando && faixaCompleta.length > 0) {
            setMomentFocus(indiceAtualNaFaixa(faixaCompleta, videoRef.current?.currentTime ?? 0));
            setPlayerFocus('moments');
        }
    }, [faixaCompleta]);

    // 📌/🟢 é liga-desliga: em cima de um momento salvo (±3s) remove ele;
    // fora disso marca um novo
    const pinMoment = useCallback(() => {
        const video = videoRef.current;
        const m = momentsRef.current;
        if (!video || !m) return;
        const t = video.currentTime;
        const existente = m.list.find(x => Math.abs(x - t) <= TOLERANCIA_MOMENTO_S);
        if (existente != null) {
            m.onRemove(existente);
            flashMoment(`Momento removido ${formatTime(existente)}`);
            return;
        }
        const thumb = capturarQuadro(video);
        m.onAdd(t, thumb);
        flashMoment(`📌 Momento salvo ${formatTime(t)}`, thumb);
    }, [flashMoment]);
    // Em cima de um momento? O botão 📌 vira "remover"
    const noMomento = !!moments && moments.list.some(x => Math.abs(x - currentTime) <= TOLERANCIA_MOMENTO_S);

    const jumpMoment = useCallback((direction: 1 | -1) => {
        const video = videoRef.current;
        const list = momentsRef.current?.list ?? [];
        if (!video) return;
        if (list.length === 0) {
            flashMoment('Nenhum momento salvo — 🟢 marca o instante');
            return;
        }
        const alvo = direction > 0 ? nextMoment(list, video.currentTime) : prevMoment(list, video.currentTime);
        if (alvo == null) {
            flashMoment(direction > 0 ? 'Último momento' : 'Primeiro momento');
            return;
        }
        video.currentTime = alvo;
        flashMoment(`Momento ${list.indexOf(alvo) + 1}/${list.length} — ${formatTime(alvo)}`);
    }, [flashMoment]);

    // CH+/CH− pulam entre momentos. Efeito próprio: o de zapping só existe
    // com canZap (ao vivo), e filme nunca zapeia.
    useEffect(() => {
        if (!moments || canZap) return;
        const handleMomentKeys = (event: KeyboardEvent) => {
            const key = event.key || String(event.keyCode);
            const code = event.keyCode;
            if (key === 'MediaChannelUp' || code === 427 || key === 'PageUp' || code === 33) {
                event.preventDefault();
                jumpMoment(1);
            } else if (key === 'MediaChannelDown' || code === 428 || key === 'PageDown' || code === 34) {
                event.preventDefault();
                jumpMoment(-1);
            }
        };
        window.addEventListener('keydown', handleMomentKeys);
        return () => window.removeEventListener('keydown', handleMomentKeys);
    }, [moments, canZap, jumpMoment]);

    // Aplica de uma vez o pulo acumulado. Cada tecla mexer no currentTime
    // faria o HLS re-buscar segmento a segmento e travar a TV.
    const commitSeek = useCallback(() => {
        const video = videoRef.current;
        const target = seekTargetRef.current;
        seekTargetRef.current = null;
        if (seekCommitRef.current) {
            clearTimeout(seekCommitRef.current);
            seekCommitRef.current = null;
        }
        setSeekDisplay(null);
        if (video && target != null) {
            video.currentTime = target;
        }
    }, []);

    /** Um passo de seek; martelar a tecla acelera 10s → 30s → 1min (item 37). */
    const nudgeSeek = useCallback((direction: -1 | 1) => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        const now = Date.now();
        const accel = seekAccelRef.current;
        accel.count = now - accel.last < SEEK_REPEAT_MS ? accel.count + 1 : 1;
        accel.last = now;
        const step = accel.count > 10 ? SEEK_STEPS[2] : accel.count > 4 ? SEEK_STEPS[1] : SEEK_STEPS[0];
        const base = seekTargetRef.current ?? video.currentTime;
        const target = Math.max(0, Math.min(video.duration, base + direction * step));
        seekTargetRef.current = target;
        setSeekDisplay({ target, step });
        if (seekCommitRef.current) clearTimeout(seekCommitRef.current);
        seekCommitRef.current = setTimeout(commitSeek, SEEK_COMMIT_MS);
    }, [commitSeek]);

    // Sair do player no meio de um seek deixaria o timeout pendente
    useEffect(() => {
        return () => {
            if (seekCommitRef.current) clearTimeout(seekCommitRef.current);
        };
    }, []);

    // Teclas de mídia do controle (item 38). Registradas no boot do App via
    // tvinputdevice; sem este listener elas não faziam nada no player.
    useEffect(() => {
        const handleMediaKeys = (event: KeyboardEvent) => {
            const video = videoRef.current;
            if (!video) return;
            const key = event.key || '';
            const code = event.keyCode;

            if (key === 'MediaPlayPause' || code === 10252) {
                event.preventDefault();
                togglePlay();
            } else if (key === 'MediaPlay' || code === 415) {
                event.preventDefault();
                if (video.paused) togglePlay();
            } else if (key === 'MediaPause' || code === 19) {
                event.preventDefault();
                if (!video.paused) togglePlay();
            } else if (key === 'MediaStop' || code === 413) {
                event.preventDefault();
                handleClose();
            } else if (key === 'MediaRewind' || code === 412) {
                event.preventDefault();
                if (!isLiveContent) nudgeSeek(-1);
            } else if (key === 'MediaFastForward' || code === 417) {
                event.preventDefault();
                if (!isLiveContent) nudgeSeek(1);
            } else if (key === 'MediaTrackNext' || code === 10233) {
                event.preventDefault();
                if (canGoNext) onNextEpisode?.();
            } else if (key === 'MediaTrackPrevious' || code === 10232) {
                event.preventDefault();
                if (canGoPrevious) onPreviousEpisode?.();
            } else if (key === 'ColorF0Red' || code === 403) {
                // 🔴 volta ao canal ANTERIOR. O histórico de zapping já era
                // gravado desde a R4 e nunca tinha sido lido por ninguém.
                // Só na camada de controles: com o menu ⚙, a lista 📺 ou um
                // aviso por cima, trocar de canal por baixo bagunçaria o foco
                // dessas camadas.
                if (!canZap) return;
                if (playerFocusRef.current !== 'controls') return;
                if (appFocusZone === 'overlay' && !isOverlayOwner) return;
                const anterior = zapHistory.previous();
                if (anterior != null && anterior !== currentChannelId) {
                    event.preventDefault();
                    resetHideControlsTimer();
                    onSwitchChannel?.(anterior);
                }
            }
        };
        window.addEventListener('keydown', handleMediaKeys);
        return () => window.removeEventListener('keydown', handleMediaKeys);
    }, [togglePlay, handleClose, nudgeSeek, isLiveContent, canGoNext, canGoPrevious,
        onNextEpisode, onPreviousEpisode, canZap, currentChannelId, onSwitchChannel,
        resetHideControlsTimer, appFocusZone, isOverlayOwner]);

    // ----- Menu de opções (qualidade / áudio / legenda / stats) -----
    const openMenu = useCallback((id: MenuId) => {
        setMenu(id);
        setMenuIndex(0);
        setPlayerFocus('menu');
        // Busca preguiçosa: só na primeira vez que o menu de legendas abre,
        // e só quando há identidade de conteúdo pra buscar (VOD, não ao vivo)
        if (id === 'subs' && subtitleQuery && osStatus === 'idle') {
            setOsStatus('loading');
            searchSubtitles({ ...subtitleQuery, languages: storage.getSubtitleLanguage() })
                .then(results => { setOsResults(results); setOsStatus('done'); })
                .catch(() => setOsStatus('error'));
        }
    }, [subtitleQuery, osStatus]);

    const closeMenu = useCallback(() => {
        setMenu(null);
        setPlayerFocus('controls');
    }, []);

    const deactivateOsTrack = useCallback(() => {
        setActiveTrack(prev => {
            if (prev) URL.revokeObjectURL(prev.blobUrl);
            return null;
        });
    }, []);

    const selectOpenSubtitle = useCallback(async (result: SubtitleResult) => {
        setOsDownloadFailed(false);
        const resolved = await resolveSubtitleTrack(result.fileId);
        if (!resolved) {
            setOsDownloadFailed(true);
            return;
        }
        setActiveTrack(prev => {
            if (prev) URL.revokeObjectURL(prev.blobUrl);
            const blobUrl = URL.createObjectURL(new Blob([resolved.vtt], { type: 'text/vtt' }));
            return { blobUrl, label: result.release, lang: result.lang };
        });
        setSubtitleTrack(-1); // desliga legenda embutida — mutuamente exclusivo
        closeMenu();
    }, [setSubtitleTrack, closeMenu]);

    // Limpa o blob URL ativo quando o player desmonta (troca de conteúdo, fechar)
    useEffect(() => () => {
        setActiveTrack(prev => {
            if (prev) URL.revokeObjectURL(prev.blobUrl);
            return prev;
        });
    }, []);

    // Um <track> recém-adicionado nem sempre respeita o atributo `default` em
    // browsers de TV — força o modo explicitamente, e desliga qualquer outro
    // TextTrack pra manter só uma legenda visível por vez.
    useEffect(() => {
        if (!videoRef.current) return;
        const tracks = videoRef.current.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = activeTrack && tracks[i].label === activeTrack.label ? 'showing' : 'disabled';
        }
    }, [activeTrack]);

    const selectQuality = useCallback((index: number) => {
        if (index === -1) {
            setAutoQuality();
            qualityByContent.set(contentKey, null);
        } else {
            setQuality(index);
            // Lembra por ALTURA pra sobreviver à troca de variante (item 46)
            const level = qualityLevels.find(entry => entry.index === index);
            if (level) qualityByContent.set(contentKey, level.height);
        }
        closeMenu();
    }, [setQuality, setAutoQuality, closeMenu, contentKey, qualityLevels]);

    const toggleStats = useCallback(() => {
        setShowStats(prev => {
            statsOverlay.set(!prev);
            return !prev;
        });
    }, []);

    const currentAudioLabel = audioTracks.find(track => track.id === currentAudioTrack)?.label || '—';
    const currentSubLabel = activeTrack
        ? activeTrack.label
        : currentSubtitleTrack >= 0
        ? (subtitleTracks.find(track => track.id === currentSubtitleTrack)?.label || 'Ligada')
        : 'Desligadas';

    // Itens do menu aberto. A raiz só mostra o que o stream realmente oferece —
    // linha morta em menu de TV é pior que ausência.
    const menuEntries = useMemo<MenuEntry[]>(() => {
        if (menu === 'root') {
            const entries: MenuEntry[] = [];
            // Canal sem .m3u8 (URL .ts crua, comum em provedor Xtream) nunca
            // popula qualityLevels — sem o OR abaixo, HD/FHD/H265 (que vêm de
            // qualityVariants, trocando a URL do canal, não o ABR do HLS.js)
            // ficavam inalcançáveis mesmo estando corretos e populados.
            if (qualityLevels.length > 0 || (qualityVariants && qualityVariants.length > 0)) {
                entries.push({
                    label: 'Qualidade',
                    hint: qualityLevels.length > 0
                        ? (isAutoQuality ? 'Auto' : (qualityLevels.find(l => l.index === currentQualityIndex)?.label || 'Auto'))
                        : qualityVariants?.find(v => v.selected)?.label,
                    run: () => openMenu('quality'),
                });
            }
            if (audioTracks.length > 1) {
                entries.push({ label: 'Áudio', hint: currentAudioLabel, run: () => openMenu('audio') });
            }
            if (subtitleTracks.length > 0 || subtitleQuery) {
                entries.push({ label: 'Legendas', hint: currentSubLabel, run: () => openMenu('subs') });
            }
            if (subtitleTracks.length > 0 || activeTrack) {
                entries.push({
                    label: 'Tamanho da legenda',
                    hint: SUBTITLE_SIZE_LABELS[subSize],
                    run: () => openMenu('subsize'),
                });
            }
            entries.push({
                label: 'Estatísticas do stream',
                hint: showStats ? 'Ligadas' : 'Desligadas',
                run: toggleStats,
            });
            return entries;
        }
        if (menu === 'quality') {
            const hasVariants = !!qualityVariants && qualityVariants.length > 0;
            const variantEntries: MenuEntry[] = hasVariants
                ? qualityVariants!.map(v => ({
                      label: v.label,
                      selected: v.selected,
                      group: 'Fonte do canal',
                      run: () => { onSelectQualityVariant?.(v.id); closeMenu(); },
                  }))
                : [];
            // Sem níveis ABR (HLS.js nem rodou — URL .ts crua), não faz
            // sentido oferecer "Auto"/bitrate: só as variantes de URL entram.
            const abrEntries: MenuEntry[] = qualityLevels.length === 0 ? [] : [
                {
                    label: 'Auto',
                    hint: isAutoQuality && currentQualityIndex >= 0
                        ? qualityLevels.find(l => l.index === currentQualityIndex)?.label
                        : undefined,
                    selected: isAutoQuality,
                    group: hasVariants ? 'Resolução' : undefined,
                    run: () => selectQuality(-1),
                },
                ...qualityLevels.map(level => ({
                    label: level.label,
                    hint: `${Math.round(level.bitrate / 1000)} kbps`,
                    selected: !isAutoQuality && currentQualityIndex === level.index,
                    group: hasVariants ? 'Resolução' : undefined,
                    run: () => selectQuality(level.index),
                })),
            ];
            return [...variantEntries, ...abrEntries];
        }
        if (menu === 'audio') {
            return audioTracks.map(track => ({
                label: track.label,
                hint: track.lang,
                selected: track.id === currentAudioTrack,
                run: () => { setAudioTrack(track.id); closeMenu(); },
            }));
        }
        if (menu === 'subs') {
            const hasOs = !!subtitleQuery;
            const embeddedEntries: MenuEntry[] = [
                {
                    label: 'Desligadas',
                    selected: currentSubtitleTrack < 0 && !activeTrack,
                    group: hasOs && subtitleTracks.length > 0 ? 'Embutidas' : undefined,
                    run: () => { setSubtitleTrack(-1); deactivateOsTrack(); closeMenu(); },
                },
                ...subtitleTracks.map(track => ({
                    label: track.label,
                    hint: track.lang,
                    selected: track.id === currentSubtitleTrack && !activeTrack,
                    group: hasOs ? 'Embutidas' : undefined,
                    run: () => { deactivateOsTrack(); setSubtitleTrack(track.id); closeMenu(); },
                })),
            ];
            if (!hasOs) return embeddedEntries;

            const osEntries: MenuEntry[] = osStatus === 'loading'
                ? [{ label: 'Buscando…', group: 'OpenSubtitles', run: () => {} }]
                : osStatus === 'error'
                ? [{ label: 'Falha ao buscar legendas', group: 'OpenSubtitles', run: () => {} }]
                : osStatus === 'done' && osResults.length === 0
                ? [{ label: 'Nenhuma legenda encontrada', group: 'OpenSubtitles', run: () => {} }]
                : osResults.map(result => ({
                      label: result.release,
                      hint: result.lang,
                      selected: activeTrack?.label === result.release,
                      group: 'OpenSubtitles',
                      run: () => { selectOpenSubtitle(result); },
                  }));
            if (osDownloadFailed) {
                osEntries.push({ label: 'Falha ao baixar — tente outra', group: 'OpenSubtitles', run: () => {} });
            }
            return [...embeddedEntries, ...osEntries];
        }
        if (menu === 'subsize') {
            return SUBTITLE_SIZES.map(size => ({
                label: SUBTITLE_SIZE_LABELS[size],
                selected: size === subSize,
                run: () => {
                    subtitleSizePref.set(size);
                    setSubSize(size);
                    closeMenu();
                },
            }));
        }
        return [];
    }, [menu, qualityLevels, isAutoQuality, currentQualityIndex, audioTracks, currentAudioTrack,
        subtitleTracks, currentSubtitleTrack, subSize, showStats, currentAudioLabel, currentSubLabel,
        openMenu, selectQuality, setAudioTrack, setSubtitleTrack, closeMenu, toggleStats,
        qualityVariants, onSelectQualityVariant, subtitleQuery, osStatus, osResults, osDownloadFailed,
        activeTrack, deactivateOsTrack, selectOpenSubtitle]);

    // As listas vêm do useHls, que as ESVAZIA em todo reload() (retry,
    // watchdog de travamento, volta do standby) — não só na troca de canal.
    // Sem isto, o foco continuava em 'menu' com o overlay já fora da tela:
    // ↑↓ e OK mortos, e Voltar abrindo menu em vez de fechar o player.
    // Ajuste durante o render (mesmo padrão do lastSrc); effect com setState
    // é proibido pela regra react-hooks/set-state-in-effect.
    const [lastEntryCount, setLastEntryCount] = useState(menuEntries.length);
    if (menuEntries.length !== lastEntryCount) {
        setLastEntryCount(menuEntries.length);
        if (menuEntries.length === 0) {
            setMenu(null);
            setMenuIndex(0);
            if (playerFocus === 'menu') setPlayerFocus('controls');
        } else if (menuIndex > menuEntries.length - 1) {
            setMenuIndex(menuEntries.length - 1);
        }
    }

    const MENU_TITLES: Record<MenuId, string> = {
        root: 'Opções',
        quality: 'Qualidade',
        audio: 'Áudio',
        subs: 'Legendas',
        subsize: 'Tamanho da legenda',
    };

    // Execute focused control action
    const executeControlAction = useCallback(() => {
        switch (focusedControl) {
            case 'close':
                handleClose();
                break;
            case 'prev':
                onPreviousEpisode?.();
                break;
            case 'play':
                togglePlay();
                break;
            case 'next':
                onNextEpisode?.();
                break;
            case 'options':
                openMenu('root');
                break;
            case 'golive':
                seekToLive();
                break;
            case 'channels':
                openZapList();
                break;
            case 'volume':
                toggleMute();
                break;
            case 'sleep':
                cycleSleep();
                break;
            case 'aspect':
                cycleAspect();
                break;
            case 'pin':
                pinMoment();
                break;
            case 'momprev':
                jumpMoment(-1);
                break;
            case 'momnext':
                jumpMoment(1);
                break;
            case 'strip':
                alternarTira();
                break;
        }
    }, [focusedControl, handleClose, onPreviousEpisode, togglePlay, onNextEpisode, openMenu, openZapList, toggleMute, cycleSleep, cycleAspect, seekToLive, pinMoment, jumpMoment, alternarTira]);

    // TV Navigation handler
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (stillWatching) return; // só OK (continuar) ou Voltar (sair)
        resetHideControlsTimer();

        if (playerFocus === 'zap-list') {
            const total = channelList?.length || 0;
            if (direction === 'up') {
                setZapIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'down') {
                setZapIndex(prev => Math.min(total - 1, prev + 1));
            } else if (direction === 'left') {
                closeZapList();
            }
        } else if (playerFocus === 'menu') {
            const total = menuEntries.length;
            if (direction === 'up') {
                setMenuIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'down') {
                setMenuIndex(prev => Math.min(total - 1, prev + 1));
            } else if (direction === 'left') {
                // ← volta pra raiz (ou fecha, se já está nela)
                if (menu && menu !== 'root') openMenu('root'); else closeMenu();
            }
        } else if (playerFocus === 'moments') {
            // Tira de momentos: ←→ escolhem a miniatura, ↓ volta pra barra
            const total = faixaRef.current.length;
            // Removeu o último momento com a tira focada: ela sumiu, volta aos botões
            if (total === 0) setPlayerFocus('controls');
            else if (direction === 'left') setMomentFocus(i => Math.max(0, i - 1));
            else if (direction === 'right') setMomentFocus(i => Math.min(total - 1, i + 1));
            else if (direction === 'down') setPlayerFocus('seekbar');
        } else if (playerFocus === 'seekbar') {
            // Barra focada: ←→ pulam com aceleração, ↓ volta pros botões,
            // ↑ sobe pra tira de momentos (se houver), já no momento atual
            if (direction === 'left') nudgeSeek(-1);
            else if (direction === 'right') nudgeSeek(1);
            else if (direction === 'down') {
                commitSeek();
                setPlayerFocus('controls');
            } else if (direction === 'up' && faixaRef.current.length > 0) {
                commitSeek();
                setMomentFocus(indiceAtualNaFaixa(faixaRef.current, videoRef.current?.currentTime ?? 0));
                setPlayerFocus('moments');
            }
        } else {
            // Botão de volume focado: ↑↓ ajustam o nível em vez do gesto geral
            // (subir pra barra de progresso) — só se aplica a ESTE botão, o
            // resto do controle continua exatamente como antes.
            if (focusedControl === 'volume' && (direction === 'up' || direction === 'down')) {
                adjustVolume(direction === 'up' ? 0.1 : -0.1);
                return;
            }
            // ↑ sobe pra barra de progresso (só VOD tem barra)
            if (direction === 'up' && !isLiveContent && duration > 0) {
                setPlayerFocus('seekbar');
                return;
            }
            // Navigate controls with left/right
            if (direction === 'left' || direction === 'right') {
                const buttons = getControlButtons();
                // Botão focado pode ter sumido (ex.: golive após voltar ao
                // vivo) — reancora no play em vez de cair no índice 0 (close)
                const rawIndex = buttons.indexOf(focusedControl);
                const currentIndex = rawIndex === -1 ? buttons.indexOf('play') : rawIndex;
                if (direction === 'left') {
                    const newIndex = Math.max(0, currentIndex - 1);
                    setFocusedControl(buttons[newIndex]);
                } else {
                    const newIndex = Math.min(buttons.length - 1, currentIndex + 1);
                    setFocusedControl(buttons[newIndex]);
                }
            }
            // Seek with left/right when on play button
            if (focusedControl === 'play') {
                if (direction === 'left') {
                    // Only seek if already at leftmost position
                    const buttons = getControlButtons();
                    const currentIndex = buttons.indexOf(focusedControl);
                    if (currentIndex === 0 || (currentIndex === 1 && buttons[0] === 'close')) {
                        // Don't seek, just navigate
                    }
                } else if (direction === 'right') {
                    // Don't seek, just navigate
                }
            }
        }
    }, [playerFocus, menu, menuEntries.length, channelList?.length, focusedControl, getControlButtons,
        resetHideControlsTimer, closeZapList, openMenu, closeMenu, nudgeSeek, commitSeek, isLiveContent,
        duration, stillWatching, adjustVolume]);

    const handleEnter = useCallback(() => {
        if (stillWatching) {
            confirmStillWatching();
            return;
        }
        // Com a barra escondida, o primeiro OK só TRAZ os controles de volta.
        // Executar o botão que por acaso estava focado fechava o player na
        // cara de quem só queria ver a barra.
        if (!showControls && playerFocus === 'controls') {
            resetHideControlsTimer();
            return;
        }
        resetHideControlsTimer();

        if (playerFocus === 'zap-list') {
            const channel = channelList?.[zapIndex];
            if (channel) {
                onSwitchChannel?.(channel.stream_id);
                closeZapList();
            }
        } else if (playerFocus === 'menu') {
            menuEntries[menuIndex]?.run();
        } else if (playerFocus === 'seekbar') {
            // OK confirma o pulo pendente; sem pulo, é play/pause
            if (seekTargetRef.current != null) commitSeek();
            else togglePlay();
        } else if (playerFocus === 'moments') {
            // OK pula pro momento da miniatura (e fica na tira pra escolher outro)
            const alvo = faixaRef.current[momentFocus];
            if (alvo?.doAtual) seek(alvo.t);
            else if (alvo) momentsRef.current?.onEscolher?.(alvo);
        } else {
            executeControlAction();
        }
    }, [playerFocus, menuIndex, menuEntries, executeControlAction, resetHideControlsTimer, momentFocus, seek,
        channelList, zapIndex, onSwitchChannel, closeZapList, commitSeek, togglePlay,
        stillWatching, confirmStillWatching, showControls]);

    const handleBack = useCallback(() => {
        if (stillWatching) {
            handleClose();
            return;
        }
        if (playerFocus === 'zap-list') {
            closeZapList();
        } else if (playerFocus === 'menu') {
            // Voltar sobe um nível antes de fechar — submenu não pode
            // jogar o usuário direto pra fora do player
            if (menu && menu !== 'root') openMenu('root');
            else closeMenu();
        } else if (playerFocus === 'seekbar' || playerFocus === 'moments') {
            commitSeek();
            setPlayerFocus('controls');
            // Sem isto a barra ficava na tela pra sempre: o effect do auto-hide
            // não re-arma sozinho quando só o playerFocus muda
            resetHideControlsTimer();
        } else if (onClose) {
            handleClose();
        }
    }, [playerFocus, closeZapList, closeMenu, openMenu, menu, commitSeek, handleClose, onClose,
        stillWatching, resetHideControlsTimer]);

    // TV Navigation hook
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        // 🟢 marca um momento (só com a lista secreta; sem `moments` nada muda)
        onAction: moments ? (action) => { if (action === 'green') pinMoment(); } : undefined,
        enabled: navEnabled && (isOverlayOwner || appFocusZone !== 'overlay')
    });

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isLive || contentType === 'live') return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = (e.clientX - rect.left) / rect.width;
        seek(clickPosition * duration);
    };

    const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isLive || contentType === 'live' || !progressRef.current) return;
        const rect = progressRef.current.getBoundingClientRect();
        const position = (e.clientX - rect.left) / rect.width;
        setHoverPosition(e.clientX - rect.left);
        setHoverTime(position * duration);
    };

    // Helpers
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const percentage = (value: number, total: number): number => {
        return total > 0 ? (value / total) * 100 : 0;
    };

    const getCurrentQualityLabel = (): string => {
        if (qualityLevels.length === 0) {
            return qualityVariants?.find(v => v.selected)?.label || 'Qualidade';
        }
        if (isAutoQuality) {
            const current = qualityLevels.find(l => l.index === currentQualityIndex);
            return current ? `Auto (${current.label})` : 'Auto';
        }
        const level = qualityLevels.find(l => l.index === currentQualityIndex);
        return level?.label || 'Auto';
    };

    const palcoZap = zapPreview ?? zapCarregando;
    const logoZap = useLogoPequeno(palcoZap?.stream_icon);

    return (
        <div
            ref={containerRef}
            className={`video-player-container ${noLugar ? 'video-player-no-lugar' : ''}`}
            onMouseMove={resetHideControlsTimer}
        >
            {/* Close Button */}
            {onClose && showControls && (
                <button
                    className={`video-player-close ${focusedControl === 'close' && playerFocus === 'controls' ? 'focused' : ''}`}
                    onClick={handleClose}
                >
                    <FaTimes />
                </button>
            )}

            {/* Title */}
            {title && showControls && (
                <div className="video-player-title">{title}</div>
            )}

            {/* Video Wrapper */}
            <div className="video-wrapper">
                {/* Proporção via classes (o CSS base usa !important; style
                    inline sem !important perderia — achado da revisão) */}
                {adopted ? (
                    // O <video> adotado entra aqui (ver useLayoutEffect do adopted);
                    // no lugar, fica na prévia e o host fica vazio
                    <div ref={hostRef} className="video-element-host" />
                ) : (
                <video
                    ref={videoRef}
                    crossOrigin={crossOrigin}
                    className={videoClassName}
                    poster={isRadio ? undefined : poster}
                    onClick={togglePlay}
                    playsInline
                >
                    {activeTrack && (
                        <track
                            key={activeTrack.blobUrl}
                            kind="subtitles"
                            src={activeTrack.blobUrl}
                            srcLang={activeTrack.lang || 'und'}
                            label={activeTrack.label}
                            default
                        />
                    )}
                </video>
                )}
                {/* Modo rádio (item 13): sem imagem no stream — logo + relógio */}
                {isRadio && (
                    <div className="radio-stage">
                        {poster
                            ? <img decoding="async" className="radio-logo" src={poster} alt={title || 'Rádio'} />
                            : <div className="radio-logo radio-logo-fallback"><FaHeadphones /></div>}
                        <div className="radio-name">{title}</div>
                        <RadioClock />
                        <div className="radio-hint">CH+ / CH− trocam de estação</div>
                    </div>
                )}
                {/* Zapando: só a imagem troca por cima do vídeo (que continua
                    tocando por baixo, sem interrupção) até assentar em
                    ZAP_SETTLE_MS — daí sim o HLS de verdade troca de canal. */}
                {palcoZap && (
                    <div className="zap-preview-stage">
                        {logoZap
                            ? <img className="zap-preview-logo" src={logoZap} alt={palcoZap.name} />
                            : <div className="zap-preview-logo zap-preview-logo-fallback"><FaBroadcastTower /></div>}
                        <div className="zap-preview-name">
                            {palcoZap.num != null && <span className="zap-preview-num">{palcoZap.num}</span>}
                            {palcoZap.name}
                        </div>
                    </div>
                )}
            </div>

            {/* Aviso "a seguir" perto do fim do programa (item 9) */}
            {nextSoon && !showControls && liveEpg?.now && !palcoZap && (
                <div className="next-soon-banner">
                    Em {Math.max(1, Math.ceil((liveEpg.now.end - Date.now()) / 60000))} min: {nextSoon.title}
                </div>
            )}

            {/* Onde eu caí? (banner curto na troca de canal) — escondido
                enquanto zap-preview está ativo pra não mostrar o canal ANTIGO
                por cima da prévia do canal NOVO */}
            {canZap && zapBanner && !showControls && !palcoZap && (
                <div className="zap-banner">
                    {zapBanner.num != null && <span className="zap-banner-num">{zapBanner.num}</span>}
                    <span className="zap-banner-name">{zapBanner.name}</span>
                </div>
            )}

            {/* OSD do digit-jump (troca de canal por número) */}
            {digitBuffer && (
                <div className="digit-osd">{digitBuffer}</div>
            )}

            {/* Overlay de zapping (lista de canais) */}
            {playerFocus === 'zap-list' && channelList && channelList.length > 0 && (() => {
                const half = Math.floor(ZAP_WINDOW / 2);
                const start = Math.max(0, Math.min(zapIndex - half, channelList.length - ZAP_WINDOW));
                const visible = channelList.slice(start, start + ZAP_WINDOW);
                return (
                    <div className="zap-overlay">
                        <div className="zap-overlay-header"><FaBroadcastTower /> Canais</div>
                        <div className="zap-overlay-list">
                            {visible.map((channel, i) => {
                                const realIndex = start + i;
                                return (
                                    <div
                                        key={channel.stream_id}
                                        className={`zap-item ${realIndex === zapIndex ? 'focused' : ''} ${channel.stream_id === currentChannelId ? 'current' : ''}`}
                                        onClick={() => {
                                            onSwitchChannel?.(channel.stream_id);
                                            closeZapList();
                                        }}
                                    >
                                        {channel.num != null && <span className="zap-num">{channel.num}</span>}
                                        <span className="zap-name">
                                            {channel.name}
                                            {realIndex === zapIndex && zapEpg?.id === channel.stream_id && (
                                                <span className="zap-epg-now">agora: {zapEpg.title}</span>
                                            )}
                                        </span>
                                        {channel.stream_id === currentChannelId && <span className="zap-playing">▶</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="zap-overlay-hint">↑↓ Navegar · OK Assistir · ← Fechar</div>
                    </div>
                );
            })()}

            {/* Ainda está assistindo? (item 51) */}
            {stillWatching && (
                <div className="still-watching">
                    <div className="still-watching-title">Ainda está assistindo?</div>
                    <div className="still-watching-sub">
                        {AUTO_EPISODE_LIMIT} episódios seguidos sem toque no controle.
                    </div>
                    <button className="still-watching-btn" onClick={confirmStillWatching}>
                        ▶ Continuar
                    </button>
                    <div className="still-watching-hint">OK continua · Voltar sai</div>
                </div>
            )}

            {/* Pulo acumulado do seek por D-pad (item 37) */}
            {seekDisplay && (
                <div className="seek-osd">
                    <span className="seek-osd-target">{formatTime(seekDisplay.target)}</span>
                    <span className="seek-osd-step">passo de {seekDisplay.step}s</span>
                </div>
            )}

            {/* Estatísticas do stream (item 48) */}
            {showStats && stats && (
                <div className="stats-overlay">
                    <div>{stats.width}×{stats.height}</div>
                    <div>{stats.bitrate > 0 ? `${Math.round(stats.bitrate / 1000)} kbps` : '— kbps'}</div>
                    <div>buffer {stats.buffer.toFixed(1)}s</div>
                    <div>drops {stats.dropped}</div>
                </div>
            )}

            {/* Central Play Button */}
            {!playing && !loading && !error && (
                <div className="central-play-button" onClick={togglePlay}>
                    <div className="central-play-icon">
                        <FaPlay />
                    </div>
                </div>
            )}

            {/* Loading Spinner */}
            {loading && (
                <div className="video-player-loading">
                    <div className="modern-spinner">
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                    </div>
                    <span className="loading-text">Carregando...</span>
                </div>
            )}

            {/* Pausado no ao vivo (item 8) */}
            {pausedLiveSrc && !playing && (
                <div className="paused-live-badge">
                    <FaPause /> Pausado — retomar continua de onde parou
                </div>
            )}

            {momentToast && (
                <div className="moment-toast">
                    {momentToast.img && <img className="moment-toast-thumb" src={momentToast.img} alt="" />}
                    <span>{momentToast.text}</span>
                </div>
            )}

            {/* Reconectando (R1 item 44) */}
            {reconnecting && !error && (
                <div className="reconnect-overlay">
                    {waitingConnection
                        ? <><FaSync /> Aguardando o provedor liberar a conexão…</>
                        : <><FaSync /> Reconectando… tentativa {reconnectAttempt}/{maxReconnectAttempts}</>}
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="video-player-error">
                    <p><FaExclamationTriangle /> {error}</p>
                    {onClose && <button onClick={handleClose}>Fechar</button>}
                </div>
            )}

            {/* Menu de opções (qualidade / áudio / legendas / stats) */}
            {menu && menuEntries.length > 0 && (
                <div className="quality-menu">
                    <div className="quality-menu-header">
                        <FaCog /> <span>{MENU_TITLES[menu]}</span>
                    </div>
                    <div className="quality-menu-items">
                        {menuEntries.map((entry, index) => (
                            <Fragment key={`${entry.label}-${index}`}>
                                {entry.group && entry.group !== menuEntries[index - 1]?.group && (
                                    <div className="quality-menu-header">
                                        <span>{entry.group}</span>
                                    </div>
                                )}
                                <div
                                    className={`quality-menu-item ${menuIndex === index ? 'focused' : ''} ${entry.selected ? 'selected' : ''}`}
                                    onClick={entry.run}
                                >
                                    {entry.label}
                                    {entry.hint && <span className="quality-bitrate">{entry.hint}</span>}
                                </div>
                            </Fragment>
                        ))}
                    </div>
                    <div className="quality-menu-hint">OK escolhe · ← Voltar</div>
                </div>
            )}

            {/* Controls */}
            <div className={`video-player-controls ${showControls ? 'visible' : 'hidden'}`}>
                {/* Mini-EPG (live) */}
                {isLiveContent && liveEpg?.now && (
                    <div className="player-mini-epg">
                        <div className="mini-epg-row">
                            <span className="mini-epg-title">{liveEpg.now.title}</span>
                            <span className="mini-epg-time">
                                {formatClock(liveEpg.now.start)} – {formatClock(liveEpg.now.end)}
                            </span>
                        </div>
                        <div className="mini-epg-progress">
                            <div
                                className="mini-epg-progress-fill"
                                style={{ width: `${epgProgressPct(liveEpg.now)}%` }}
                            />
                        </div>
                        {liveEpg.next && (
                            <div className="mini-epg-next">A seguir: {liveEpg.next.title}</div>
                        )}
                    </div>
                )}

                {/* Tira de momentos (lista secreta): miniatura de cada momento;
                    ↑ da barra entra, ←→ escolhem, OK pula */}
                {faixa.length > 0 && (
                    <div ref={momentStripRef} className={`moment-strip ${playerFocus === 'moments' ? 'strip-focused' : ''}`}>
                        {faixa.map((m, i) => {
                            const tocando = m.doAtual && Math.abs(m.t - currentTime) <= TOLERANCIA_MOMENTO_S;
                            // Primeiro momento de cada filme leva o título: marca onde um termina e o outro começa
                            const inicioDoFilme = i === 0 || faixa[i - 1].filmeId !== m.filmeId;
                            return (
                                <button
                                    key={`${m.filmeId}-${m.t}`}
                                    className={`moment-thumb ${m.doAtual ? 'current-movie' : ''} ${tocando ? 'playing' : ''} ${playerFocus === 'moments' && i === momentFocus ? 'focused' : ''}`}
                                    onClick={() => (m.doAtual ? seek(m.t) : moments?.onEscolher?.(m))}
                                    title={`${m.titulo} — ${formatTime(m.t)}`}
                                >
                                    {m.thumb ? <img src={m.thumb} alt="" /> : <span className="moment-thumb-empty">{i + 1}</span>}
                                    {inicioDoFilme && moments?.sequencia && <span className="moment-thumb-title">{m.titulo}</span>}
                                    <span className="moment-thumb-time">{formatTime(m.t)}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Progress Bar (VOD only) */}
                {!isLive && contentType !== 'live' && (
                    <div
                        ref={progressRef}
                        className={`progress-container ${playerFocus === 'seekbar' ? 'seek-focused' : ''}`}
                        onClick={handleProgressClick}
                        onMouseMove={handleProgressHover}
                        onMouseLeave={() => setHoverTime(null)}
                    >
                        {playerFocus === 'seekbar' && (
                            <div className="seek-hint">← → pulam · OK confirma · ↓ volta</div>
                        )}
                        {hoverTime !== null && (
                            <div
                                className="time-preview-tooltip"
                                style={{ left: `${hoverPosition}px` }}
                            >
                                {formatTime(hoverTime)}
                            </div>
                        )}
                        <div className="progress-bar">
                            <div
                                className="progress-buffered"
                                style={{ width: `${percentage(buffered, duration)}%` }}
                            />
                            <div
                                className="progress-played"
                                style={{ width: `${percentage(seekDisplay?.target ?? currentTime, duration)}%` }}
                            />
                            <div
                                className="progress-handle"
                                style={{ left: `${percentage(seekDisplay?.target ?? currentTime, duration)}%` }}
                            />
                            {moments && duration > 0 && moments.list.map(m => (
                                <div
                                    key={m}
                                    className="moment-marker"
                                    style={{ left: `${percentage(m, duration)}%` }}
                                    title={formatTime(m)}
                                    onClick={(e) => { e.stopPropagation(); seek(m); }}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Controls Row */}
                <div className="controls-row">
                    <div className="controls-left">
                        {/* Previous Episode */}
                        {canGoPrevious && onPreviousEpisode && (
                            <button
                                className={`control-btn ${focusedControl === 'prev' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={onPreviousEpisode}
                                title="Anterior"
                            >
                                <FaStepBackward />
                            </button>
                        )}

                        {/* Play/Pause */}
                        <button
                            className={`control-btn ${focusedControl === 'play' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={togglePlay}
                        >
                            {playing ? <FaPause /> : <FaPlay />}
                        </button>

                        {/* Next Episode */}
                        {canGoNext && onNextEpisode && (
                            <button
                                className={`control-btn ${focusedControl === 'next' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={onNextEpisode}
                                title="Próximo"
                            >
                                <FaStepForward />
                            </button>
                        )}

                        {/* Momentos (lista secreta): ◀ anterior · 📌 marcar · próximo ▶ */}
                        {moments && moments.list.length > 0 && (
                            <button
                                className={`control-btn ${focusedControl === 'momprev' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={() => jumpMoment(-1)}
                                title="Momento anterior (CH−)"
                            >
                                <FaBackward />
                            </button>
                        )}
                        {moments && (
                            <button
                                className={`control-btn ${noMomento ? 'pin-active' : ''} ${focusedControl === 'pin' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={pinMoment}
                                title={noMomento ? 'Remover este momento (🟢)' : 'Marcar este momento (🟢)'}
                            >
                                <FaThumbtack />
                                {moments.list.length > 0 && <span className="quality-label">{moments.list.length}</span>}
                            </button>
                        )}
                        {moments && moments.list.length > 0 && (
                            <button
                                className={`control-btn ${focusedControl === 'momnext' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={() => jumpMoment(1)}
                                title="Próximo momento (CH+)"
                            >
                                <FaForward />
                            </button>
                        )}
                        {temTira && (
                            <button
                                className={`control-btn ${moments?.tiraVisivel ? 'pin-active' : ''} ${focusedControl === 'strip' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={alternarTira}
                                title={moments?.tiraVisivel ? 'Esconder miniaturas' : 'Mostrar miniaturas'}
                            >
                                <FaImages />
                            </button>
                        )}

                        {/* Time / Live Badge */}
                        {isLiveContent ? (
                            isBehindLive ? (
                                <button
                                    className={`live-badge live-badge-behind ${focusedControl === 'golive' && playerFocus === 'controls' ? 'focused' : ''}`}
                                    onClick={seekToLive}
                                >
                                    <span className="live-dot" />
                                    {/* Texto solto vira item flex anônimo e o
                                        fallback de gap não o alcança */}
                                    <span>VOLTAR AO VIVO</span>
                                </button>
                            ) : (
                                <span className="live-badge">
                                    <span className="live-dot" />
                                    <span>AO VIVO</span>
                                </span>
                            )
                        ) : (
                            <span className="time-display">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </span>
                        )}
                    </div>

                    <div className="controls-right">
                        {/* Options Button (qualidade, áudio, legendas, stats) */}
                        <button
                            className={`control-btn quality-btn ${focusedControl === 'options' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={() => openMenu('root')}
                            title="Opções"
                        >
                            <FaCog />
                            {(qualityLevels.length > 0 || (qualityVariants && qualityVariants.length > 0)) && (
                                <span className="quality-label">{getCurrentQualityLabel()}</span>
                            )}
                        </button>

                        {/* Channel List Button (live) */}
                        {canZap && (
                            <button
                                className={`control-btn ${focusedControl === 'channels' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={openZapList}
                                title="Lista de canais"
                            >
                                <FaListUl />
                            </button>
                        )}

                        {/* Volume Control (item do elemento <video>, não da TV) */}
                        <div className={`volume-control ${(focusedControl === 'volume' && playerFocus === 'controls') || volumeActive ? 'active' : ''}`}>
                            <button
                                className={`control-btn ${focusedControl === 'volume' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={toggleMute}
                                title="Volume"
                            >
                                {muted || volume === 0 ? <FaVolumeMute /> : volume < 0.5 ? <FaVolumeDown /> : <FaVolumeUp />}
                            </button>
                            <input
                                type="range"
                                className="volume-slider"
                                min={0}
                                max={1}
                                step={0.01}
                                value={muted ? 0 : volume}
                                onChange={() => { /* só D-pad ajusta; ver adjustVolume */ }}
                                tabIndex={-1}
                            />
                        </div>

                        {/* Sleep Timer Button */}
                        <button
                            className={`control-btn ${sleepUntil ? 'active' : ''} ${focusedControl === 'sleep' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={cycleSleep}
                            title="Timer de desligamento"
                        >
                            <FaMoon />
                            {sleepRemainingMin != null && (
                                <span className="quality-label">{sleepRemainingMin}m</span>
                            )}
                        </button>

                        {/* Aspect Ratio Button */}
                        <button
                            className={`control-btn ${focusedControl === 'aspect' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={cycleAspect}
                            title="Proporção"
                        >
                            <FaExpand />
                            {aspectMode !== 'original' && (
                                <span className="quality-label">{ASPECT_LABELS[aspectMode]}</span>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
