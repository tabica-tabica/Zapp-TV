import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import compat from 'eslint-plugin-compat'
import { POLYFILLS_TIZEN, POLYFILLS_WEBOS, POLYFILLS_DO_APP_WEBOS } from './scripts/tizen-polyfills.mjs'

// `npm run lint:webos`: mesmo lint contra o Chromium 53 do webOS (BROWSERSLIST
// no script) com a lista de polyfills DELE. O padrão segue o Tizen (chrome >= 69).
const alvoWebos = process.env.LINT_ALVO === 'webos'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // API de navegador nova demais pra TV. O build já cuida da SINTAXE
      // (build.target chrome69) e dos polyfills de LINGUAGEM (modernPolyfills
      // do plugin-legacy); o que ninguém cobria era API de DOM/BOM, que
      // core-js não polifila. `structuredClone`, `Element.replaceChildren` e
      // `navigator.clipboard` compilam, passam no navegador e explodem na TV.
      // O alvo vem do campo `browserslist` do package.json: chrome >= 69.
      compat.configs['flat/recommended'],
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      // O que o build do Tizen entrega polifilado. A lista é CONFERIDA contra o
      // bundle gerado em scripts/build-tizen.mjs — ver scripts/tizen-polyfills.mjs.
      polyfills: alvoWebos ? [...POLYFILLS_WEBOS.apis, ...POLYFILLS_DO_APP_WEBOS] : POLYFILLS_TIZEN.apis,
    },
  },
  {
    // Os testes rodam em node e jsdom, nunca na TV: cobrar deles a
    // compatibilidade com o Chromium 69 é ruído puro.
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/testing/**'],
    rules: {
      'compat/compat': 'off',
    },
  },
])
