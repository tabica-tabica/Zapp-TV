// webOS 4.x (Chromium 53) não tem ResizeObserver (Chrome 64) nem
// AbortController (Chrome 66) — ambos usados pelo app e pelo react-window.
//
// ResizeObserver: confere o tamanho dos elementos observados a cada 250ms e
// no resize da janela, e chama o callback só quando muda.
// ponytail: polling, não detecta na hora; trocar por @juggle/resize-observer
// se aparecer jank de layout na TV.
//
// AbortController: o fetch do Chromium 53
// ignora `signal`. Shim mínimo: o signal dispara 'abort' e o fetch embrulhado
// rejeita com AbortError — os timeouts de api.ts/speedTest continuam valendo
// (a requisição em si segue até a rede desistir; o chamador é que não espera).
// Em qualquer navegador moderno isto não faz nada.

type Listener = () => void;

if (typeof window !== 'undefined' && typeof window.AbortController === 'undefined') {
    class LegacyAbortSignal {
        aborted = false;
        onabort: Listener | null = null;
        private listeners: Listener[] = [];
        addEventListener(_type: string, fn: Listener) { this.listeners.push(fn); }
        removeEventListener(_type: string, fn: Listener) { this.listeners = this.listeners.filter(l => l !== fn); }
        dispatch() {
            if (this.aborted) return;
            this.aborted = true;
            this.onabort?.();
            this.listeners.slice().forEach(fn => fn());
        }
    }

    class LegacyAbortController {
        signal = new LegacyAbortSignal();
        abort() { this.signal.dispatch(); }
    }

    const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    const nativeFetch = window.fetch.bind(window);

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as unknown as LegacyAbortSignal | undefined;
        if (!signal) return nativeFetch(input, init);
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise<Response>((resolve, reject) => {
            const onAbort = () => reject(abortError());
            signal.addEventListener('abort', onAbort);
            nativeFetch(input, init).then(resolve, reject)
                .then(() => signal.removeEventListener('abort', onAbort));
        });
    };

    Object.assign(window, { AbortController: LegacyAbortController, AbortSignal: LegacyAbortSignal });
}

if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    type Entry = { target: Element; contentRect: DOMRectReadOnly };
    type Callback = (entries: Entry[], observer: unknown) => void;
    const observers = new Set<LegacyResizeObserver>();
    let timer: ReturnType<typeof setInterval> | null = null;
    // Aba/app em segundo plano: nada muda de tamanho que importe
    const checkAll = () => { if (!document.hidden) observers.forEach(o => o.check()); };

    class LegacyResizeObserver {
        private sizes = new Map<Element, string>();
        // clientWidth×clientHeight da última passada: igual → nem calcula estilo
        private brutos = new Map<Element, string>();
        private callback: Callback;
        constructor(callback: Callback) { this.callback = callback; }
        observe(el: Element) {
            this.sizes.set(el, '');
            observers.add(this);
            if (!timer) {
                // 1s (era 250ms): o único uso é a largura das grades, que só muda
                // com a janela (o 'resize' abaixo pega na hora) ou com a sidebar.
                // Cada passada força layout — 4×/s, pra sempre, pesava na TV.
                timer = setInterval(checkAll, 1000);
                window.addEventListener('resize', checkAll);
            }
            this.check();
        }
        unobserve(el: Element) {
            this.sizes.delete(el);
            this.brutos.delete(el);
            if (this.sizes.size === 0) this.disconnect();
        }
        disconnect() {
            this.sizes.clear();
            this.brutos.clear();
            observers.delete(this);
            if (observers.size === 0 && timer) {
                clearInterval(timer);
                timer = null;
                window.removeEventListener('resize', checkAll);
            }
        }
        check() {
            const changed: Entry[] = [];
            this.sizes.forEach((last, el) => {
                const html = el as HTMLElement;
                const bruto = html.clientWidth + 'x' + html.clientHeight;
                if (last && this.brutos.get(el) === bruto) return; // nada mudou: sem getComputedStyle
                this.brutos.set(el, bruto);
                // contentRect = caixa de conteúdo (sem padding/borda), como no nativo
                const style = getComputedStyle(el);
                const width = (el as HTMLElement).clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
                const height = (el as HTMLElement).clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
                const key = width + 'x' + height;
                if (key === last) return;
                this.sizes.set(el, key);
                const rect = { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height };
                changed.push({ target: el, contentRect: rect as DOMRectReadOnly });
            });
            if (changed.length) this.callback(changed, this);
        }
    }

    Object.assign(window, { ResizeObserver: LegacyResizeObserver });
}

// Element.scrollTo é do Chrome 61. O react-window rola a grade por ele (e pula
// em silêncio se não existir): no webOS 4 o foco descia pra cards que nunca
// entravam na tela. Sem `behavior: smooth` — pula direto, igual TV precisa.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function (this: Element, a?: ScrollToOptions | number, b?: number) {
        if (typeof a === 'object' && a !== null) {
            if (a.left != null) this.scrollLeft = a.left;
            if (a.top != null) this.scrollTop = a.top;
        } else {
            if (a != null) this.scrollLeft = a;
            if (b != null) this.scrollTop = b;
        }
    } as Element['scrollTo'];
}

export {};
