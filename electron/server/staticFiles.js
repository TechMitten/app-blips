// What the app's own static files are served with. Shared by the desktop app
// (electron/main.js) and the browser server (server.js), so both send the same
// headers and types.

// frame-ancestors is ignored in a <meta> tag, so it has to be a real header.
// The Vite dev server sends the same set (vite.config.js).
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  // esbuild-wasm (the imported-codebase preview bundler) instantiates its
  // module with instantiateStreaming, which requires this exact type.
  '.wasm': 'application/wasm',
};
