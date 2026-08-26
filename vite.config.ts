import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { brandDefine } from './vite.define.ts'

// Modern web build used for browser preview/development.
export default defineConfig({
  define: brandDefine('web'),
  plugins: [
    react(),
    // Inspecao humana ad hoc da composicao do bundle: `ANALYZE=true npm run build:web`.
    // Nao substitui scripts/check-bundle-budget.mjs (que mede gzip real e falha o CI) —
    // este e so pra abrir o treemap e olhar o que esta pesando.
    ...(process.env.ANALYZE ? [visualizer({ open: true, gzipSize: true, brotliSize: true })] : []),
  ],
  build: {
    minify: 'terser',
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          media: ['hls.js'],
          icons: ['react-icons/fa'],
        },
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
