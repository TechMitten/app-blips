import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'
import { handleChatProxy } from './functions/_lib/chatProxy.js'
import { handleAnalyticsWebsiteCreate, handleAnalyticsStats } from './functions/_lib/umamiProxy.js'

// Runs the same LLM proxy handler used by the production Cloudflare Pages
// Function (functions/api/chat.js) as dev-server middleware, so `npm run dev`
// works without needing wrangler. Reads APPBLIPS_LLM_* from a local .env with no
// prefix filter -- these never reach the client bundle since they aren't
// VITE_-prefixed and are only read here, in Node config code.
function llmProxyDevMiddleware(mode) {
  return {
    name: 'appblips-llm-proxy-dev-middleware',
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
            ...(req.headers['x-firebase-appcheck'] ? { 'x-firebase-appcheck': req.headers['x-firebase-appcheck'] } : {}),
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

// Runs the new per-deployment Umami admin proxy (functions/_lib/umamiProxy.js)
// as dev-server middleware, mirroring llmProxyDevMiddleware above -- same
// reasons: no wrangler dependency locally, no behavior drift from prod. This
// is unrelated to umamiAnalyticsPlugin below (that's the always-on shared
// platform tracker for the SPA itself; this proxies the new opt-in
// per-app dashboard feature to a separate self-hosted Umami instance).
function analyticsProxyDevMiddleware(mode) {
  return {
    name: 'appblips-analytics-proxy-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')

      const respond = async (res, response) => {
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        if (response.body) {
          Readable.fromWeb(response.body).pipe(res)
        } else {
          res.end()
        }
      }

      const forwardedHeaders = (req) => ({
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers['x-firebase-appcheck'] ? { 'x-firebase-appcheck': req.headers['x-firebase-appcheck'] } : {}),
      })

      server.middlewares.use('/api/analytics/website', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const request = new Request('http://localhost/api/analytics/website', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
          body: Buffer.concat(chunks),
        })
        await respond(res, await handleAnalyticsWebsiteCreate(request, env))
      })

      server.middlewares.use('/api/analytics/stats', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        // connect strips the mounted path prefix from req.url but keeps the
        // query string, so re-attach it to the real route for the Request URL.
        const queryIndex = req.url.indexOf('?')
        const query = queryIndex === -1 ? '' : req.url.slice(queryIndex)
        const request = new Request(`http://localhost/api/analytics/stats${query}`, {
          method: 'GET',
          headers: forwardedHeaders(req),
        })
        await respond(res, await handleAnalyticsStats(request, env))
      })
    },
  }
}

// Injects the Umami analytics + session recorder scripts into <head> only for
// the hosted version (SELF_HOSTED_MODE=false). In self-hosted mode (the
// default), this is omitted entirely. The recorder is main-app-only -- it
// must never reach deployed apps, which get script.js alone (or nothing) via
// deploy.js/crypto.js/functions/[[path]].js.
function umamiAnalyticsPlugin(mode) {
  return {
    name: 'appblips-umami-analytics',
    transformIndexHtml() {
      const env = loadEnv(mode, process.cwd(), '');
      const isHosted = (process.env.SELF_HOSTED_MODE ?? env.SELF_HOSTED_MODE) === 'false';
      if (isHosted) {
        const websiteId = 'ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3';
        return [
          {
            tag: 'script',
            attrs: {
              defer: true,
              src: 'https://umami.techmitten.com/script.js',
              'data-website-id': websiteId,
            },
            injectTo: 'head',
          },
          {
            tag: 'script',
            attrs: {
              defer: true,
              src: 'https://umami.techmitten.com/recorder.js',
              'data-website-id': websiteId,
            },
            injectTo: 'head',
          },
        ];
      }
      return [];
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), llmProxyDevMiddleware(mode), analyticsProxyDevMiddleware(mode), umamiAnalyticsPlugin(mode)],
  // SELF_HOSTED_MODE has no VITE_ prefix (like the other flags it sits next to
  // in .env), but it's the one flag both the client bundle (src/firebase.js)
  // and the server-side proxy (functions/_lib/chatProxy.js) need to agree on,
  // so it's allow-listed here to reach import.meta.env too.
  envPrefix: ['VITE_', 'SELF_HOSTED_MODE'],
  server: {
    host: true,
    port: 5175,
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
