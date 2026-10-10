// Failover de qualidade fora da TV ao vivo (Favoritos, Busca): o stream caiu
// → toca a próxima variante do mesmo canal (HD → FHD → ... → SD).
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { variantBaseName, variantGroup } from '../services/channelVariants';
import type { LiveStream } from '../types';

export function useVariantFailover(
    current: { stream_id: number | string; name: string } | null,
    play: (next: LiveStream) => void,
) {
    const [siblings, setSiblings] = useState<LiveStream[]>([]);
    // Chave pela raiz: trocar HD → FHD não recarrega a lista
    const base = current ? variantBaseName(current.name) : '';
    const name = current?.name ?? '';

    useEffect(() => {
        if (!base) return;
        let alive = true;
        // getLiveStreams vem do cache em memória do api — sem rede extra
        api.getLiveStreams()
            .then(all => { if (alive) setSiblings(variantGroup(all, name)); })
            .catch(() => { if (alive) setSiblings([]); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só a raiz importa
    }, [base]);

    const index = current ? siblings.findIndex(c => String(c.stream_id) === String(current.stream_id)) : -1;
    const next = index >= 0 ? siblings[index + 1] : undefined;
    return next
        ? { onStreamFailed: () => play(next), maxReconnectAttempts: FAILOVER_RECONNECT_ATTEMPTS }
        : {};
}

/** Com outra variante pra tentar, 1 reconexão (2s) basta antes de trocar. */
export const FAILOVER_RECONNECT_ATTEMPTS = 1;
