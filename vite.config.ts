import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * Mount the Express API as Vite middleware so the whole app runs on ONE port (3001).
 *
 * This kills an entire class of bugs we kept hitting:
 *   - Vite proxy port drifting from server.ts port → silent 404s on /api/* → "auto-ingest broken"
 *   - EADDRINUSE / TIME_WAIT pain on Windows when restarting the standalone Express server
 *   - Two `concurrently` processes that have to agree on a port number to function
 *
 * server.ts exports `app`. We import it via `ssrLoadModule` (so Vite handles the TS transform),
 * then plug it into Vite's connect-style middleware chain. Express handles /api/* routes;
 * everything else falls through to Vite's static/HMR handler.
 */
function expressApiPlugin(): Plugin {
  return {
    name: 'express-api',
    async configureServer(server: ViteDevServer) {
      const mod = await server.ssrLoadModule('./server.ts');
      if (!mod.app) {
        throw new Error('expressApiPlugin: server.ts did not export `app`');
      }
      server.middlewares.use(mod.app);
      console.log('\n🔌 Express API mounted into Vite — single port, no proxy.\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), expressApiPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.OPENROUTER_KEY': JSON.stringify(env.OPENROUTER_KEY),
      'process.env.OPENROUTER_MODEL': JSON.stringify(env.OPENROUTER_MODEL),
      'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
      'process.env.SUPABASE_KEY': JSON.stringify(env.SUPABASE_KEY),
      'process.env.OLLAMA_URL': JSON.stringify(env.OLLAMA_URL),
      'process.env.OLLAMA_MODEL': JSON.stringify(env.OLLAMA_MODEL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
              if (id.includes('pdfjs-dist')) return 'pdf-vendor';
              if (id.includes('@google/genai')) return 'ai-vendor';
              if (id.includes('@supabase/supabase-js')) return 'supabase-vendor';
              if (id.includes('lucide-react')) return 'icons-vendor';
              if (id.includes('motion')) return 'motion-vendor';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // NO PROXY — API is in-process via expressApiPlugin above.
    },
  };
});
