// URL final de um stream do painel, depois do redirect (com o ?token= da
// SESSÃO aberta). Tocar por ela reaproveita a sessão já aberta em vez de
// abrir outra — e abrir de antemão deixa a troca de fonte rápida.
//
// O 1º salto do provedor vem SEM CORS: no dev quem segue o redirect é o proxy
// do Vite (/stream-redirect); fora dele, o próprio fetch. Se não der (TV sem
// permissão, rede), devolve null e quem chamou usa a URL original.

export async function resolverUrlFinal(src: string, timeoutMs = 5000): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
