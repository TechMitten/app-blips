import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'
import { handleChatProxy } from './functions/_lib/chatProxy.js'

// Runs the same LLM proxy handler used by the production Cloudflare Pages
// Function (functions/api/chat.js) as dev-server middleware, so `npm run dev`
// works without needing wrangler. Reads ORION_LLM_* from a local .env with no
// prefix filter -- these never reach the client bundle since they aren't
// VITE_-prefixed and are only read here, in Node config code.
function llmProxyDevMiddleware(mode) {
  return {
    name: 'orion-llm-proxy-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const request = new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          },
          body: Buffer.concat(chunks),
        })
        const response = await handleChatProxy(request, env)
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        if (response.body) {
          Readable.fromWeb(response.body).pipe(res)
        } else {
          res.end()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), llmProxyDevMiddleware(mode)],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    watch: {
      usePolling: true
    },
    headers: {
      // frame-ancestors is ignored in a <meta> tag, so it has to be a real
      // header. Production hosting should send these too.
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'vendor_icons';
            if (id.includes('react')) return 'vendor_react';
            return 'vendor';
          }
        }
      }
    }
  }
}))
