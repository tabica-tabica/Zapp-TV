import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { brandDefine } from './vite.define.ts'

// Desktop build (Tauri, Windows/Linux): a janela do Tauri é WebView2/
// WebKitGTK moderno, então não precisa da transpilação legacy do Tizen/webOS
// — mas serve o front-end via protocolo local, não HTTP com raiz absoluta,
// então `base: './'` é obrigatório (mesmo motivo do tizen/webos).
export default defineConfig({
  define: brandDefine('tauri'),
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/tauri',
    minify: 'terser',
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
