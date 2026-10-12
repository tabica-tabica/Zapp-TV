// Player da lista secreta: abre no momento salvo, marca momentos (🟢/📌),
// pula entre eles (CH+/CH−) e entre os filmes da lista (⏮/⏭).
//
// Diferente do MoviePlayer DE PROPÓSITO: não grava progresso nem estatística
// de uso — nada da lista secreta vaza pro Continuar Assistindo nem pro
// "Seu uso" das Configurações.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VideoPlayer, type MomentoDaFaixa } from './VideoPlayer';
import { api } from '../services/api';
import { secretList, firstMoment, type ItemSecreto } from '../services/secretList';
import { resolverUrlFinal } from '../services/urlFinal';

// URL final (ver services/urlFinal): toca com crossorigin pra poder capturar
// a miniatura do momento. Sem ela, o filme toca normal, só sem miniatura.
/**
 * URL final já resolvida (ou em resolução) por URL original. O redirect do
 * painel costuma levar token com prazo: passou da validade, resolve de novo.
 */
const VALIDADE_URL_MS = 90_000;
const cacheUrl = new Map<string, { p: Promise<string | null>; em: number }>();

const urlDoFilme = (filme: ItemSecreto) => api.getVodStreamUrl(Number(filme.id), filme.container || 'mp4');

/** Tempo com o foco PARADO numa miniatura antes de pré-carregar o filme dela */
const FOCO_PARADO_MS = 600;

function resolverComCache(src: string): Promise<string | null> {
    const c = cacheUrl.get(src);
    if (c && Date.now() - c.em < VALIDADE_URL_MS) return c.p;
    const p = resolverUrlFinal(src);
    cacheUrl.set(src, { p, em: Date.now() });
    return p;
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
    // Tira de miniaturas no player: desligada por padrão, e a escolha vale
    // pra sessão inteira (o VideoPlayer remonta a cada troca de filme)
    const [tiraVisivel, setTiraVisivel] = useState(false);
    // Escolheu na tira um momento de OUTRO filme: o player novo abre com o
    // foco nesse mesmo item da tira (⏮/⏭ zeram: foco volta pros botões)
    const [focoNaTira, setFocoNaTira] = useState<number | null>(null);
    // Miniaturas idem: a tira de momentos do player mostra as recém-marcadas
    const [miniaturas, setMiniaturas] = useState<Record<string, Record<string, string>>>(
        () => Object.fromEntries(itens.map(item => [item.id, item.thumbs ?? {}])),
    );
    const [inicio, setInicio] = useState<number | null>(
        () => momentoInicial ?? firstMoment(itens[indiceInicial]?.moments ?? []),
    );

    const item = itens[indice];
    const lista = item ? momentos[item.id] ?? [] : [];
    const srcOriginal = item ? urlDoFilme(item) : '';
    // undefined = resolvendo; null = sem URL final (toca a original, sem miniatura)
    const [resolvida, setResolvida] = useState<{ de: string; url: string | null } | undefined>(undefined);
    useEffect(() => {
        if (!srcOriginal) return;
        let ativo = true;
        resolverComCache(srcOriginal).then(url => { if (ativo) setResolvida({ de: srcOriginal, url }); });
        return () => { ativo = false; };
    }, [srcOriginal]);
    const pronta = resolvida?.de === srcOriginal ? resolvida : undefined;

    // Pré-carga em segundo plano, um pouco depois do filme atual começar (não
    // disputa a abertura dele):
    // - sempre o anterior e o próximo da lista (⏮/⏭);
    // - com a tira 🖼 ligada, também os vizinhos NA SEQUÊNCIA da tira: o filme
    //   com momento mais perto antes e depois (pula os sem momento, que não
    //   aparecem na tira).
    useEffect(() => {
        if (!pronta) return;
        const temMomento = (filme: ItemSecreto) => (momentos[filme.id] ?? []).length > 0;
        const alvos: Array<ItemSecreto | undefined> = [itens[indice - 1], itens[indice + 1]];
        if (tiraVisivel) {
            alvos.push(
                itens.slice(0, indice).reverse().find(temMomento),
                itens.slice(indice + 1).find(temMomento),
            );
        }
        const timer = setTimeout(() => {
            for (const filme of alvos) if (filme) void resolverComCache(urlDoFilme(filme));
        }, 3000);
        return () => clearTimeout(timer);
    }, [pronta, itens, indice, tiraVisivel, momentos]);

    // Foco parado numa miniatura de OUTRO filme: pré-carrega ele, pro OK
    // tocar na hora. Só com o foco parado — passear pela tira não dispara
    // um pedido por miniatura.
    const focoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focarNaSequencia = useCallback((m: MomentoDaFaixa) => {
        if (focoTimerRef.current) clearTimeout(focoTimerRef.current);
        if (m.doAtual) return;
        const filme = itens.find(f => f.id === m.filmeId);
        if (!filme) return;
        focoTimerRef.current = setTimeout(() => void resolverComCache(urlDoFilme(filme)), FOCO_PARADO_MS);
    }, [itens]);
    useEffect(() => () => { if (focoTimerRef.current) clearTimeout(focoTimerRef.current); }, []);

    // Troca de filme: no momento pedido (tira de momentos) ou no 1º salvo (⏮/⏭)
    const irPara = useCallback((novo: number, momento?: number, foco: number | null = null) => {
        const alvo = itens[novo];
        if (!alvo) return;
        setFocoNaTira(foco);
        setIndice(novo);
        setInicio(momento ?? firstMoment(momentos[alvo.id] ?? alvo.moments));
    }, [itens, momentos]);

    // Tira do player: os momentos de TODOS os filmes desta lista, em ordem
    const sequencia = useMemo<MomentoDaFaixa[]>(() => itens.flatMap(filme =>
        (momentos[filme.id] ?? []).map(t => ({
            filmeId: filme.id,
            titulo: filme.title,
            t,
            thumb: miniaturas[filme.id]?.[String(t)],
            doAtual: filme.id === item?.id,
        })),
    ), [itens, momentos, miniaturas, item?.id]);
    const escolherNaSequencia = useCallback((m: MomentoDaFaixa) => {
        const novo = itens.findIndex(filme => filme.id === m.filmeId);
        const foco = sequencia.findIndex(x => x.filmeId === m.filmeId && x.t === m.t);
        if (novo >= 0) irPara(novo, m.t, foco >= 0 ? foco : null);
    }, [itens, irPara, sequencia]);

    const marcar = useCallback((t: number, thumb?: string) => {
        if (!item) return;
        // Marcou = o filme MUDA pra lista secreta (entra nela e sai da Minha
        // Lista/listas visíveis). Momento só existe pra filme da lista.
        secretList.mover({ id: item.id, title: item.title, poster: item.poster, container: item.container });
        const nova = secretList.addMoment(item.id, t, thumb);
        setMomentos(atual => ({ ...atual, [item.id]: nova }));
        // Mesma chave do secretList (segundo inteiro); só se o momento entrou
        const chave = String(Math.max(0, Math.round(t)));
        if (thumb && nova.includes(Number(chave))) {
            setMiniaturas(atual => ({ ...atual, [item.id]: { ...atual[item.id], [chave]: thumb } }));
        }
    }, [item]);

    const desmarcar = useCallback((t: number) => {
        if (!item) return;
        const nova = secretList.removeMoment(item.id, t);
        setMomentos(atual => ({ ...atual, [item.id]: nova }));
    }, [item]);

    // Enquanto a URL final resolve (no máximo 5s), o player JÁ fica montado
    // com src vazio: HUD, título e tira de momentos continuam na tela (antes
    // era uma tela preta) e o próprio player mostra o "Carregando...". O src
    // entra uma vez só, quando resolve — sair do vazio não recomeça nada, e o
    // início no momento é aplicado no metadado do src novo.
    if (!item) return null;

    return (
        <VideoPlayer
            // Filme novo = player novo: zera seek, resume e o início exato
            key={item.id}
            src={pronta ? pronta.url ?? srcOriginal : ''}
            crossOrigin={pronta?.url ? 'anonymous' : undefined}
            title={item.title}
            poster={item.poster}
            autoPlay
            contentType="movie"
            startAt={inicio}
            moments={{
                list: lista,
                thumbs: miniaturas[item.id],
                onAdd: marcar,
                onRemove: desmarcar,
                sequencia,
                onEscolher: escolherNaSequencia,
                onFocar: focarNaSequencia,
                tiraVisivel,
                onAlternarTira: () => setTiraVisivel(v => !v),
                focoInicial: focoNaTira,
            }}
            canGoPrevious={indice > 0}
            canGoNext={indice < itens.length - 1}
            onPreviousEpisode={() => irPara(indice - 1)}
            onNextEpisode={() => irPara(indice + 1)}
            onClose={onClose}
        />
    );
}
