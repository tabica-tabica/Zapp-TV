// Reaproveita a MESMA cadeia de visibilidade que a grade de TV ao Vivo usa
// (`src/pages/LiveTV.tsx`) — ocultação manual, categorias adultas,
// categorias "ruído"/"só com tag de qualidade" curadas, agrupamento de
// variantes de qualidade, dedup de afiliadas regionais/redes nacionais —
// mas chamável de FORA da página, sem montar a grade inteira (ex.: sortear
// uma sugestão de canal na Home). Não duplica REGRA nenhuma, só reorganiza
// as mesmas peças já testadas em `LiveTV.tsx` pra serem usadas isoladas.
// Ver docs/LIVE_TV_FILTERING_SPEC.md pro desenho completo da pipeline —
// a ORDEM abaixo replica a de lá de propósito (mudar uma sem mudar a outra
// é o tipo de deriva que esta função existe pra evitar).
//
// `LiveTV.tsx` continua com sua própria cadeia inline (tem filtros extras,
// específicos da página: busca, categoria selecionada, só-EPG, favoritos) —
// não foi refatorada pra usar isto, pra não arriscar a pipeline que acabou
// de ser testada a fundo. Unificar as duas é um refactor futuro possível,
// não parte desta mudança.

import { hiddenChannels, hiddenCategories } from './liveExtras';
import { isAdultCategoryName } from './kidsFilter';
import {
    detectJunkCategories, detectQualityOnlyCategories, isQualityTaggedChannel,
    curatedHiddenPrefs, computeEffectiveVisibility, type DetectedGroup,
} from './curatedHiddenGroups';
import { groupChannelVariants } from './channelVariants';
import { detectRegionalFamilies, detectCategoryFamilies } from './regionalVariants';
import { regionalPrefs } from './regionalPrefs';

export interface VisibilityCheckChannel {
    stream_id: number;
    name: string;
    category_id: string;
    stream_icon?: string;
}

const EMPTY_QUALITY_ONLY = new Map<string, DetectedGroup>();

/**
 * Canais que ficam visíveis por padrão na grade de TV ao Vivo, dado o
 * catálogo (canais + categorias) da playlist ativa. Mesma pipeline, mesma
 * ordem, mesmo estado persistido (`curatedHiddenPrefs`, `regionalPrefs`,
 * `hiddenChannels`/`hiddenCategories`) que `LiveTV.tsx` usa pra montar a
 * grade — o resultado aqui é o mesmo conjunto de "representantes" que
 * apareceriam lá com os filtros de página (busca, categoria, só-EPG etc.)
 * todos desligados.
 */
export function computeDefaultVisibleChannels<T extends VisibilityCheckChannel>(
    streams: T[],
    categories: Array<{ category_id: string; category_name: string }>,
): T[] {
    // Ocultação manual (por perfil) — qualquer canal/categoria que o
    // usuário escondeu na mão, independente de curadoria.
    const hiddenIds = hiddenChannels.get();
    const hiddenCatIds = hiddenCategories.get();
    let list = streams.filter(s => !hiddenIds.has(s.stream_id) && !hiddenCatIds.has(s.category_id));

    // Categorias adultas NUNCA entram numa sugestão automática — sem
    // checar estado de PIN nenhum, é uma exclusão incondicional aqui.
    const adultCatIds = new Set(
        categories.filter(c => isAdultCategoryName(c.category_name || '')).map(c => c.category_id)
    );
    if (adultCatIds.size > 0) {
        list = list.filter(s => !adultCatIds.has(s.category_id));
    }

    // Categorias "ruído" curadas (dinâmicas, ver curatedHiddenGroups.ts) +
    // exceção individual. "Só com tag de qualidade" NÃO entra aqui de
    // propósito — roda depois do agrupamento, mesma razão do bug do GNT
    // documentado no spec (senão perde a chance de virar fallback).
    const junkGroupsByCategory = new Map(detectJunkCategories(categories).map(g => [g.categoryId, g]));
    const unhiddenGroups = curatedHiddenPrefs.getUnhiddenGroups();
    const overrides = curatedHiddenPrefs.getChannelOverrides();
    list = list.filter(s => curatedHiddenPrefs.isVisible(
        s.name, s.category_id, s.stream_id, junkGroupsByCategory, unhiddenGroups, EMPTY_QUALITY_ONLY, overrides
    ));

    // Agrupamento de variantes de qualidade (FHD/HD/SD/4K, Legendado,
    // servidor espelhado, acento...) — só os representantes seguem adiante.
    const { groups } = groupChannelVariants(list);

    // "Só com tag de qualidade" (Esportes/Variedades) — AGORA sim, no
    // representante de cada grupo.
    const qualityOnlyByCategory = new Map(detectQualityOnlyCategories(categories).map(g => [g.categoryId, g]));
    let visible = groups;
    if (qualityOnlyByCategory.size > 0) {
        visible = groups.filter(s => {
            if (!qualityOnlyByCategory.has(s.category_id)) return true;
            const defaultVisible = isQualityTaggedChannel(s.name);
            return computeEffectiveVisibility(s.stream_id, defaultVisible, overrides);
        });
    }

    // Dedup de afiliadas regionais (por nome) e redes nacionais (por
    // categoria inteira) — só a variante selecionada de cada família segue.
    const families = detectRegionalFamilies(visible);
    const categoryFamilies = detectCategoryFamilies(visible, categories);
    if (families.size === 0 && categoryFamilies.size === 0) return visible;
    const hiddenByFamily = new Set<number | string>();
    for (const [familyKey, members] of [...families, ...categoryFamilies]) {
        const selected = regionalPrefs.getSelected(familyKey, members[0].stream_id);
        for (const member of members) {
            if (!selected.has(member.stream_id)) hiddenByFamily.add(member.stream_id);
        }
    }
    if (hiddenByFamily.size === 0) return visible;
    return visible.filter(s => !hiddenByFamily.has(s.stream_id));
}
