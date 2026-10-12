// O que o build do Tizen POLIFILA — declarado num lugar só.
//
// Duas coisas leem esta lista, e é isso que a torna confiável:
//
//  1. `eslint.config.js` a entrega ao eslint-plugin-compat como `settings.polyfills`.
//     Sem ela o lint acusa `Object.fromEntries` (Chrome 73) como incompatível com o
//     Chromium 69 da TV — e estaria certo, se o build não o polifilasse.
//
//  2. `scripts/build-tizen.mjs` CONFERE, no bundle recém-gerado, que cada nome daqui
//     realmente aparece no polyfills.js. Sem essa conferência a lista viraria uma
//     promessa: bastaria alguém mexer no `modernPolyfills` do vite.tizen.config.ts pra
//     ela passar a silenciar um erro de verdade, em silêncio.
//
// REGRA PARA ACRESCENTAR UM NOME AQUI: rode `npm run build:tizen` e confirme que ele
// aparece em `tizen/assets/polyfills.js`. Se não aparecer, o problema é real — conserte
// o código, não a lista.
//
// E o que NÃO entra aqui: API de DOM/BOM. O core-js polifila built-in de LINGUAGEM;
// `structuredClone`, `Element.replaceChildren`, `navigator.clipboard` e afins não têm
// polyfill nenhum e simplesmente não existem na TV. É justamente para pegá-los que o
// eslint-plugin-compat vale a pena.

// LISTA EXPLÍCITA (12/10/2026): com `modernPolyfills: true` o core-js adivinhava
// pelo NOME do método (`.map`, `.with`, `.union`...) e mandava 91 módulos /
// 123 KB pro webOS — iterator helpers, métodos novos de Set, base64, e até um
// URL inteiro em JS no lugar do nativo. O bundle (app + bibliotecas) usa só o
// que está aqui; conferido com grep no index.js gerado e com `npm run lint:webos`.
//
// `corejs`: módulos passados ao `modernPolyfills` de cada vite.*.config.ts.
// `apis`: os mesmos, pelo nome que o eslint-plugin-compat e a conferência do
// build usam.
//
// es.array.sort: antes do Chrome 70 o sort do V8 NÃO é estável (>10 itens), e
// o código conta com isso no empate (ex.: melhorVariante).

/** Tizen (Chromium 69). */
export const POLYFILLS_TIZEN = {
    corejs: ['es.object.from-entries', 'es.array.sort'],
    apis: ['Object.fromEntries'],
};

/** LG webOS 4 (Chromium 53). */
export const POLYFILLS_WEBOS = {
    corejs: [
        ...POLYFILLS_TIZEN.corejs,
        'es.object.values', // Chrome 54
        'es.object.entries', // 54
        'es.object.get-own-property-descriptors', // 54 — helper de spread do esbuild
        'es.string.pad-start', // 57
        'es.promise.finally', // 63
        'es.array.flat-map', // 69
        'es.array.unscopables.flat-map',
    ],
    apis: [
        ...POLYFILLS_TIZEN.apis,
        'Object.values',
        'Object.entries',
        'Object.getOwnPropertyDescriptors',
        'String.padStart', // o eslint-plugin-compat nomeia método de instância assim
        'Promise.prototype.finally',
        'Array.flatMap',
    ],
};

/**
 * Polifilados pelo PRÓPRIO app (src/legacyPolyfills.ts), não pelo core-js: só
 * pro lint do webOS — não entram na conferência do polyfills.js.
 */
export const POLYFILLS_DO_APP_WEBOS = ['ResizeObserver', 'AbortController', 'Element.prototype.scrollTo'];

/** Compatibilidade: o lint padrão segue o alvo do Tizen (package.json browserslist). */
export const POLYFILLS_DO_BUILD = POLYFILLS_TIZEN.apis;

/**
 * Como cada nome aparece dentro do bundle minificado. O core-js define o método
 * pelo nome literal (`{fromEntries: function...}`), então basta a última parte —
 * mas guardamos o par explícito pra conferência não virar adivinhação.
 */
export const MARCA_NO_BUNDLE = {
    'Object.fromEntries': 'fromEntries',
    'Object.values': 'values',
    'Object.entries': 'entries',
    'Object.getOwnPropertyDescriptors': 'getOwnPropertyDescriptors',
    'String.padStart': 'padStart',
    'Promise.prototype.finally': 'finally',
    'Array.flatMap': 'flatMap',
};
