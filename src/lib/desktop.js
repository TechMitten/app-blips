import { listProviderModels } from '../../electron/server/providerModels.js';
import { resolveUserProvider } from '../../electron/server/providers.js';

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
  console.error(`[desktop] ${what} failed:`, err);
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

export const webProviderStore = {
  // Resolve credentials only for the outgoing request; get() keeps keys out
  // of settings state. A draft may change model/URL while reusing its key.
  forRequest(input = null) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('appblips-web-provider')); }
    catch { /* Ignore unavailable or invalid browser settings. */ }
    if (input) {
      return {
        ...input,
        apiKey: input.apiKey?.trim() || (saved?.id === input.id ? saved.apiKey : '') || '',
      };
    }
    if (!saved?.enabled || !saved.id || !saved.model) return null;
    return saved;
  },
  async listModels(input) {
    return listProviderModels(this.forRequest(input));
  },
  async get() {
    try {
      const { apiKey, ...info } = JSON.parse(localStorage.getItem('appblips-web-provider') || '{"enabled":false}');
      return { ...info, hasKey: Boolean(apiKey) };
    }
    catch { return { enabled: false }; }
  },
  async set(info) {
    let previous = {};
    try { previous = JSON.parse(localStorage.getItem('appblips-web-provider') || '{}'); }
    catch { /* Ignore invalid saved settings. */ }
    const apiKey = info.apiKey?.trim() || (previous.id === info.id ? previous.apiKey : '') || '';
    const resolved = resolveUserProvider({ ...info, apiKey });
    if (resolved.error) throw new Error(resolved.error);
    const next = { ...info, apiKey, baseUrl: resolved.baseUrl, local: Boolean(resolved.local) };
    localStorage.setItem('appblips-web-provider', JSON.stringify(next));
    return this.get();
  },
  async clear() {
    localStorage.removeItem('appblips-web-provider');
    return {};
  }
};

export const providerApi = bridge?.provider || webProviderStore;
