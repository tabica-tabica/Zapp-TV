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
      // Piso: webOS 5.x (Chromium ~68-79) — mesmo raciocinio do Tizen, mirar
      // no dispositivo mais velho suportado nesta faixa, nao no mais novo.
      // O piso literal do spec (webOS 3.x, Chromium ~38) foi descartado por
      // decisao explicita: risco real de incompatibilidade com React 19.
      targets: ['chrome >= 68'],
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
    target: 'chrome68',
    outDir: 'dist-webos',
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
