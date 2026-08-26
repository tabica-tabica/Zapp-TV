// Recarregar lista (Configurações > Playlists e a sidebar): limpa o catálogo
// e o EPG em cache da playlist ativa e recarrega o app. É assim que a
// "migração" de classificação (agrupamento de qualidade, filtro infantil,
// variantes regionais) roda de novo com dados frescos do Xtream — sem
// depender de nenhuma ponte com a CLI (tools/m3u-transformer), que não
// existe a partir do app rodando.

import { dropCatalog, type CatalogKind } from './catalogCache';
import { epgService } from './epgService';
import { newContentService } from './newContentService';

const CATALOG_KINDS: readonly CatalogKind[] = ['live', 'live-cats', 'vod', 'vod-cats', 'series', 'series-cats'];

export function reloadActivePlaylist(): void {
    // Marca "checar conteúdo novo no próximo boot" ANTES de recarregar — o
    // diff roda depois do reload (App.tsx), não aqui, pra não duplicar o
    // fetch que a página de destino já vai fazer sozinha.
    newContentService.markPendingCheck();
    CATALOG_KINDS.forEach(dropCatalog);
    epgService.clearCache();
    window.location.reload();
}
