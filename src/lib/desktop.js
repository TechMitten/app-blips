import { logError, logWarn } from './errorLog.js';

// Desktop (Electron) storage adapter. In the desktop app, electron/preload.cjs
// exposes window.appblipsDesktop and project data lives on disk instead of in
// localStorage; everywhere else this module is inert (isDesktop === false).
//
// The storage helpers callers already use (projectsStorage.js,
// previewStorage.js) are synchronous, so main.jsx awaits initDesktopStore()
// once before rendering and reads are served from this in-memory copy. Writes
// update the copy at once and go to disk over IPC in the background, only for
// the rows that actually changed. A failed write is logged and reported to
// onDesktopStorageError listeners (App shows a notice).

const bridge = typeof window !== 'undefined' ? window.appblipsDesktop || null : null;

export const isDesktop = Boolean(bridge);
export const desktopBridge = bridge;

// Serialized copies, so reads hand out fresh objects (like JSON.parse of
// localStorage did) and change detection is a string compare.
let rowJson = new Map(); // project id -> JSON of the row
const appDataJson = new Map(); // project id -> JSON of the generated app's storage map

// The latest failure stays until dismissed, so a listener that subscribes
// later (or remounts) still sees it.
const errorListeners = new Set();
let lastError = null;

export const onDesktopStorageError = (listener) => {
  errorListeners.add(listener);
  listener(lastError);
  return () => errorListeners.delete(listener);
};

export const dismissDesktopStorageError = () => {
  lastError = null;
  errorListeners.forEach((listener) => listener(null));
};

// An IPC rejection's message without Electron's "Error invoking remote
// method ..." prefix or a trailing period.
export const ipcErrorMessage = (err) => String(err?.message || err || '')
  .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  .replace(/\.$/, '');

const report = (what) => (err) => {
  logError(`${what} failed`, err);
  lastError = `${what} failed: ${ipcErrorMessage(err)}`;
  errorListeners.forEach((listener) => listener(lastError));
};

export async function initDesktopStore() {
  if (!bridge) return;
  try {
    const { projects, orphanAppData } = await bridge.projects.list();
    for (const { row, appData } of projects) {
      rowJson.set(row.id, JSON.stringify(row));
      if (appData) appDataJson.set(row.id, JSON.stringify(appData));
    }
    for (const [id, map] of Object.entries(orphanAppData || {})) appDataJson.set(id, JSON.stringify(map));
  } catch (err) {
    report('Loading your projects')(err);
  }
}

export const readDesktopRows = () => [...rowJson.values()].map((json) => JSON.parse(json));

export function writeDesktopRows(rows) {
  const next = new Map();
  for (const row of rows) next.set(row.id, JSON.stringify(row));
  for (const [id, json] of next) {
    if (rowJson.get(id) !== json) bridge.projects.save(JSON.parse(json)).catch(report('Saving a project'));
  }
  for (const id of rowJson.keys()) {
    if (!next.has(id)) bridge.projects.delete(id).catch(report('Deleting a project'));
  }
  rowJson = next;
}

// A Storage-like view over the generated apps' data for previewStorage.js,
// whose keys are `${prefix}${projectId}`.
export function createAppDataStorage(prefix) {
  const idOf = (key) => (typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : null);
  const keys = () => [...appDataJson.keys()].map((id) => prefix + id);
  return {
    get length() { return appDataJson.size; },
    key: (index) => keys()[index] ?? null,
    getItem(key) {
      const id = idOf(key);
      return id === null ? null : appDataJson.get(id) ?? null;
    },
    setItem(key, value) {
      const id = idOf(key);
      if (id === null || appDataJson.get(id) === value) return;
      appDataJson.set(id, value);
      bridge.appData.save(id, JSON.parse(value)).catch(report("Saving an app's data"));
    },
    removeItem(key) {
      const id = idOf(key);
      if (id === null || !appDataJson.has(id)) return;
      appDataJson.delete(id);
      bridge.appData.save(id, null).catch(report("Clearing an app's data"));
    },
  };
}

// The browser version's Settings → AI (npm run dev, server.js, Docker). The
// choice of provider, model and URL is kept in this origin's localStorage, but
// the API key is not: localStorage is plain text that any script on this
// origin, or anyone with the browser profile, can read. The key goes to
// AppBlips' own server (/api/provider, electron/server/providerApi.js), which
// keeps it in a private file and attaches it to /api/chat, as the desktop
// app's main process does. The page only ever learns `hasKey`.
const WEB_PROVIDER_KEY = 'appblips-web-provider';

const readWebProvider = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(WEB_PROVIDER_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (err) {
    // Not the error itself: a JSON SyntaxError's message can quote the saved data.
    if (err?.name === 'SyntaxError') logWarn('Saved AI provider settings are not valid JSON, treating them as not set');
    return {};
  }
};

const writeWebProvider = (info) => {
  // A key is never written here.
  const rest = { ...info };
  delete rest.apiKey;
  delete rest.hasKey;
  localStorage.setItem(WEB_PROVIDER_KEY, JSON.stringify(rest));
};

const providerRequest = async (path, method = 'GET', body = undefined) => {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  let data = null;
  try { data = await response.json(); } catch { /* not JSON: reported below */ }
  if (!response.ok) throw new Error(data?.error || `AppBlips' server could not save the AI settings (HTTP ${response.status}).`);
  return data;
};

// Versions before this one kept the key in localStorage. Hand it to the
// server once and remove it from the browser; until that succeeds it stays
// where it was, so a failed move never loses the key.
let legacyKeyMove = null;
const moveLegacyKey = () => {
  if (legacyKeyMove) return legacyKeyMove;
  const saved = readWebProvider();
  if (typeof saved.apiKey !== 'string') return Promise.resolve();
  legacyKeyMove = (saved.apiKey.trim() && saved.id
    ? providerRequest('/api/provider', 'PUT', { id: saved.id, apiKey: saved.apiKey })
    : Promise.resolve()
  ).then(
    () => writeWebProvider(readWebProvider()),
    (err) => {
      legacyKeyMove = null;
      logWarn('Could not move the saved API key to AppBlips\' server, keeping it in the browser for now', err);
    },
  );
  return legacyKeyMove;
};

export const webProviderStore = {
  // The provider for an outgoing /api/chat request, without a key: the server
  // attaches the saved one (withSavedProvider). A draft from "Test connection"
  // goes as given, with its typed key or an empty one meaning "the saved key".
  forRequest(input = null) {
    if (input) return input;
    const { enabled, id, model, baseUrl } = readWebProvider();
    if (!enabled || !id || !model) return null;
    return { id, model, baseUrl: baseUrl || '' };
  },
  async listModels(input) {
    await moveLegacyKey();
    return providerRequest('/api/provider/models', 'POST', input);
  },
  async get() {
    await moveLegacyKey();
    const info = readWebProvider();
    // A legacy key the move couldn't hand over yet.
    delete info.apiKey;
    let server = { id: '', hasKey: false };
    try { server = await providerRequest('/api/provider'); }
    catch (err) { logWarn('Could not ask AppBlips\' server for the saved API key', err); }
    return { enabled: false, ...info, hasKey: Boolean(info.id && server.id === info.id && server.hasKey) };
  },
  async set(info) {
    await moveLegacyKey();
    const previous = readWebProvider();
    // "Skip for now" in onboarding: remember it without saving a provider.
    if (info.onboardingComplete === true && info.id === undefined) {
      writeWebProvider({ enabled: false, ...previous, onboardingComplete: true });
      return this.get();
    }
    // The server checks the settings (with the saved key when none is typed)
    // and keeps the key; only the rest is saved here.
    const saved = await providerRequest('/api/provider', 'PUT', info);
    writeWebProvider({
      ...info,
      baseUrl: saved.baseUrl,
      local: Boolean(saved.local),
      onboardingComplete: Boolean(previous.onboardingComplete || info.enabled),
    });
    return this.get();
  },
  async clear({ resetOnboarding = false } = {}) {
    // Keep the onboarding flag, as the desktop store does, so clearing a
    // provider doesn't replay setup (unless this is Settings → Reset).
    const previous = readWebProvider();
    await providerRequest('/api/provider', 'DELETE');
    if (previous.onboardingComplete && !resetOnboarding) writeWebProvider({ enabled: false, onboardingComplete: true });
    else localStorage.removeItem(WEB_PROVIDER_KEY);
    return {};
  }
};

export const providerApi = bridge?.provider || webProviderStore;
