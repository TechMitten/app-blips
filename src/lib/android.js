// Android (Capacitor) host. The Android app is the normal dist/ build in a
// WebView, served from https://localhost by Capacitor; there is no server
// process and no Electron main, so nothing would answer /api/*. This module
// answers it inside the page instead, with the same Fetch-only handlers
// server.js and electron/main.js use (one implementation, no drift): it wraps
// window.fetch and routes same-origin /api/* requests to them.
//
// Only loaded when main.jsx sees Capacitor's Android bridge, through a dynamic
// import, so the desktop and browser bundles never fetch this chunk.
//
// Security notes, since this differs from the other hosts:
// - Saved keys live in the Android Keystore (capacitor-secure-storage-plugin),
//   not in localStorage, and are only read into this page's memory. The page
//   is the privileged context here, as Electron's main process is on desktop.
// - Generated apps run in sandboxed iframes with their own window.fetch, which
//   this wrapper never touches: their /api/* requests go to Capacitor's static
//   file server and never reach a handler or a key.
// - AI requests go straight from the WebView to the provider (every cloud
//   preset answers CORS for https://localhost) so replies still stream. Surge
//   and Pollinations don't allow CORS, or hide the headers Pollinations needs,
//   so they go through Capacitor's native HTTP, which doesn't stream but
//   doesn't need to there.

import { CapacitorHttp } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { handleChatProxy } from '../../electron/server/chatProxy.js';
import { handleProviderApi } from '../../electron/server/providerApi.js';
import { handleSurgeApi } from '../../electron/server/surgeApi.js';
import { handlePollinationsApi } from '../../electron/server/pollinationsApi.js';
import { handleCreditsApi } from '../../electron/server/creditsApi.js';
import { withSavedProvider } from '../../electron/server/savedProvider.js';
import { logError } from './errorLog.js';

// keyFile.js's interface (keyFor/describe sync, save/clear async), backed by
// the Keystore. Read once at startup so keyFor can stay synchronous.
async function createSecureKeyStore(name) {
  let state = { id: '', key: '' };
  try {
    const saved = JSON.parse((await SecureStoragePlugin.get({ key: name })).value);
    if (typeof saved?.id === 'string' && typeof saved.key === 'string') state = { id: saved.id, key: saved.key };
  } catch {
    // get() rejects when nothing is saved yet; an unreadable entry is treated
    // the same (not logged: the message could quote the key).
  }
  const persist = async () => {
    if (state.key) await SecureStoragePlugin.set({ key: name, value: JSON.stringify(state) });
    else await SecureStoragePlugin.remove({ key: name }).catch(() => {});
  };
  return {
    keyFor: (id) => (id && id === state.id ? state.key : ''),
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    async save(id, key) {
      state = { id, key };
      await persist();
    },
    async clear() {
      state = { id: '', key: '' };
      await persist();
    },
  };
}

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// Statuses whose Response must have a null body.
const NULL_BODY = new Set([101, 204, 205, 304]);

// A fetch() over CapacitorHttp, covering what surgeApi.js and
// pollinationsApi.js send: string or byte bodies, plain-object headers. The
// response body is always text (JSON arrives parsed and is re-serialized).
// AbortSignal.timeout isn't honoured natively, so the same two minutes are
// set as the native read timeout.
async function nativeFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  const body = init.body;
  const bytes = body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  const response = await CapacitorHttp.request({
    url,
    method: init.method || 'GET',
    headers: Object.fromEntries(new Headers(init.headers || {})),
    // Binary bodies (Surge's gzipped tarball) cross the bridge as base64.
    ...(bytes ? { data: toBase64(bytes), dataType: 'file' } : body != null ? { data: String(body) } : {}),
    responseType: 'text',
    connectTimeout: 30_000,
    readTimeout: 120_000,
  });
  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
  return new Response(NULL_BODY.has(response.status) ? null : text, {
    status: response.status,
    headers: response.headers,
  });
}

// No environment on a phone: the provider always comes from Settings → AI.
const ENV = {};

export async function installAndroidApi() {
  const [keys, surgeTokens, pollinationsKeys, creditsKeys] = await Promise.all([
    createSecureKeyStore('provider-key'),
    createSecureKeyStore('surge-token'),
    createSecureKeyStore('pollinations-key'),
    createSecureKeyStore('credits-key'),
  ]);

  // The same routes, in the same order, as server.js.
  const routes = [
    ['/api/chat', (request) => withSavedProvider(request, keys).then((r) => handleChatProxy(r, ENV, creditsKeys))],
    ['/api/credits', (request) => handleCreditsApi(request, ENV, creditsKeys, { fetch: nativeFetch })],
    ['/api/provider', (request) => handleProviderApi(request, ENV, keys)],
    ['/api/surge', (request) => handleSurgeApi(request, ENV, surgeTokens, { fetch: nativeFetch })],
    ['/api/pollinations', (request) => handlePollinationsApi(request, ENV, pollinationsKeys, { fetch: nativeFetch })],
  ];
  const routeFor = (url) => (url.origin === window.location.origin
    ? routes.find(([path]) => url.pathname === path || url.pathname.startsWith(`${path}/`))?.[1]
    : undefined);

  const webFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch {
      return webFetch(input, init);
    }
    const handle = routeFor(url);
    if (!handle) return webFetch(input, init);
    const request = new Request(input instanceof Request ? input : url, init);
    if (request.signal.aborted) return Promise.reject(request.signal.reason);
    return Promise.resolve()
      .then(() => handle(request))
      .then((response) => {
        if (!response.body) return response;
        // Stop must behave like a real fetch: a pending read rejects with the
        // abort, and cancelling the upstream body stops the provider
        // generating (and billing) the rest of the reply.
        const { readable, writable } = new TransformStream();
        response.body.pipeTo(writable, { signal: request.signal }).catch(() => {});
        return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers });
      })
      .catch((err) => {
        logError(`[android] ${url.pathname} failed`, err);
        return new Response(JSON.stringify({ error: 'Internal error.' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      });
  };
}
