// Logos de canal que falharam, por URL, valendo entre visitas às páginas.
//
// O host das logos responde 429 (no-store) pra TV — e só pra ela: o PC na
// mesma rede recebe 200 nas mesmas URLs (visto em 14/10/2026). As que dão
// certo ficam no cache HTTP por 1 ano; as que falham eram pedidas DE NOVO a
// cada visita à TV ao Vivo (o Set de quebradas morre com a página), dezenas
// por vez, e a TV nunca saía do limite. Aqui a falha vale por um tempo.
const ESPERA_MS = 30 * 60 * 1000;
const falhas = new Map<string, number>();

export function logoFalhou(url: string | undefined | null, agora = Date.now()): void {
    if (url) falhas.set(url, agora);
}

/** Falhou há pouco: não pede de novo, mostra o placeholder. */
export function logoEmEspera(url: string | undefined | null, agora = Date.now()): boolean {
    if (!url) return false;
    const quando = falhas.get(url);
    if (quando == null) return false;
    if (agora - quando < ESPERA_MS) return true;
    falhas.delete(url);
    return false;
}
