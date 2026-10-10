// Player da lista secreta: abre no momento salvo, marca momentos (🟢/📌),
// pula entre eles (CH+/CH−) e entre os filmes da lista (⏮/⏭).
//
// Diferente do MoviePlayer DE PROPÓSITO: não grava progresso nem estatística
// de uso — nada da lista secreta vaza pro Continuar Assistindo nem pro
// "Seu uso" das Configurações.

import { useCallback, useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { api } from '../services/api';
import { secretList, firstMoment, type ItemSecreto } from '../services/secretList';

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

    const irPara = useCallback((novo: number) => {
        const alvo = itens[novo];
        if (!alvo) return;
        setIndice(novo);
        setInicio(firstMoment(momentos[alvo.id] ?? alvo.moments));
    }, [itens, momentos]);

    const marcar = useCallback((t: number) => {
        if (!item) return;
        const nova = secretList.addMoment(item.id, t);
        setMomentos(atual => ({ ...atual, [item.id]: nova }));
    }, [item]);

    if (!item) return null;

    return (
        <VideoPlayer
            // Filme novo = player novo: zera seek, resume e o início exato
            key={item.id}
            src={api.getVodStreamUrl(Number(item.id), item.container || 'mp4')}
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
