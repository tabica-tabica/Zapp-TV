// Stream ao vivo TOCANDO estacionado entre páginas (Home ⇄ TV ao Vivo).
//
// Conta de 1 conexão: fechar a prévia da Home e abrir o mesmo canal na TV ao
// Vivo esbarrava no painel, que segue contando a conexão fechada por ~20s+ e
// recusava a nova. Em vez de fechar, a página que sai ESTACIONA o pipeline
// (<video> + hls.js) e a que entra assume o MESMO — mesma sessão, nenhuma
// conexão a mais. Só a SAÍDA de página estaciona: trocar de canal dentro da
// página fecha na hora (estacionar ali seguraria uma conexão a mais).
//
// Ninguém pegou em VALIDADE_MS → destrói. Reentrega por REENTREGA_MS: o
// StrictMode do dev roda o inicializador duas vezes e a segunda chamada
// precisa receber o mesmo pipeline.

import type { LivePipeline } from '../components/LiveChannelPreview';
import type { LiveStream } from '../types';

const VALIDADE_MS = 8000;
const REENTREGA_MS = 2000;

let atual: { id: number; pipeline: LivePipeline; canal: LiveStream | null; timer: ReturnType<typeof setTimeout>; entregueEm: number } | null = null;

// Quem quer saber que um canal foi estacionado (useSyncExternalStore na Home:
// a TV ao Vivo estaciona na desmontagem, DEPOIS de a Home já ter renderizado)
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach(ouvinte => ouvinte());

function destruir(p: LivePipeline): void {
    try { p.hls.destroy(); } catch { /* já destruído */ }
    p.video.pause();
    p.video.removeAttribute('src');
    p.video.load();
}

export const pipelineEstacionado = {
    /**
     * Página saindo: guarda o pipeline tocando desse canal (o anterior, se
     * houver, morre). Com `canal`, a página que entra já monta a prévia dele
     * antes do próprio catálogo chegar (a Home espera VOD e séries também).
     */
    estacionar(id: number, pipeline: LivePipeline, canal: LiveStream | null = null): void {
        this.descartar();
        const timer = setTimeout(() => {
            if (atual?.pipeline !== pipeline) return;
            if (!atual.entregueEm) destruir(pipeline);
            atual = null;
            avisar();
        }, VALIDADE_MS);
        atual = { id, pipeline, canal, timer, entregueEm: 0 };
        avisar();
    },

    /** Pra useSyncExternalStore */
    assinar(ouvinte: () => void): () => void {
        ouvintes.add(ouvinte);
        return () => { ouvintes.delete(ouvinte); };
    },

    /**
     * Snapshot pra useSyncExternalStore: o canal estacionado (mesmo depois de
     * entregue, enquanto estiver na janela). Quem usa deve guardar o valor no
     * próprio estado — ele vira null quando o estacionamento acaba.
     */
    canalEstacionado(): LiveStream | null {
        return atual?.canal ?? null;
    },

    /** Canal do pipeline à espera (ainda não entregue), pra a página que entra pré-selecionar. */
    canal(): number | null {
        return atual && !atual.entregueEm ? atual.id : null;
    },

    /** Assume o pipeline desse canal (null se não há, é outro canal, ou já foi entregue há mais de REENTREGA_MS). */
    retirar(id: number): LivePipeline | null {
        if (!atual || atual.id !== id) return null;
        const agora = Date.now();
        if (atual.entregueEm && agora - atual.entregueEm > REENTREGA_MS) return null;
        if (!atual.entregueEm) {
            clearTimeout(atual.timer);
            atual.entregueEm = agora;
            const entregue = atual.pipeline;
            atual.timer = setTimeout(() => {
                if (atual?.pipeline !== entregue) return;
                atual = null;
                avisar();
            }, REENTREGA_MS);
        }
        return atual.pipeline;
    },

    /** Joga fora o que estiver esperando (sem dono = destrói). */
    descartar(): void {
        if (!atual) return;
        clearTimeout(atual.timer);
        if (!atual.entregueEm) destruir(atual.pipeline);
        atual = null;
        avisar();
    },
};
