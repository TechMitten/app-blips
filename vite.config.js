import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable, pipeline } from 'node:stream'
import { readFileSync } from 'node:fs'
import { handleChatProxy } from './functions/_lib/chatProxy.js'
import { describeConfig, formatConfigSummary } from './functions/_lib/configSummary.js'
import { handleAnalyticsWebsiteCreate, handleAnalyticsStats } from './functions/_lib/umamiProxy.js'
import { handleBillingStatus, handleBillingCheckout, handleBillingPortal, handleBillingEndTrial, handleStripeWebhook } from './functions/_lib/billing.js'
import { handleDeployUpload, handleDeployDelete } from './functions/_lib/deploys.js'
import { handleAccountDelete } from './functions/_lib/account.js'

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

// Runs the same LLM proxy handler used by the production Cloudflare Pages
// Function (functions/api/chat.js) as dev-server middleware, so `npm run dev`
// works without needing wrangler. Reads the OPENAI_* LLM variables from a local .env with no
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
        // The real Host and Origin go through: self-hosted mode refuses
        // browser requests from other sites (isForeignOrigin in chatProxy.js).
        const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
        const request = new Request(protocol + '://' + (req.headers.host || 'localhost') + '/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
            ...(req.headers.origin ? { origin: req.headers.origin } : {}),
          },
          body: Buffer.concat(chunks),
        })
        const response = await handleChatProxy(request, env)
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

// Stripe billing endpoints (functions/_lib/billing.js), same handlers as the
// Worker. The Request keeps the real Host so Checkout returns to this dev
// server. The webhook needs the raw body and Stripe-Signature untouched: the
// signature covers the exact bytes Stripe sent. Locally, forward events with
// `stripe listen --forward-to localhost:5175/api/billing/webhook`.
function billingDevMiddleware(mode) {
  return {
    name: 'appblips-billing-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      const routes = {
        '/api/billing/status': ['GET', handleBillingStatus],
        '/api/billing/checkout': ['POST', handleBillingCheckout],
        '/api/billing/portal': ['POST', handleBillingPortal],
        '/api/billing/end-trial': ['POST', handleBillingEndTrial],
        '/api/billing/webhook': ['POST', handleStripeWebhook],
      }
      for (const [path, [method, handler]] of Object.entries(routes)) {
        server.middlewares.use(path, guarded(async (req, res) => {
          if (req.method !== method) { res.statusCode = 405; res.end('Method not allowed'); return }
          const chunks = []
          if (method === 'POST') for await (const chunk of req) chunks.push(chunk)
          const request = new Request('http://' + (req.headers.host || 'localhost') + path, {
            method,
            headers: {
              ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
              ...(req.headers['stripe-signature'] ? { 'stripe-signature': req.headers['stripe-signature'] } : {}),
              ...(method === 'POST' ? { 'content-type': req.headers['content-type'] || 'application/json' } : {}),
            },
            ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          })
          sendWebResponse(res, await handler(request, env))
        }))
      }
    },
  }
}

// Deploy publishing and account deletion (functions/_lib/deploys.js,
// account.js), same handlers as Pages and the Worker. Only work when the
// .env has FIREBASE_SERVICE_ACCOUNT and the R2_* credentials.
function accountDevMiddleware(mode) {
  return {
    name: 'appblips-account-dev-middleware',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      const routes = {
        '/api/deploys': { POST: handleDeployUpload, DELETE: handleDeployDelete },
        '/api/account/delete': { POST: handleAccountDelete },
      }
      for (const [path, methods] of Object.entries(routes)) {
        server.middlewares.use(path, guarded(async (req, res) => {
          const handler = methods[req.method]
          if (!handler) { res.statusCode = 405; res.end('Method not allowed'); return }
          const chunks = []
          if (req.method === 'POST') for await (const chunk of req) chunks.push(chunk)
          const queryIndex = req.url.indexOf('?')
          const query = queryIndex === -1 ? '' : req.url.slice(queryIndex)
          const request = new Request('http://' + (req.headers.host || 'localhost') + path + query, {
            method: req.method,
            headers: {
              ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
              ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}),
            },
            ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          })
          sendWebResponse(res, await handler(request, env))
        }))
      }
    },
  }
}

// Injects the optional Umami analytics + session recorder scripts into <head>.
// Only when the operator configures a Umami script URL and website ID
// (VITE_UMAMI_SCRIPT_URL / VITE_UMAMI_WEBSITE_ID, plus the optional
// VITE_UMAMI_RECORDER_URL). The recorder is main-app-only -- it must never
// reach deployed apps, which get script.js alone (or nothing) via
// deploy.js/crypto.js/functions/[[path]].js.
function umamiAnalyticsPlugin(mode) {
  return {
    name: 'appblips-umami-analytics',
    transformIndexHtml() {
      const env = loadEnv(mode, process.cwd(), '');
      const scriptUrl = process.env.VITE_UMAMI_SCRIPT_URL ?? env.VITE_UMAMI_SCRIPT_URL;
      const recorderUrl = process.env.VITE_UMAMI_RECORDER_URL ?? env.VITE_UMAMI_RECORDER_URL;
      const websiteId = process.env.VITE_UMAMI_WEBSITE_ID ?? env.VITE_UMAMI_WEBSITE_ID;
      if (!scriptUrl || !websiteId) return [];
      const tags = [
        {
          tag: 'script',
          attrs: { defer: true, src: scriptUrl, 'data-website-id': websiteId },
          injectTo: 'head',
        },
      ];
      if (recorderUrl) {
        tags.push({
          tag: 'script',
          attrs: { defer: true, src: recorderUrl, 'data-website-id': websiteId },
          injectTo: 'head',
        });
      }
      return tags;
    },
  };
}

// SEO surface for the SPA. Instances that set VITE_SITE_URL (a public origin)
// are indexable: description, canonical, Open Graph/Twitter tags, JSON-LD, a
// <noscript> summary for non-JS crawlers, plus /robots.txt and /sitemap.xml.
// Instances without it are marked noindex with a disallow-all robots.txt, so
// forks and personal copies never publish duplicate marketing pages. Without
// this, unknown paths fall back to index.html and /robots.txt would come back
// as HTML.
function seoPlugin(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = (process.env.VITE_SITE_URL || env.VITE_SITE_URL || '').replace(/\/+$/, '')
  const isPublic = Boolean(siteUrl)
  const title = 'AppBlips — Text to App and Website Generator'
  const description =
    'Describe an app or website in plain English and get a working single-file version in seconds, with a live preview, versions, export, and one-click deploy.'
  const image = `${siteUrl}/appblips-logo.png`

  const robots = isPublic
    ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${siteUrl}/</loc></url>\n` +
    '</urlset>\n'

  const meta = (attrs) => ({ tag: 'meta', attrs, injectTo: 'head' })
  const seoTags = [
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
        const tags = isPublic ? seoTags : [meta({ name: 'robots', content: 'noindex, nofollow' })]
        return {
          html: html.replace(/<title>[^<]*<\/title>/, `<title>${isPublic ? title : 'AppBlips'}</title>`),
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
        } else if (path === '/sitemap.xml' && isPublic) {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.end(sitemap)
        } else {
          next()
        }
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      if (isPublic) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
    },
  }
}

// VITE_* values are baked into the bundle at build time, so a mistyped or
// half-set Firebase config ships to every user and only shows up as sign-in
// failures at runtime (a Pages build once baked in a literal variable name
// instead of a key). Fail the build instead. All unset still means single-user.
const FIREBASE_CLIENT_VARS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']
function checkFirebaseConfig(mode) {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const set = FIREBASE_CLIENT_VARS.filter((name) => env[name])
  if (!set.length) return
  if (set.length !== FIREBASE_CLIENT_VARS.length) {
    throw new Error(`Firebase is half configured: set all of ${FIREBASE_CLIENT_VARS.join(', ')} or none (missing ${FIREBASE_CLIENT_VARS.filter((name) => !env[name]).join(', ')}).`)
  }
  if (!/^AIza[\w-]{35}$/.test(env.VITE_FIREBASE_API_KEY)) {
    throw new Error(`VITE_FIREBASE_API_KEY doesn't look like a Firebase web API key (got "${env.VITE_FIREBASE_API_KEY.slice(0, 12)}..."). Copy it from the Firebase console's web app config.`)
  }
  if (!/^1:\d+:web:[0-9a-f]+$/.test(env.VITE_FIREBASE_APP_ID)) {
    throw new Error(`VITE_FIREBASE_APP_ID doesn't look like a Firebase web app id (expected 1:<number>:web:<hex>).`)
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => (checkFirebaseConfig(mode), {
  // The app's version, for the self-hosted update check (src/lib/updates.js).
  define: {
    __APPBLIPS_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version),
  },
  plugins: [react(), configSummaryPlugin(mode), llmProxyDevMiddleware(mode), analyticsProxyDevMiddleware(mode), billingDevMiddleware(mode), accountDevMiddleware(mode), umamiAnalyticsPlugin(mode), seoPlugin(mode)],
  // Multi-user features turn on when the operator configures Firebase (the
  // VITE_FIREBASE_* web config, see src/firebase.js). APPBLIPS_MAINTENANCE has no VITE_ prefix but still
  // needs to reach import.meta.env (the server reads the same variable).
  envPrefix: ['VITE_', 'APPBLIPS_MAINTENANCE'],
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
            // Loaded with import() only after a payment; keep it out of the
            // eagerly loaded vendor chunk.
            if (id.includes('canvas-confetti')) return undefined;
            if (id.includes('lucide-react')) return 'vendor_icons';
            if (id.includes('react')) return 'vendor_react';
            return 'vendor';
          }
        }
      }
    }
  }
}))
