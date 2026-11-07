// Runs AppBlips in a browser instead of the desktop app: serves the built
// client (dist/) and answers POST /api/chat with the same handler the desktop
// app uses. Started by `npm start` (from source) and by the Docker image.
//
// Single-user like the desktop app: /api/chat has no sign-in and spends the
// configured key, so this listens on 127.0.0.1 unless HOST says otherwise
// (the Docker image listens on 0.0.0.0 inside the container, and
// docker-compose.yml publishes it on 127.0.0.1 only). Projects and the
// Settings → AI provider choice live in the browser's own storage, as in
// `npm run dev`; the provider's API key is kept here instead (keyFile.js), so
// the page never stores it.
//
// Only Node built-ins plus electron/server, so the Docker image ships it as
// one bundled file (scripts/build-server.js) with no node_modules.
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatProxy } from './electron/server/chatProxy.js';
import { describeConfig, formatConfigSummary } from './electron/server/configSummary.js';
import { toChatRequest, toFetchRequest, sendWebResponse } from './electron/server/nodeHttp.js';
import { createKeyFile, defaultKeyFile } from './electron/server/keyFile.js';
import { handleProviderApi } from './electron/server/providerApi.js';
import { handleSurgeApi } from './electron/server/surgeApi.js';
import { handlePollinationsApi } from './electron/server/pollinationsApi.js';
import { handlePixabayApi } from './electron/server/pixabayApi.js';
import { handleTavilyApi } from './electron/server/tavilyApi.js';
import { handleSeoScanApi } from './electron/server/seoScanApi.js';
import { withSavedProvider } from './electron/server/savedProvider.js';
import { hostAllowed } from './electron/server/hosts.js';
import { SECURITY_HEADERS, MIME_TYPES } from './electron/server/staticFiles.js';
import { handleBilling } from './electron/server/hosted/billing.js';
import { gateChat, releaseBuild } from './electron/server/hosted/chat.js';
import { handleSandbox } from './electron/server/hosted/sandbox.js';
import { openStore, defaultDatabasePath } from './electron/server/hosted/store.js';
import { isHosted } from './electron/server/hosted/mode.js';

// A .env in the folder it starts from, when there is one. Docker passes its
// settings as real environment variables instead; those win over the file.
try {
  process.loadEnvFile();
} catch (err) {
  // No .env is normal: environment only.
  if (err.code !== 'ENOENT') console.warn('[server] could not read .env:', err);
}

const DIST_DIR = fileURLToPath(new URL('./dist', import.meta.url));
const INDEX_FILE = join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const keys = createKeyFile({ file: defaultKeyFile() });
const surgeTokens = createKeyFile({ file: defaultKeyFile(process.env, 'surge-token.json') });
const pollinationsKeys = createKeyFile({ file: defaultKeyFile(process.env, 'pollinations-key.json') });
const pixabayKeys = createKeyFile({ file: defaultKeyFile(process.env, 'pixabay-key.json') });
const tavilyKeys = createKeyFile({ file: defaultKeyFile(process.env, 'tavily-key.json') });
// AppBlips AI Credits were removed; delete the sign-in token older versions
// saved, so no credential is left behind that nothing uses.
rm(defaultKeyFile(process.env, 'credits-key.json'), { force: true }).catch(() => {});

// Hosted mode turns this single-user server into a multi-user API: /api/chat
// requires a Clerk session and an active plan, and picks the model by plan;
// Polar takes the payments. It turns on by itself when the Clerk key and a
// Polar token are set (mode.js), so a plain local install stays single-user.
const hosted = isHosted(process.env);
// The account store (plans, processed webhooks, sandbox ids) is always open.
const store = openStore(defaultDatabasePath(process.env));

const sendText = (res, status, text, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
};

async function serveStatic(req, res) {
  let requested;
  try {
    requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  const safePath = normalize(join(DIST_DIR, requested));
  if (!safePath.startsWith(DIST_DIR + sep) && safePath !== DIST_DIR) {
    sendText(res, 400, 'Bad request');
    return;
  }

  let filePath = requested === '/' ? INDEX_FILE : safePath;
  let info;
  try {
    info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath);
    }
  } catch {
    filePath = INDEX_FILE; // SPA fallback
    info = await stat(filePath);
  }

  // Vite's hashed bundles never change under the same name; everything else
  // (index.html above all) is revalidated so an update shows up at once.
  const cacheControl = filePath === INDEX_FILE
    ? 'no-cache'
    : filePath.startsWith(join(DIST_DIR, 'assets') + sep)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  if (!hostAllowed(req.headers.host || '')) {
    sendText(res, 403, `This address isn't allowed. To open AppBlips at ${req.headers.host || 'this address'}, add it to APPBLIPS_ALLOWED_HOSTS and restart.`);
    return;
  }

  const fail = (err) => {
    console.error('[server] request failed:', req.url, err);
    if (!res.headersSent) sendText(res, 500, 'Internal error.');
    else res.destroy();
  };

  if (req.url === '/api/billing' || req.url.startsWith('/api/billing/') || req.url === '/api/webhooks/polar') {
    if (!hosted) {
      sendText(res, 404, 'Hosted billing is not enabled.');
      return;
    }
    toFetchRequest(req)
      .then((request) => handleBilling(request, process.env, store))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[billing]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/sandbox' || req.url.startsWith('/api/sandbox/')) {
    toFetchRequest(req)
      .then((request) => handleSandbox(request, process.env, store))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[sandbox]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/chat') {
    if (req.method !== 'POST') {
      sendText(res, 405, 'Method not allowed');
      return;
    }
    const handle = async () => {
      let request = await toChatRequest(req);
      let gated = null;
      // Signed-in requests are plan users (the app sends a Clerk session only
      // then); everyone else builds with their own saved key, hosted or not.
      if (hosted && request.headers.has('authorization')) {
        gated = await gateChat(request, process.env, store);
        if (gated.response) {
          sendWebResponse(res, gated.response, SECURITY_HEADERS, '[billing]');
          return;
        }
        request = gated.request;
      } else {
        request = await withSavedProvider(request, keys);
      }
      const response = await handleChatProxy(request, process.env);
      // A rejected request didn't produce a build; don't charge for it.
      if (gated && !response.ok) await releaseBuild(process.env, store, gated);
      sendWebResponse(res, response, SECURITY_HEADERS, '[server]');
    };
    handle().catch(fail);
    return;
  }


  if (req.url === '/api/provider' || req.url.startsWith('/api/provider/')) {
    toFetchRequest(req)
      .then((request) => handleProviderApi(request, process.env, keys))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/surge' || req.url.startsWith('/api/surge/')) {
    toFetchRequest(req)
      .then((request) => handleSurgeApi(request, process.env, surgeTokens))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/pollinations' || req.url.startsWith('/api/pollinations/')) {
    toFetchRequest(req)
      .then((request) => handlePollinationsApi(request, process.env, pollinationsKeys))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/pixabay' || req.url.startsWith('/api/pixabay/')) {
    toFetchRequest(req)
      .then((request) => handlePixabayApi(request, process.env, pixabayKeys))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/tavily' || req.url.startsWith('/api/tavily/')) {
    toFetchRequest(req)
      .then((request) => handleTavilyApi(request, process.env, tavilyKeys))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.url === '/api/seo/scan') {
    toFetchRequest(req)
      .then((request) => handleSeoScanApi(request, process.env))
      .then((response) => sendWebResponse(res, response, SECURITY_HEADERS, '[server]'))
      .catch(fail);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  serveStatic(req, res).catch(fail);
});

if (!existsSync(INDEX_FILE)) {
  console.error('AppBlips isn\'t built yet: dist/index.html is missing. Run `npm start` (it builds first), or `npm run build` and then `node server.js`.');
  process.exit(1);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop whatever is using it, or start AppBlips on another port with PORT=3001.`);
  } else {
    console.error('[server]', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  // Inside Docker, HOST is 0.0.0.0 but the address to open is the published
  // one; localhost is right for the default compose file.
  const shown = HOST === '0.0.0.0' || HOST === '::' || HOST === '127.0.0.1' ? 'localhost' : HOST;
  console.log(`\n${formatConfigSummary(describeConfig(process.env))}\n`);
  console.log(`AppBlips is running. Open http://${shown}:${process.env.APPBLIPS_PUBLIC_PORT || PORT} in your browser.`);
});
