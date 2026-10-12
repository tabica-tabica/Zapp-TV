import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { brandDefine } from './vite.define.ts'

// Modern web build used for browser preview/development.
export default defineConfig({
  define: brandDefine('web'),
  plugins: [
    react(),
    // Plugin de proxy para desenvolvimento web local no navegador:
    // Evita bloqueio de CORS em redirecionamentos (ex: 301 sem Access-Control-Allow-Origin).
    {
      name: 'dev-cors-proxy',
      configureServer(server) {
        // Streams: o 1º 301 do painel não tem CORS, os
        // seguintes têm. Segue a cadeia no Node e devolve 302 pra URL final —
        // o hls.js resolve os segmentos relativos a partir dela.
        server.middlewares.use('/stream-redirect', async (req, res) => {
          try {
            const targetUrl = new URL(req.url || '', 'http://localhost').searchParams.get('url');
            if (!targetUrl) {
              res.statusCode = 400;
              res.end('Missing url parameter');
              return;
            }
            const response = await fetch(targetUrl);
            await response.body?.cancel();
            res.writeHead(302, { Location: response.url, 'Access-Control-Allow-Origin': '*' });
            res.end();
          } catch (err: unknown) {
            res.statusCode = 502;
            res.end(err instanceof Error ? err.message : 'Proxy error');
          }
        });
        server.middlewares.use('/api-proxy', async (req, res) => {
          try {
            const reqUrl = new URL(req.url || '', 'http://localhost');
            const targetUrl = reqUrl.searchParams.get('url');
            if (!targetUrl) {
              res.statusCode = 400;
              res.end('Missing url parameter');
              return;
            }

            const response = await fetch(targetUrl, {
              headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              },
            });

            res.statusCode = response.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            const contentType = response.headers.get('content-type');
            if (contentType) res.setHeader('Content-Type', contentType);

            const buffer = Buffer.from(await response.arrayBuffer());
            res.end(buffer);
          } catch (err: unknown) {
            res.statusCode = 502;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(err instanceof Error ? err.message : 'Proxy error');
          }
        });
      },
    },
    // Inspecao humana ad hoc da composicao do bundle: `ANALYZE=true npm run build:web`.
    // Nao substitui scripts/check-bundle-budget.mjs (que mede gzip real e falha o CI) —
    // este e so pra abrir o treemap e olhar o que esta pesando.
    ...(process.env.ANALYZE ? [visualizer({ open: true, gzipSize: true, brotliSize: true })] : []),
  ],
  build: {
    outDir: 'dist/web',
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
