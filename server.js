// Minimal production server for self-hosted Docker deployments.
//
// Serves the built static client (dist/) and implements POST /api/chat by
// calling the same handleChatProxy used by the Cloudflare Pages Function
// (functions/api/chat.js) and the Vite dev middleware (vite.config.js) --
// one proxy implementation, no behavior drift between dev/prod/Docker.
//
// Deliberately dependency-free (only Node built-ins) so the runtime Docker
// image needs nothing beyond `node server.js`.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { handleChatProxy } from './functions/_lib/chatProxy.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function handleChatRequest(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://localhost${req.url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      ...(req.headers['x-firebase-appcheck']
        ? { 'x-firebase-appcheck': req.headers['x-firebase-appcheck'] }
        : {}),
    },
    body: Buffer.concat(chunks),
  });

  const response = await handleChatProxy(request, process.env);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  if (response.body) {
    Readable.fromWeb(response.body).pipe(res);
  } else {
    res.end();
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let requestedPath = decodeURIComponent(url.pathname);

  // Prevent path traversal outside dist/.
  const safePath = normalize(join(DIST_DIR, requestedPath));
  if (!safePath.startsWith(DIST_DIR + sep) && safePath !== DIST_DIR) {
    res.writeHead(400, SECURITY_HEADERS);
    res.end('Bad request');
    return;
  }

  let filePath = requestedPath === '/' ? join(DIST_DIR, 'index.html') : safePath;

  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html');
      fileStat = await stat(filePath);
    }
  } catch {
    // SPA fallback: unknown paths (client-side navigation, refreshes) get index.html.
    filePath = join(DIST_DIR, 'index.html');
    try {
      fileStat = await stat(filePath);
    } catch {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
  }

  const isIndex = filePath === join(DIST_DIR, 'index.html');
  const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
  const cacheControl = isIndex
    ? 'no-cache'
    : filePath.includes(join(DIST_DIR, 'assets') + sep)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': fileStat.size,
    'Cache-Control': cacheControl,
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url === '/api/chat' && req.method === 'POST') {
    handleChatRequest(req, res).catch((err) => {
      res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Internal server error: ${err.message}` }));
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS);
    res.end('Method not allowed');
    return;
  }

  serveStatic(req, res).catch((err) => {
    res.writeHead(500, SECURITY_HEADERS);
    res.end(`Internal server error: ${err.message}`);
  });
});

server.listen(PORT, () => {
  console.log(`AppBlips listening on port ${PORT}`);
});
