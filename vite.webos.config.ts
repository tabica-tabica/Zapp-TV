import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { brandDefine } from './vite.define.ts'

// LG webOS build: legacy browser support and a single app bundle.
export default defineConfig({
  define: brandDefine('webos'),
  plugins: [
    react(),
    legacy({
      // Piso: webOS 4.x (Chromium 53, TVs LG 2018) — testado num aparelho
      // real. APIs de DOM sem polyfill do core-js (AbortController,
      // ResizeObserver) ficam em src/legacyPolyfills.ts / fallback no hook.
      targets: ['chrome >= 53'],
      // Sem isto o plugin troca build.target pelo default moderno (chrome64)
      // e a sintaxe (spread, async) chega crua no Chromium 53.
      modernTargets: ['chrome >= 53'],
      // UM bundle so, mesmo motivo do Tizen: sem renderLegacyChunks o pacote
      // levaria DUAS copias do app inteiro (moderna + legacy).
      renderLegacyChunks: false,
      // Mesma faixa de Chromium do Tizen (68-79 vs 69) => mesmo polyfill de
      // biblioteca necessario (Object.fromEntries). Ver scripts/tizen-polyfills.mjs,
      // reaproveitado por scripts/build-webos.mjs.
      modernPolyfills: true,
    }),
  ],
  base: './',
  build: {
    target: 'chrome53',
    outDir: 'dist/webos',
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
