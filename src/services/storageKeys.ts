// Inventário único das chaves de armazenamento (item 84).
//
// Antes desta lista, as chaves viviam espalhadas por 15 serviços e eram
// RE-LISTADAS à mão em dataReset, profileScope, configSnapshot e backupService.
// Toda chave nova precisava ser lembrada em quatro lugares — e a que fosse
// esquecida virava dado órfão que nenhum reset alcançava (aconteceu com
// `neostream_config_snapshots` e `neostream_wizard_done` na R6).

/** Chaves de CREDENCIAL e identidade do aparelho. Nunca entram em backup. */
export const KEYS_CONTA = [
    'neostream_credentials',
    'neostream_playlists',
    'neostream_tv_profiles',
    'neostream_parental_pin',
    'neostream_parental_gates',
    'neostream_parental_lock',
    'neostream_account_info',
    'neostream_expiry_snooze',
    'neostream_settings',
    'neostream_tmdb_api_key',
    'neostream_opensubtitles_api_key',
    'neostream_opensubtitles_credentials',
    'neostream_opensubtitles_token',
    // Flags DA PLAYLIST ativa: o playlistService as reescreve a cada troca
    'includeTV',
    'includeVOD',
    // Estado do aparelho, não preferência
    'neostream_config_snapshots',
    'neostream_wizard_done',
    'neostream_scope_migrated',
    'neostream_scope_migrated_v2',
    'neostream_schema_version',
    // Flag curta "checar conteúdo novo no próximo boot" — vive só entre o
    // clique em "Recarregar lista" e o boot seguinte, nunca preferência
    'neostream_content_check_pending',
] as const;

/**
 * Chaves que vivem em sessionStorage, não em localStorage: morrem junto com a
 * sessão e por isso NÃO entram em reset, backup nem diagnóstico. Ficam
 * listadas aqui só para o teste de contrato saber que são deliberadas.
 */
export const KEYS_SESSAO = [
    'neostream_autoplay_last',
] as const;

/** Dado de QUEM assiste — vive por perfil (ver profileScope). */
export const KEYS_PROGRESSO = [
    'neostream_movie_progress',
    'neostream_series_progress',
    'neostream_usage_stats',
    'neostream_zap_history',
] as const;

export const KEYS_LISTAS = [
    // Ocultação de canais é decisão de QUEM assiste (e é a base do controle
    // parental na prática), não ajuste do aparelho
    'neostream_hidden_channels',
    'neostream_hidden_categories',
    'neostream_favorites',
    'neostream_watch_later',
    'neostream_fav_channel_order',
    'neostream_reminders',
    'neostream_last_channel',
    // Listas nomeadas do item 30. Chave NOVA: a lista padrao continua sendo
    // neostream_watch_later, byte por byte — zero migracao, zero risco
    'neostream_lists',
    // Lista secreta de adultos com momentos salvos. Aqui (e não em
    // preferências) de propósito: backup por QR e snapshot levam só as
    // preferências — a lista secreta nunca sai do aparelho
    'neostream_secret_list',
] as const;

/** Ajustes do aparelho: é isto que o snapshot e o backup por QR carregam. */
export const KEYS_PREFERENCIAS = [
    'neostream_theme_accent',
    'neostream_theme_bg',
    'neostream_a11y_contrast',
    'neostream_a11y_text_scale',
    'neostream_a11y_reduce_motion',
    'neostream_quality_by_content',
    'neostream_quality_cap',
    'neostream_subtitle_size',
    'neostream_subtitle_language',
    'neostream_player_stats',
    'neostream_player_volume',
    'neostream_playback_prefs',
    'neostream_aspect_prefs',
    'neostream_live_only_epg',
    'neostream_group_variants',
    'neostream_boot_last_channel',
    'neostream_hide_watched',
    'neostream_burnin_dimmer',
    'neostream_preview_muted',
    // BASELINE de "novos episódios": não é cache, perdê-la faz o app achar
    // que tudo é novidade
    'neostream_series_lastmod',
    // Liga/desliga o aviso de "conteúdo novo" no reload da playlist — a
    // checagem em si (newContentService) respeita esta chave antes de gastar
    // fetch
    'neostream_notify_new_content',
] as const;

// Só entra aqui o que volta sozinho de graça. O catálogo e o TMDB vêm por
// prefixo (PREFIXOS_CACHE).
export const KEYS_CACHE: readonly string[] = [];

/** Famílias com sufixo dinâmico (aba, playlist). */
export const PREFIXOS_PREFERENCIAS = [
    'neostream_sort_',
    'neostream_filters_',
    'neostream_epg_offset_',
    // Quais afiliadas/praças regionais o usuário quer ver, por playlist
    // (RedeTV! Guará/Imperial/Paraná etc.) — dado do CATÁLOGO do provedor,
    // não de quem assiste, por isso leva a playlist no nome, não o perfil.
    'neostream_regional_prefs_',
    // Categorias "ruído" (curiosidades/treino/câmeras/rádios/shows/24h etc.)
    // detectadas dinamicamente e canais individuais que o usuário
    // desocultou/ocultou — mesmo motivo do regional_prefs acima: dado do
    // catálogo do provedor, por playlist.
    'neostream_curated_unhidden_categories_',
    'neostream_curated_channel_overrides_',
    // BASELINE de "conteúdo novo" por playlist (ids de canais/filmes/séries
    // já vistos) — mesmo tipo de dado que `neostream_series_lastmod`: não é
    // cache (perdê-la faz o próximo reload achar que tudo é novidade), e
    // cresce demais pra caber no QR de backup (ver FORA_DO_QR_PREFIXOS em
    // backupService.ts)
    'neostream_content_snapshot_',
] as const;

export const PREFIXOS_CACHE = [
    'tmdb_',
    // O catálogo guardado leva o tipo e a playlist no nome da chave
    'neostream_catalog_cache',
] as const;

/** Sufixo que o escopo por perfil acrescenta às chaves de dado. */
export const SUFIXO_PERFIL = '__p_';

/** Toda chave conhecida — usada em conferências e no diagnóstico. */
export const TODAS_AS_BASES: readonly string[] = [
    ...KEYS_CONTA,
    ...KEYS_PROGRESSO,
    ...KEYS_LISTAS,
    ...KEYS_PREFERENCIAS,
    ...KEYS_CACHE,
];
