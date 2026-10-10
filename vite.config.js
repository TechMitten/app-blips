import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { handleChatProxy } from './electron/server/chatProxy.js'
import { describeConfig, formatConfigSummary } from './electron/server/configSummary.js'
import { toChatRequest, sendWebResponse } from './electron/server/nodeHttp.js'

// Vite's connect server does not catch rejections from async middleware; on
// modern Node that kills the whole dev server, so the proxy goes through this
// and an upstream failure costs one request, not the server. (Stream errors
// are handled in sendWebResponse.)
function guarded(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      console.error('[dev-proxy] handler error:', err)
      if (!res.headersSent) {
        res.statusCode = 502
        res.end('Proxy error')
      } else {
        res.destroy()
      }
    }
  }
}

// Prints which AI provider/mode is active (and what is still missing) once the
// dev server is up, so a misconfigured .env is obvious before the first request.
function configSummaryPlugin(mode) {
  return {
    name: 'appblips-config-summary',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        // Same env the middleware below reads: .env plus the process environment.
        console.log('\n' + formatConfigSummary(describeConfig(loadEnv(mode, process.cwd(), ''))) + '\n')
      })
    },
  }
}

// Runs the desktop app's LLM proxy handler (electron/server/chatProxy.js) as
// dev-server middleware, so the renderer can be developed in a browser with
// hot-reload. This is for working on AppBlips itself; to run a copy in a
// browser, use server.js (npm start, or Docker). Reads the OPENAI_* LLM
// variables from a local .env with no prefix filter: these never reach the
// client bundle since they aren't VITE_-prefixed and are only read here, in
// Node config code.
function llmProxyDevMiddleware(mode) {
  return {
    name: 'appblips-llm-proxy-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      server.middlewares.use('/api/chat', guarded(async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        const response = await handleChatProxy(await toChatRequest(req), env)
        sendWebResponse(res, response, {}, '[dev-proxy]')
      }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The app's version, for the update check (src/lib/updates.js).
  define: {
    __APPBLIPS_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version),
  },
  plugins: [react(), configSummaryPlugin(mode), llmProxyDevMiddleware(mode)],
  server: {
    host: true,
    port: 5175,
    // Browser mode keeps the AI provider in this origin's localStorage; a
    // silent hop to 5176 when 5175 is busy is a new origin with no saved key.
    strictPort: true,
    watch: {
      usePolling: true
    },
    headers: {
      // frame-ancestors is ignored in a <meta> tag, so it has to be a real
      // header. The desktop app sends these too (electron/main.js).
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    }
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Only imported codebases use these, through dynamic import(), so
            // keep them out of the eager vendor chunk.
            if (id.includes('esbuild-wasm') || id.includes('fflate')) return 'vendor_codebase';
            if (id.includes('lucide-react')) return 'vendor_icons';
            if (id.includes('react')) return 'vendor_react';
            return 'vendor';
          }
        }
      }
    }
  }
}))
