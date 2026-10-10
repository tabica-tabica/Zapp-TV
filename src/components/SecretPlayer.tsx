// Player da lista secreta: abre no momento salvo, marca momentos (🟢/📌),
// pula entre eles (CH+/CH−) e entre os filmes da lista (⏮/⏭).
//
// Diferente do MoviePlayer DE PROPÓSITO: não grava progresso nem estatística
// de uso — nada da lista secreta vaza pro Continuar Assistindo nem pro
// "Seu uso" das Configurações.

import { useCallback, useEffect, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { api } from '../services/api';
import { secretList, firstMoment, type ItemSecreto } from '../services/secretList';

/**
 * URL final do filme (depois do redirect do painel), pra tocar com
 * crossorigin e poder capturar a miniatura do momento. O 1º salto do provedor
 * vem SEM CORS — com crossorigin direto nele o vídeo nem carrega. Quem segue o
 * redirect: no dev, o proxy do Vite; no desktop, o fetch roteado pelo Rust
 * (tauri-plugin-http). Se não der (TV sem permissão, rede), devolve null e o
 * filme toca normal, só sem miniatura.
 */
async function resolverUrlFinal(src: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const alvo = import.meta.env.DEV ? `/stream-redirect?url=${encodeURIComponent(src)}` : src;
        const resposta = await fetch(alvo, { signal: controller.signal });
        await resposta.body?.cancel();
        const final = resposta.url;
        return resposta.ok && /^https?:/i.test(final) && !final.startsWith(window.location.origin) ? final : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

interface SecretPlayerProps {
    /** Lista no momento em que o player abriu (a ordem de ⏮/⏭) */
    itens: ItemSecreto[];
    indiceInicial: number;
    /** Momento escolhido na lista; sem ele, abre no primeiro momento salvo */
    momentoInicial?: number | null;
    onClose: () => void;
}

export function SecretPlayer({ itens, indiceInicial, momentoInicial, onClose }: SecretPlayerProps) {
    const [indice, setIndice] = useState(indiceInicial);
    // Momentos ao vivo de cada filme desta sessão (o que foi marcado agora)
    const [momentos, setMomentos] = useState<Record<string, number[]>>(
        () => Object.fromEntries(itens.map(item => [item.id, item.moments])),
    );
    const [inicio, setInicio] = useState<number | null>(
        () => momentoInicial ?? firstMoment(itens[indiceInicial]?.moments ?? []),
    );

    const item = itens[indice];
    const lista = item ? momentos[item.id] ?? [] : [];
    const srcOriginal = item ? api.getVodStreamUrl(Number(item.id), item.container || 'mp4') : '';
    // undefined = resolvendo; null = sem URL final (toca a original, sem miniatura)
    const [resolvida, setResolvida] = useState<{ de: string; url: string | null } | undefined>(undefined);
    useEffect(() => {
        if (!srcOriginal) return;
        let ativo = true;
        resolverUrlFinal(srcOriginal).then(url => { if (ativo) setResolvida({ de: srcOriginal, url }); });
        return () => { ativo = false; };
    }, [srcOriginal]);
    const pronta = resolvida?.de === srcOriginal ? resolvida : undefined;

    const irPara = useCallback((novo: number) => {
        const alvo = itens[novo];
        if (!alvo) return;
        setIndice(novo);
        setInicio(firstMoment(momentos[alvo.id] ?? alvo.moments));
    }, [itens, momentos]);

    const marcar = useCallback((t: number, thumb?: string) => {
        if (!item) return;
        const nova = secretList.addMoment(item.id, t, thumb);
        setMomentos(atual => ({ ...atual, [item.id]: nova }));
    }, [item]);

    // Até resolver (no máximo 5s) não monta o player: trocar o src depois
    // recomeçaria o filme e perderia o início no momento
    if (!item || !pronta) return null;

    return (
        <VideoPlayer
            // Filme novo = player novo: zera seek, resume e o início exato
            key={item.id}
            src={pronta.url ?? srcOriginal}
            crossOrigin={pronta.url ? 'anonymous' : undefined}
            title={item.title}
            poster={item.poster}
            autoPlay
            contentType="movie"
            startAt={inicio}
            moments={{ list: lista, onAdd: marcar }}
            canGoPrevious={indice > 0}
            canGoNext={indice < itens.length - 1}
            onPreviousEpisode={() => irPara(indice - 1)}
            onNextEpisode={() => irPara(indice + 1)}
            onClose={onClose}
        />
    );
}
