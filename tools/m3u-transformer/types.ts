// Tipos compartilhados pelo transformador de listas M3U.
// Espelha a estrutura sugerida em .agents/m3u-transformer.md §5, com um
// acréscimo (tvgName) porque a lista real quase sempre traz tvg-name e
// descartá-lo perderia informação que alguns players preferem à cauda do
// #EXTINF.

export type ContentType = 'live' | 'vod';

export type Audio = 'Dual Áudio' | 'Dublado' | 'Legendado' | 'Original' | 'Não especificado';

export type Quality = '4K' | 'FHD' | 'HD' | 'SD';

export interface M3UAttributes {
    tvgId?: string;
    tvgName?: string;
    tvgLogo?: string;
    groupTitle?: string;
}

export interface M3UEntry {
    raw: {
        /** Linha #EXTINF original, completa — só para depuração; a saída é regerada. */
        extinf: string;
        url: string;
    };
    attributes: M3UAttributes;
    /** Texto após a vírgula no #EXTINF original, sem normalização. */
    title: string;
    contentType: ContentType;
    /** Título sem os tokens de áudio/qualidade identificados. */
    rootTitle: string;
    audio: Audio;
    quality: Quality;
    /** Casou algum padrão de conteúdo adulto (título ou group-title) — ver adult.ts. */
    isAdult: boolean;
}

/** Override manual de classificação de tipo — spec §2.1. */
export interface TypeOverride {
    /** Testado contra a URL e contra o título; a primeira que casar decide. */
    pattern: RegExp;
    type: ContentType;
}

export interface TransformOptions {
    defaultGroupVod: string;
    defaultGroupLive: string;
    typeOverrides?: TypeOverride[];
}

export interface ClassificationReport {
    totalInput: number;
    duplicatesRemoved: number;
    totalOutput: number;
    groups: number;
    byContentType: Record<ContentType, number>;
    byQuality: Record<Quality, number>;
    byAudio: Record<Audio, number>;
    /** Nem qualidade nem áudio foram identificados — caiu nos dois defaults. */
    fullyUnclassified: M3UEntry[];
    /** Quantos itens casaram algum padrão de conteúdo adulto (ver adult.ts). */
    adultCount: number;
    /** Amostra (até SAMPLE_SIZE) dos itens marcados como adulto, pra revisão manual. */
    adultSample: M3UEntry[];
}
