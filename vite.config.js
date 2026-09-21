import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable, pipeline } from 'node:stream'
import { handleChatProxy } from './functions/_lib/chatProxy.js'
import { handleAiChat, handleAiSession } from './functions/_lib/aiRelay.js'
import { handleSelfHostedAiChat } from './functions/_lib/selfHostedAiRelay.js'
import { handleAnalyticsWebsiteCreate, handleAnalyticsStats } from './functions/_lib/umamiProxy.js'

// Dev-middleware plumbing. Vite's connect server does not catch rejections from
// async middleware, and an 'error' event on an unhandled stream is an uncaught
// exception; on modern Node either one kills the whole dev server. Every proxy
// below goes through these so an upstream failure or a client abort (e.g. the
// user cancelling a generation mid-stream) costs one request, not the server.
function sendWebResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (!response.body) {
    res.end()
    return
  }
  // pipeline() forwards errors from either side and, when the client goes
  // away, destroys the upstream body so the LLM request is cancelled too.
  pipeline(Readable.fromWeb(response.body), res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('[dev-proxy] stream error:', err.message)
    }
  })
}

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
      server.middlewares.use('/api/chat', guarded(async (req, res) => {
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
        sendWebResponse(res, response)
      }))
    },
  }
}

function aiRelayDevMiddleware(mode) {
  return {
    name: 'appblips-ai-relay-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      const handle = (path, handler) => {
        server.middlewares.use(path, guarded(async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const request = new Request('http://' + (req.headers.host || 'localhost') + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(req.headers.origin ? { origin: req.headers.origin } : {}) },
            body: Buffer.concat(chunks),
          })
          const response = await handler(request, env)
          sendWebResponse(res, response)
        }))
      }
      handle('/ai/chat', handleAiChat)
      handle('/ai/session', handleAiSession)
    },
  }
}

function selfHostedAppAiDevMiddleware(mode) {
  return {
    name: "appblips-self-hosted-app-ai-dev-middleware",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "")
      server.middlewares.use("/api/app-ai/chat", guarded(async (req, res) => {
        const chunks = []
        if (req.method === "POST") for await (const chunk of req) chunks.push(chunk)
        const request = new Request("http://" + (req.headers.host || "localhost") + "/api/app-ai/chat", {
          method: req.method,
          headers: {
            ...(req.headers.origin ? { origin: req.headers.origin } : {}),
            ...(req.headers["x-forwarded-for"] ? { "x-forwarded-for": req.headers["x-forwarded-for"] } : {}),
            ...(req.method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        })
        const response = await handleSelfHostedAiChat(request, env)
        sendWebResponse(res, response)
      }))
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

      const respond = async (res, response) => sendWebResponse(res, response)

      const forwardedHeaders = (req) => ({
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers['x-firebase-appcheck'] ? { 'x-firebase-appcheck': req.headers['x-firebase-appcheck'] } : {}),
      })

      server.middlewares.use('/api/analytics/website', guarded(async (req, res) => {
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
      }))

      server.middlewares.use('/api/analytics/stats', guarded(async (req, res) => {
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
      }))
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

// SEO surface for the SPA, keyed on the same SELF_HOSTED_MODE flag as
// everything else. Hosted builds are indexable: description, canonical, Open
// Graph/Twitter tags, JSON-LD, a <noscript> summary for non-JS crawlers, plus
// /robots.txt and /sitemap.xml. Self-hosted builds (the default) are marked
// noindex with a disallow-all robots.txt, so forks and personal instances
// never publish duplicate copies of the marketing page. Without this, unknown
// paths fall back to index.html and /robots.txt would come back as HTML.
// Set VITE_SITE_URL to the public origin (defaults to https://appblips.com).
function seoPlugin(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const isHosted = (process.env.SELF_HOSTED_MODE ?? env.SELF_HOSTED_MODE) === 'false'
  const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || 'https://appblips.com').replace(/\/+$/, '')
  const title = 'AppBlips — Text to App and Website Generator'
  const description =
    'Describe an app or website in plain English and get a working single-file version in seconds, with a live preview, versions, export, and one-click deploy.'
  const image = `${siteUrl}/appblips-logo.png`

  const robots = isHosted
    ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${siteUrl}/</loc></url>\n` +
    '</urlset>\n'

  const meta = (attrs) => ({ tag: 'meta', attrs, injectTo: 'head' })
  const hostedTags = [
    meta({ name: 'description', content: description }),
    { tag: 'link', attrs: { rel: 'canonical', href: `${siteUrl}/` }, injectTo: 'head' },
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: 'AppBlips' }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: description }),
    meta({ property: 'og:url', content: `${siteUrl}/` }),
    meta({ property: 'og:image', content: image }),
    meta({ name: 'twitter:card', content: 'summary' }),
    meta({ name: 'twitter:title', content: title }),
    meta({ name: 'twitter:description', content: description }),
    meta({ name: 'twitter:image', content: image }),
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'AppBlips',
        url: `${siteUrl}/`,
        description,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }),
      injectTo: 'head',
    },
    {
      tag: 'noscript',
      children:
        '<h1>AppBlips — Text to App and Website Generator</h1>' +
        `<p>${description}</p>` +
        '<p>AppBlips needs JavaScript to run. <a href="https://docs.appblips.com/">Read the documentation</a>.</p>',
      injectTo: 'body-prepend',
    },
  ]

  return {
    name: 'appblips-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tags = isHosted ? hostedTags : [meta({ name: 'robots', content: 'noindex, nofollow' })]
        return {
          html: html.replace(/<title>[^<]*<\/title>/, `<title>${isHosted ? title : 'AppBlips'}</title>`),
          tags,
        }
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(robots)
        } else if (path === '/sitemap.xml' && isHosted) {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.end(sitemap)
        } else {
          next()
        }
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      if (isHosted) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), llmProxyDevMiddleware(mode), aiRelayDevMiddleware(mode), selfHostedAppAiDevMiddleware(mode), analyticsProxyDevMiddleware(mode), umamiAnalyticsPlugin(mode), seoPlugin(mode)],
  // SELF_HOSTED_MODE has no VITE_ prefix (like the other flags it sits next to
  // in .env), but it's the one flag both the client bundle (src/firebase.js)
  // and the server-side proxy (functions/_lib/chatProxy.js) need to agree on,
  // so it's allow-listed here to reach import.meta.env too.
  envPrefix: ['VITE_', 'SELF_HOSTED_MODE', 'APPBLIPS_GENERATED_AI_MODE', 'APPBLIPS_APP_AI_RELAY_URL'],
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
