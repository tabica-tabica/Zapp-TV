// useHls hook - Manages HLS.js for streaming playback with quality selection
import { useEffect, useRef, useCallback, useState, type MutableRefObject, type RefObject } from 'react';
import Hls, { type HlsListeners } from 'hls.js';
// O build ESM do hls.js (o que o Vite empacota) só cria o worker com
// `workerPath` — sem isto o `enableWorker` não fazia nada e o transmux rodava
// na thread principal, disputando com a navegação (visto no perfil da LG)
import hlsWorkerUrl from 'hls.js/dist/hls.worker.js?url';
import { qualityCap } from '../services/playerPrefs';
import { playbackPrefs } from '../services/playbackPrefs';
import { noWebOS } from '../services/platformApp';

export interface QualityLevel {
    index: number;
    height: number;
    width: number;
    bitrate: number;
    label: string;
}

export type { StreamErrorCause } from '../services/playerDecisions';
import { classifyStreamError, chooseCappedLevel } from '../services/playerDecisions';
import type { StreamErrorCause } from '../services/playerDecisions';

/** Faixa embutida no stream (áudio ou legenda) — itens 39 e 40 */
export interface MediaTrack {
    id: number;
    label: string;
    lang?: string;
}

interface UseHlsOptions {
    src: string;
    videoRef: RefObject<HTMLVideoElement | null>;
    onError?: (cause?: StreamErrorCause) => void;
    onStreamError?: (cause?: StreamErrorCause) => void; // For live TV fallback
    autoPlay?: boolean;
    /** Live usa buffers menores — TVs Tizen antigas têm ~1GB de RAM */
    isLive?: boolean;
    /**
     * URL final do manifesto (depois dos redirects). No Xtream ela carrega o
     * `?token=` da SESSÃO aberta: quem reaproveitar essa URL entra na mesma
     * conexão em vez de abrir outra (conta de 1 conexão recusa a segunda).
     */
    onResolvedUrl?: (url: string) => void;
    /**
     * Pipeline já tocando (o da prévia da TV ao Vivo) pra assumir em vez de
     * criar um novo: o hls.js segue preso ao MESMO <video> e à mesma sessão
     * do provedor — nenhuma requisição nova, nenhuma conexão a mais.
     */
    adopt?: Hls | null;
    /**
     * O <video> do `adopt` mudou de lugar no documento? No webOS isso derruba
     * o pipeline de mídia e o hook refaz o MediaSource (recoverMediaError).
     * false: o player usou o <video> da prévia NO LUGAR (sem mover) — nada a refazer.
     */
    adoptMovido?: boolean;
    /**
     * Ao vivo: segundos atrás da borda pra começar (troca de fonte por falha:
     * a nova entra no MESMO atraso da que caiu, pra cena não pular). Lido só
     * na criação do pipeline. Sem ele, o padrão do hls.js (3 segmentos).
     */
    liveSyncDuration?: number | null;
    /**
     * Prévia (caixa pequena): buffer curto. 30-60s de 1080p na RAM de uma TV
     * de 1GB por uma caixa de 300px era só memória e coleta de lixo; quem
     * assume o pipeline (player) devolve o buffer de sempre.
     */
    preview?: boolean;
}

/**
 * Segundos de buffer da prévia: 2 segmentos à frente (o painel corta em 10 s).
 * Eram 8 s — menos que 1 segmento, o buffer secava entre um e outro e o
 * player que assume a prévia nascia abaixo do LIVE_BUFFER_LOW_S. Na LG
 * (12/10/2026): processo do app 124 → ~158 MB com a prévia tocando (sobram
 * ~150 MB livres); backBufferLength 0 não muda nada — o hls.js guarda ao
 * menos 1 segmento pra trás de qualquer jeito.
 */
const PREVIEW_BUFFER_S = 20;

/** Última vez que QUALQUER pipeline deste app recebeu fragmento (ver connlimit). */
let lastStreamActivityAt = 0;

// Listeners que ESTE hook pôs em cada instância. O hls.js usa o mesmo emissor
// pros controladores internos (recarga da playlist, carga de fragmento):
// removeAllListeners() desligava o pipeline inteiro na hora do handoff — o
// vídeo seguia só do buffer e congelava ~40s depois.
const ownListeners = new WeakMap<Hls, Array<() => void>>();

function listen<E extends keyof HlsListeners>(hls: Hls, event: E, fn: HlsListeners[E]): void {
    hls.on(event, fn);
    const list = ownListeners.get(hls) ?? [];
    list.push(() => hls.off(event, fn));
    ownListeners.set(hls, list);
}

function releaseOwnListeners(hls: Hls): void {
    ownListeners.get(hls)?.forEach(off => off());
    ownListeners.delete(hls);
}

interface UseHlsReturn {
    hlsRef: MutableRefObject<Hls | null>;
    cleanup: () => void;
    /** Re-inicializa o pipeline do zero (mesmo src) — usado pelo retry */
    reload: () => void;
    /** Entrega o pipeline vivo pra outro dono sem destruí-lo (prévia → player) */
    handOff: () => Hls | null;
    /**
     * O inverso do handOff, sem remontar: reassume um hls.js que segue preso
     * ao MESMO <video> deste hook (player → prévia, com o <video> no lugar).
     */
    retomar: (hls: Hls) => void;
    qualityLevels: QualityLevel[];
    currentQualityIndex: number;
    setQuality: (index: number) => void;
    isAutoQuality: boolean;
    setAutoQuality: () => void;
    /** Faixas de áudio embutidas (dublado/original/SAP) — item 39 */
    audioTracks: MediaTrack[];
    currentAudioTrack: number;
    setAudioTrack: (id: number) => void;
    /** Legendas embutidas; -1 = desligadas — item 40 */
    subtitleTracks: MediaTrack[];
    currentSubtitleTrack: number;
    setSubtitleTrack: (id: number) => void;
}

export function useHls({
    src,
    videoRef,
    onError,
    onStreamError,
    autoPlay = false,
    isLive = false,
    onResolvedUrl,
    adopt = null,
    adoptMovido = true,
    liveSyncDuration = null,
    preview = false,
}: UseHlsOptions): UseHlsReturn {
    const liveSyncRef = useRef(liveSyncDuration);
    useEffect(() => { liveSyncRef.current = liveSyncDuration; }, [liveSyncDuration]);
    const hlsRef = useRef<Hls | null>(null);
    const srcRef = useRef<string>('');
    const onErrorRef = useRef(onError);
    const onStreamErrorRef = useRef(onStreamError);
    const onResolvedUrlRef = useRef(onResolvedUrl);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Escolha manual de faixa precisa sobreviver ao reload() (retry, watchdog,
    // volta do standby): o pipeline é recriado do zero e o hls.js reescolhe a
    // faixa default. Amarrada ao src pra NÃO vazar pro canal seguinte.
    const preferredTracksSrcRef = useRef<string>('');
    const preferredAudioRef = useRef<number | null>(null);
    const preferredSubtitleRef = useRef<number | null>(null);

    // Adoção: consome o pipeline recebido UMA vez. O StrictMode do dev roda
    // efeito → limpeza → efeito; a limpeza estaciona o adotado por um tique
    // (adoptParkedRef) pra o segundo efeito pegar de volta em vez de destruir
    // e abrir uma conexão nova — exatamente o que a adoção existe pra evitar.
    const adoptConsumedRef = useRef(false);
    const adoptedRef = useRef<Hls | null>(null);
    const adoptParkedRef = useRef<{ hls: Hls; src: string; timer: ReturnType<typeof setTimeout> } | null>(null);
    const reloadingRef = useRef(false);
    // Pipeline devolvido pra reassumir no próximo passe do efeito (ver retomar)
    const retomadoRef = useRef<Hls | null>(null);

    // Re-init sob demanda (retry/watchdog): bump re-roda o effect principal
    const [reloadTick, setReloadTick] = useState(0);

    // Quality state
    const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
    const [currentQualityIndex, setCurrentQualityIndex] = useState(-1); // -1 = auto
    const [isAutoQuality, setIsAutoQuality] = useState(true);

    // Faixas embutidas (itens 39/40)
    const [audioTracks, setAudioTracks] = useState<MediaTrack[]>([]);
    const [currentAudioTrack, setCurrentAudioTrack] = useState(-1);
    const [subtitleTracks, setSubtitleTracks] = useState<MediaTrack[]>([]);
    const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState(-1);

    const destroyHlsInstance = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }, []);

    useEffect(() => {
        onErrorRef.current = onError;
        onStreamErrorRef.current = onStreamError;
        onResolvedUrlRef.current = onResolvedUrl;
    }, [onError, onStreamError, onResolvedUrl]);

    const cleanup = useCallback(() => {
        destroyHlsInstance();
        setQualityLevels([]);
        setCurrentQualityIndex(-1);
        setIsAutoQuality(true);
        setAudioTracks([]);
        setCurrentAudioTrack(-1);
        setSubtitleTracks([]);
        setCurrentSubtitleTrack(-1);
    }, [destroyHlsInstance]);

    const reload = useCallback(() => {
        reloadingRef.current = true; // reload de verdade: o adotado não volta
        srcRef.current = ''; // fura o guard de mesmo-src
        setReloadTick(t => t + 1);
    }, []);

    // Set quality level
    const setQuality = useCallback((index: number) => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = index;
            setCurrentQualityIndex(index);
            setIsAutoQuality(index === -1);
        }
    }, []);

    // Set auto quality
    const setAutoQuality = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = -1;
            setCurrentQualityIndex(-1);
            setIsAutoQuality(true);
        }
    }, []);

    // Troca a faixa de áudio (dublado ↔ original)
    const setAudioTrack = useCallback((id: number) => {
        if (!hlsRef.current) return;
        preferredAudioRef.current = id;
        hlsRef.current.audioTrack = id;
        setCurrentAudioTrack(id);
    }, []);

    // -1 desliga a legenda. subtitleDisplay tem que acompanhar: só mudar o
    // índice deixa a faixa selecionada porém invisível em algumas builds.
    const setSubtitleTrack = useCallback((id: number) => {
        if (!hlsRef.current) return;
        preferredSubtitleRef.current = id;
        hlsRef.current.subtitleDisplay = id >= 0;
        hlsRef.current.subtitleTrack = id;
        setCurrentSubtitleTrack(id);
    }, []);

    // Helper to create quality label
    const getQualityLabel = (height: number, bitrate = 0): string => {
        // Playlist de mídia única (o caso mais comum em Xtream) não declara
        // RESOLUTION — "0p" no menu não diz nada a ninguém
        if (!height) return bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : 'Padrão';
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height >= 360) return '360p';
        return `${height}p`;
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;

        // Avoid re-initializing if same src
        if (srcRef.current === src && hlsRef.current) {
            return;
        }

        // Pipeline adotado: o estacionado pelo StrictMode (mesmo src) ou o
        // recebido por prop, só na primeira vez
        let adopted: Hls | null = null;
        // Veio de OUTRO dono (o <video> mudou de lugar no documento)
        let movido = false;
        const parked = adoptParkedRef.current;
        if (parked) {
            clearTimeout(parked.timer);
            adoptParkedRef.current = null;
            if (parked.src === src && !reloadingRef.current) adopted = parked.hls;
            else parked.hls.destroy();
        } else if (retomadoRef.current) {
            adopted = retomadoRef.current;
            retomadoRef.current = null;
        } else if (adopt && !adoptConsumedRef.current) {
            adopted = adopt;
            movido = adoptMovido;
        }
        if (adopt) adoptConsumedRef.current = true;
        reloadingRef.current = false;
        adoptedRef.current = adopted;

        // Cleanup previous instance
        destroyHlsInstance();
        // Conteúdo diferente = escolhas anteriores não valem mais. reload()
        // mantém o mesmo src, então a preferência sobrevive a ele de propósito.
        if (preferredTracksSrcRef.current !== src) {
            preferredTracksSrcRef.current = src;
            preferredAudioRef.current = null;
            preferredSubtitleRef.current = null;
        }
        srcRef.current = src;

        // Reset video state (o adotado já está tocando NESTE <video>)
        if (!adopted) {
            video.pause();
            video.src = '';
            video.removeAttribute('src');
            video.load();
        }

        // Check if source is HLS
        const isHls = adopted !== null || src.includes('.m3u8');

        if (isHls) {
            if (adopted || Hls.isSupported()) {
                // Live usa buffers curtos: 90s de back-buffer em RAM derruba
                // TVs Tizen antigas (OOM). VOD mantém buffer maior pra seek.
                // O perfil de buffer é escolhido nas Configurações (item 66);
                // 'equilibrado' reproduz exatamente os valores anteriores
                const buffers = playbackPrefs.buffers();
                const seconds = preview ? PREVIEW_BUFFER_S : isLive ? buffers.live : buffers.vod;
                const maxSeconds = preview ? PREVIEW_BUFFER_S : isLive ? buffers.maxLive : buffers.maxVod;
                const atraso = isLive ? liveSyncRef.current : null;
                const buffer = {
                    backBufferLength: isLive ? seconds : seconds + 30,
                    maxBufferLength: seconds,
                    maxMaxBufferLength: maxSeconds,
                    // Teto em BYTES além dos segundos: stream 4K de bitrate
                    // alto estourava a RAM de TVs de 1GB só com o buffer
                    // (piso de 12MB: um segmento 1080p tem ~5MB)
                    maxBufferSize: Math.max(12, seconds) * 1000 * 1000,
                };
                // Assumido de outro dono (prévia → player): o buffer passa a ser
                // o DESTE uso — o hls.js lê o config a cada tique
                if (adopted?.config) Object.assign(adopted.config, buffer);
                const hls = adopted ?? new Hls({
                    ...(atraso ? { liveSyncDuration: atraso } : {}),
                    enableWorker: true,
                    workerPath: hlsWorkerUrl,
                    lowLatencyMode: false,
                    ...buffer,
                    startLevel: -1, // Auto quality selection
                    // Tauri: FetchLoader (fetch) em vez de XHR, pra passar
                    // pelo tauri-plugin-http — ver rotearFetchPeloTauri
                    progressive: __BUILD_TARGET__ === 'tauri',
                });

                if (!adopted) {
                    // Dev no browser: ver /stream-redirect no vite.config.ts (CORS do 1º redirect)
                    hls.loadSource(import.meta.env.DEV ? `/stream-redirect?url=${encodeURIComponent(src)}` : src);
                    hls.attachMedia(video);
                    // Legenda só aparece quando o usuário escolhe (item 40)
                    hls.subtitleDisplay = false;
                }

                // Faixas de áudio embutidas (item 39)
                listen(hls, Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
                    setAudioTracks(data.audioTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Faixa ${index + 1}`,
                        lang: track.lang,
                    })));
                    // Reconexão não pode desfazer o "Dublado" que o usuário escolheu
                    const wanted = preferredAudioRef.current;
                    if (wanted != null && wanted >= 0 && wanted < data.audioTracks.length) {
                        hls.audioTrack = wanted;
                        setCurrentAudioTrack(wanted);
                    } else {
                        setCurrentAudioTrack(hls.audioTrack);
                    }
                });
                listen(hls, Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
                    setCurrentAudioTrack(data.id);
                });

                // Legendas embutidas (item 40)
                listen(hls, Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
                    setSubtitleTracks(data.subtitleTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Legenda ${index + 1}`,
                        lang: track.lang,
                    })));
                    const wanted = preferredSubtitleRef.current;
                    if (wanted != null && wanted >= 0 && wanted < data.subtitleTracks.length) {
                        hls.subtitleDisplay = true;
                        hls.subtitleTrack = wanted;
                        setCurrentSubtitleTrack(wanted);
                    }
                });
                listen(hls, Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
                    // O hls.js seleciona sozinho a faixa DEFAULT=YES mesmo com
                    // subtitleDisplay=false. Reportar esse id deixaria o menu
                    // dizendo "Português" com a tela sem legenda nenhuma.
                    setCurrentSubtitleTrack(hls.subtitleDisplay ? data.id : -1);
                });

                listen(hls, Hls.Events.MANIFEST_LOADED, (_event, data) => {
                    if (data.url) onResolvedUrlRef.current?.(data.url);
                });

                // Capture quality levels when manifest is parsed
                listen(hls, Hls.Events.MANIFEST_PARSED, (_event, data) => {
                    const levels: QualityLevel[] = data.levels.map((level, index) => ({
                        index,
                        height: level.height,
                        width: level.width,
                        bitrate: level.bitrate,
                        label: getQualityLabel(level.height, level.bitrate),
                    }));

                    // Sort by height descending (best first)
                    levels.sort((a, b) => b.height - a.height);
                    setQualityLevels(levels);

                    // Teto global de qualidade (item 47). height === 0 significa
                    // "o manifesto não declarou RESOLUTION" — e não "é enorme".
                    // Sem NENHUMA altura declarada não dá pra aplicar teto: fazer
                    // isso travaria o canal inteiro na pior variante do provedor.
                    const escolhido = chooseCappedLevel(
                        data.levels.map((level, index) => ({ index, height: level.height || 0 })),
                        qualityCap.get()
                    );
                    if (escolhido !== null) hls.autoLevelCapping = escolhido;

                    if (autoPlay) {
                        video.play().catch(() => { });
                    }
                });

                // Track quality changes
                listen(hls, Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                    setCurrentQualityIndex(data.level);
                });

                // Falhas fatais de rede consecutivas: sinal de recuperação
                // (fragmento carregado) zera o contador
                let networkFatalCount = 0;
                listen(hls, Hls.Events.FRAG_LOADED, () => {
                    networkFatalCount = 0;
                    lastStreamActivityAt = Date.now();
                });

                listen(hls, Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) {
                        // Causa granular pro player mostrar mensagem acionável
                        const status = (data.response as { code?: number } | undefined)?.code;
                        // Corpo legível só quando a resposta é texto (manifesto via XHR)
                        const details = data.networkDetails as { responseText?: unknown } | undefined;
                        let body: string | undefined;
                        try {
                            body = typeof details?.responseText === 'string' ? details.responseText : undefined;
                        } catch {
                            body = undefined; // responseText lança em XHR binário
                        }
                        const cause: StreamErrorCause = classifyStreamError(
                            data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network'
                                : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'other',
                            status,
                            {
                                recentStreamMs: lastStreamActivityAt ? Date.now() - lastStreamActivityAt : undefined,
                                body,
                            }
                        );
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.error('[HLS] Network error, trying to recover...');
                                networkFatalCount++;
                                // 404/403 não se recupera com retry; e com MSE o
                                // video.error NUNCA seta em erro de rede — o
                                // callback tem que ser entregue diretamente
                                if (cause === 'notfound' || networkFatalCount >= 2) {
                                    if (retryTimeoutRef.current) {
                                        clearTimeout(retryTimeoutRef.current);
                                        retryTimeoutRef.current = null;
                                    }
                                    onStreamErrorRef.current?.(cause);
                                    break;
                                }
                                hls.startLoad();
                                // Persistiu sem novo fragmento? Entrega o erro
                                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                                retryTimeoutRef.current = setTimeout(() => {
                                    retryTimeoutRef.current = null;
                                    if (hlsRef.current === hls && networkFatalCount > 0) {
                                        onStreamErrorRef.current?.(cause);
                                    }
                                }, 5000);
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.error('[HLS] Media error, trying to recover...');
                                hls.recoverMediaError();
                                break;
                            default:
                                console.error('[HLS] Fatal error:', data);
                                cleanup();
                                onErrorRef.current?.(cause);
                                onStreamErrorRef.current?.(cause);
                                break;
                        }
                    }
                });

                hlsRef.current = hls;

                if (adopted) {
                    // MANIFEST_PARSED / *_TRACKS_UPDATED já passaram na prévia
                    const levels: QualityLevel[] = hls.levels.map((level, index) => ({
                        index,
                        height: level.height,
                        width: level.width,
                        bitrate: level.bitrate,
                        label: getQualityLabel(level.height, level.bitrate),
                    }));
                    levels.sort((a, b) => b.height - a.height);
                    setQualityLevels(levels);
                    setAudioTracks(hls.audioTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Faixa ${index + 1}`,
                        lang: track.lang,
                    })));
                    setCurrentAudioTrack(hls.audioTrack);
                    setSubtitleTracks(hls.subtitleTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Legenda ${index + 1}`,
                        lang: track.lang,
                    })));
                    // webOS 4: o <video> que sai do documento perde o pipeline
                    // de mídia (volta com readyState 0 e não sai mais — visto
                    // numa LG). O MESMO hls refaz só o MediaSource: sessão e
                    // conexão no painel continuam as mesmas (conta de 1 conexão)
                    if (movido && noWebOS()) hls.recoverMediaError();
                    if (autoPlay && video.paused) video.play().catch(() => { });
                }
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS support (no quality selection)
                video.src = src;
                if (autoPlay) {
                    video.addEventListener('loadedmetadata', () => {
                        video.play().catch(() => { });
                    }, { once: true });
                }
            }
        } else {
            // Direct video source (MP4, etc.)
            video.src = src;
            if (autoPlay) {
                video.addEventListener('loadedmetadata', () => {
                    video.play().catch(() => { });
                }, { once: true });
            }
        }

        return () => {
            const atual = hlsRef.current;
            if (atual && atual === adoptedRef.current && !reloadingRef.current) {
                // Pode ser só o StrictMode: estaciona por um tique em vez de matar
                releaseOwnListeners(atual);
                hlsRef.current = null;
                adoptParkedRef.current = {
                    hls: atual,
                    src,
                    timer: setTimeout(() => {
                        adoptParkedRef.current = null;
                        atual.destroy();
                    }, 0),
                };
            }
            cleanup();
            srcRef.current = '';
        };
     
        // `adopt` de fora das deps de propósito: ele só vale na primeira montagem
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, autoPlay, isLive, cleanup, destroyHlsInstance, videoRef, reloadTick]);

    /**
     * Entrega o pipeline vivo pra outro dono (prévia → player): sai do hook
     * sem ser destruído. Depois disto a limpeza deste hook não toca nele.
     */
    const handOff = useCallback((): Hls | null => {
        const hls = hlsRef.current;
        if (!hls) return null;
        releaseOwnListeners(hls);
        hlsRef.current = null;
        adoptedRef.current = null;
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        return hls;
    }, []);

    const retomar = useCallback((hls: Hls) => {
        retomadoRef.current = hls;
        srcRef.current = ''; // fura o guard de mesmo-src
        setReloadTick(t => t + 1);
    }, []);

    return {
        hlsRef,
        cleanup,
        reload,
        handOff,
        retomar,
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
    };
}
