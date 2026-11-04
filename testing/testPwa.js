// Tests for PWA generation, notification injection, and Surge publishing
// Run: node testing/testPwa.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import {
  FALLBACK_PWA_ICON_BASE64,
  buildPwaManifest,
  buildServiceWorker,
  defaultPwaIconBase64,
  injectPwaPrompt,
} from '../src/lib/pwa.js';
import { loadPwa, savePwa } from '../src/lib/surge.js';
import { handleSurgeApi } from '../electron/server/surgeApi.js';

function readTar(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    let nameEnd = 0;
    while (nameEnd < 100 && block[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder('ascii').decode(block.subarray(0, nameEnd));
    let sizeStr = '';
    for (let i = 124; i < 135; i++) {
      const char = String.fromCharCode(block[i]);
      if (char >= '0' && char <= '7') sizeStr += char;
    }
    const size = parseInt(sizeStr, 8) || 0;
    const dataStart = offset + 512;
    const data = buffer.subarray(dataStart, dataStart + size);
    files.push({ name, data, text: new TextDecoder().decode(data) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const memoryTokens = (email = 'user@example.com', token = 'test-token') => ({
  describe: () => ({ id: email, hasKey: Boolean(token) }),
  keyFor: (id) => (id === email ? token : ''),
  save: async () => {},
  clear: async () => {},
});

const request = (path, { method = 'GET', body, origin = 'http://localhost:5175' } = {}) => new Request(`http://localhost:5175${path}`, {
  method,
  headers: {
    origin,
    ...(body ? { 'content-type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
});

test('buildPwaManifest generates valid Web App Manifest JSON with app metadata and icons', () => {
  const jsonStr = buildPwaManifest('Super Calculator');
  const manifest = JSON.parse(jsonStr);

  assert.equal(manifest.name, 'Super Calculator');
  assert.equal(manifest.short_name, 'Super Calcul');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#ffffff');
  assert.equal(manifest.theme_color, '#4f46e5');
  assert.ok(Array.isArray(manifest.icons));
  assert.equal(manifest.icons[0].src, '/favicon.png');
  assert.equal(manifest.icons[0].sizes, '192x192 512x512');
  assert.equal(manifest.icons[0].type, 'image/png');
  assert.equal(manifest.icons[0].purpose, 'any maskable');
});

test('buildPwaManifest handles empty or whitespace project names', () => {
  const manifest = JSON.parse(buildPwaManifest('   '));
  assert.equal(manifest.name, 'App');
  assert.equal(manifest.short_name, 'App');
});

test('buildServiceWorker generates valid service worker with install, activate and fetch caching', () => {
  const sw = buildServiceWorker();
  assert.ok(sw.includes("addEventListener('install'"), 'has install listener');
  assert.ok(sw.includes("addEventListener('activate'"), 'has activate listener');
  assert.ok(sw.includes("addEventListener('fetch'"), 'has fetch listener');
  assert.ok(sw.includes('skipWaiting'), 'calls skipWaiting');
  assert.ok(sw.includes('clients.claim'), 'calls clients.claim');
  assert.ok(sw.includes('caches.open'), 'caches responses');
});

test('defaultPwaIconBase64 returns valid fallback base64 in non-browser environment', () => {
  const icon = defaultPwaIconBase64('My Project');
  assert.ok(typeof icon === 'string');
  assert.equal(icon, FALLBACK_PWA_ICON_BASE64);
  assert.ok(icon.length > 50);
});

test('injectPwaPrompt injects manifest links and meta tags in <head>', () => {
  const original = '<!doctype html><html><head><title>My App</title></head><body><h1>Hello</h1></body></html>';
  const result = injectPwaPrompt(original, { projectName: 'My App' });

  assert.ok(result.includes('<link rel="manifest" href="/manifest.webmanifest">'), 'manifest link in head');
  assert.ok(result.includes('<meta name="mobile-web-app-capable" content="yes">'), 'mobile capable meta');
  assert.ok(result.includes('<meta name="apple-mobile-web-app-capable" content="yes">'), 'apple mobile capable meta');
  assert.ok(result.includes('<meta name="apple-mobile-web-app-title" content="My App">'), 'apple mobile title');
  assert.ok(result.includes('<meta name="theme-color" content="#4f46e5">'), 'theme color');
});

test('injectPwaPrompt replaces existing manifest links to avoid duplicates', () => {
  const original = '<html><head><link rel="manifest" href="/old.json"><title>Test</title></head><body></body></html>';
  const result = injectPwaPrompt(original, { projectName: 'Test' });

  assert.ok(!result.includes('/old.json'), 'old manifest link removed');
  assert.ok(result.includes('/manifest.webmanifest'), 'new manifest link present');
});

test('injectPwaPrompt injects notification banner and client script before </body>', () => {
  const original = '<!doctype html><html><head></head><body><div id="root">App</div></body></html>';
  const result = injectPwaPrompt(original, { projectName: 'Photo Studio' });

  assert.ok(result.includes('id="appblips-pwa-prompt"'), 'has notification container');
  assert.ok(result.includes('Install Photo Studio'), 'displays project name in title');
  assert.ok(result.includes('id="appblips-pwa-install"'), 'has install button');
  assert.ok(result.includes('id="appblips-pwa-dismiss"'), 'has dismiss button');
  assert.ok(result.includes('id="appblips-pwa-close"'), 'has close button');
  assert.ok(result.includes('beforeinstallprompt'), 'handles beforeinstallprompt event');
  assert.ok(result.includes('display-mode: standalone'), 'checks standalone display mode');
  assert.ok(result.includes('serviceWorker'), 'registers /sw.js');
  assert.ok(result.indexOf('id="appblips-pwa-prompt"') < result.indexOf('</body>'), 'banner placed before closing body');
});

test('injectPwaPrompt handles bare HTML without head or body tags', () => {
  const original = '<h1>Bare content</h1>';
  const result = injectPwaPrompt(original, { projectName: 'Simple' });

  assert.ok(result.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(result.includes('id="appblips-pwa-prompt"'));
  assert.ok(result.includes('Install Simple'));
});

const map = new Map();
globalThis.window = {
  localStorage: {
    length: 0,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
  },
};

test('loadPwa and savePwa manage storage state correctly', () => {
  // Test project isolation
  savePwa('proj-1', true);
  savePwa('proj-2', false);

  assert.equal(loadPwa('proj-1'), true);
  assert.equal(loadPwa('proj-2'), false);
  assert.equal(loadPwa('proj-unknown'), false);
  assert.equal(loadPwa(''), false);

  // Toggle off
  savePwa('proj-1', false);
  assert.equal(loadPwa('proj-1'), false);
});

test('Surge publishing accepts manifest.webmanifest and sw.js in extras', async () => {
  let uploadedTar;
  const fetch = async (url, init) => {
    uploadedTar = init;
    return new Response('{"type":"info"}\n', { status: 200 });
  };

  const manifest = buildPwaManifest('PWA Site');
  const sw = buildServiceWorker();
  const extras = {
    'manifest.webmanifest': manifest,
    'sw.js': sw,
  };

  const response = await handleSurgeApi(
    request('/api/surge/publish', {
      method: 'POST',
      body: {
        domain: 'pwa-test-site',
        files: { 'index.html': '<html><body>Hello</body></html>' },
        extras,
      },
    }),
    {},
    memoryTokens('a@b.co', 'tok'),
    { fetch },
  );

  assert.equal(response.status, 200);
  const files = readTar(gunzipSync(uploadedTar.body));
  const names = files.map((f) => f.name).sort();

  assert.deepEqual(names, ['site/index.html', 'site/manifest.webmanifest', 'site/sw.js']);
  assert.equal(files.find((f) => f.name === 'site/manifest.webmanifest').text, manifest);
  assert.equal(files.find((f) => f.name === 'site/sw.js').text, sw);
});
