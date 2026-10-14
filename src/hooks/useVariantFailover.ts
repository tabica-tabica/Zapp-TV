// Failover de qualidade fora da TV ao vivo (Busca): o stream caiu → toca
// outra variante do mesmo canal. Mesma escolha da TV ao Vivo
// (proximaVariante): qualquer variante que sobrar, maior OU menor (HD fora
// com 4K no ar vai pra 4K), dando a volta, pulando as que já falharam e indo
// primeiro na de melhor histórico. Antes só andava pra frente na lista: quem
// começava na FHD nunca tentava a HD, e a falhada voltava na roda.
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { proximaVariante, variantBaseName, variantGroup } from '../services/channelVariants';
import { liveHealth } from '../services/liveHealth';
import type { LiveStream } from '../types';

export function useVariantFailover(
    current: { stream_id: number | string; name: string } | null,
    play: (next: LiveStream) => void,
) {
    const [siblings, setSiblings] = useState<LiveStream[]>([]);
    // Falhas desta sessão, por canal (raiz): outro canal começa do zero
    const [falhas, setFalhas] = useState<{ base: string; ids: number[] }>({ base: '', ids: [] });
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

    if (!current) return {};
    const atualId = Number(current.stream_id);
    const falharam = new Set(falhas.base === base ? falhas.ids : []).add(atualId);
    const next = proximaVariante(siblings, atualId, falharam, liveHealth);
    return next
        ? {
            onStreamFailed: (porLimite?: boolean) => {
                // Painel recusando por limite: outra variante seria mais uma
                // conexão numa conta já estourada (mesma salvaguarda da TV ao Vivo)
                if (porLimite) return;
                liveHealth.registrar(atualId, 'falha');
                setFalhas({ base, ids: [...falharam] });
                play(next);
            },
            maxReconnectAttempts: FAILOVER_RECONNECT_ATTEMPTS,
        }
        : {};
}

/** Com outra variante pra tentar, 1 reconexão (2s) basta antes de trocar. */
export const FAILOVER_RECONNECT_ATTEMPTS = 1;
