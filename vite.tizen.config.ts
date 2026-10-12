import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { brandDefine, hlsLightNaTV } from './vite.define.ts'
import { POLYFILLS_TIZEN } from './scripts/tizen-polyfills.mjs'

// Samsung Tizen build: legacy browser support and a single app bundle.
export default defineConfig({
  define: brandDefine('tizen'),
  plugins: [
    react(),
    legacy({
      // O alvo real e o Chromium 69 do Tizen 5.5 (config.xml). Mirar em
      // 'chrome >= 50' + Safari carregava polyfill de coisa que a TV ja tem;
      // o que o 69 NAO tem e sintaxe nova (?. e ?? sao do Chrome 80), e disso
      // o plugin cuida transpilando.
      targets: ['chrome >= 69'],
      // UM bundle so. Com renderLegacyChunks o .wgt levava DUAS copias do app
      // inteiro (moderna + legacy, ~1 MB cada) porque o par module/nomodule
      // existe pra atender navegadores diferentes — e aqui o alvo e um so.
      renderLegacyChunks: false,
      // Sem os chunks legacy, os polyfills de BIBLIOTECA passam a ser
      // responsabilidade daqui: Object.fromEntries e do Chrome 73 e o codigo
      // usa (progressService). Sintaxe (?. e ?? sao do Chrome 80) quem resolve
      // e o build.target abaixo.
      // Lista explícita: `true` adivinhava pelo nome do método (ver scripts/tizen-polyfills.mjs)
      modernPolyfills: POLYFILLS_TIZEN.corejs,
    }),
  ],
  base: './',
  resolve: { alias: hlsLightNaTV },
  build: {
    // Chromium 69 = Tizen 5.5, o minimo declarado no config.xml
    target: 'chrome69',
    outDir: 'dist/tizen',
    minify: 'terser',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    terserOptions: {
      compress: {
        drop_console: true,
        passes: 2,
      },
    },
  },
})
