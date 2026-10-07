// The desktop app's AI provider (Settings → AI): a preset id, a model and an
// API key. The key is encrypted with Electron's safeStorage (OS keychain:
// DPAPI on Windows, libsecret/kwallet on Linux) and only ever decrypted in the
// main process. The renderer sees { enabled, id, model, hasKey }, never the key.
//
// Plain Node apart from the injected `crypto` ({ isEncryptionAvailable,
// encryptString, decryptString, getSelectedStorageBackend? }), so it can be
// tested without Electron.
import { readFileSync } from 'node:fs';
import { USER_PROVIDER_OPTIONS } from '../electron/server/providers.js';
import { writeFileAtomic } from './projectStore.js';

const PROVIDER_IDS = new Set(USER_PROVIDER_OPTIONS.map((p) => p.id));
const MAX_FIELD = 512;

const clean = (value) => String(value ?? '').trim().slice(0, MAX_FIELD);

export function createProviderStore({ file, crypto }) {
  let state = { enabled: false, id: '', model: '', key: null, onboardingComplete: false }; // key: { cipher } | { plain }

  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    state = {
      enabled: saved.enabled === true,
      id: PROVIDER_IDS.has(saved.id) ? saved.id : '',
      model: typeof saved.model === 'string' ? saved.model : '',
      key: saved.key && typeof saved.key === 'object' ? saved.key : null,
      // provider.json did not exist before somebody used AI settings. Treat
      // every legacy file as already onboarded, including one left behind by
      // Clear, so upgrading or clearing settings never replays first run.
      onboardingComplete: saved.onboardingComplete !== false,
    };
  } catch { /* first run */ }

  const encrypted = () => crypto.isEncryptionAvailable();
  // Linux without a keyring falls back to a hardcoded key ('basic_text'):
  // better than plain text, but worth telling the user about.
  const weakEncryption = () => !encrypted()
    || crypto.getSelectedStorageBackend?.() === 'basic_text';

  const decryptKey = () => {
    if (!state.key) return '';
    try {
      if (typeof state.key.cipher === 'string') return crypto.decryptString(Buffer.from(state.key.cipher, 'base64'));
      if (typeof state.key.plain === 'string') return state.key.plain;
    } catch (err) {
      console.warn('[providerStore] could not decrypt the saved API key:', err.message);
    }
    return '';
  };

  const encryptKey = (apiKey) => (encrypted()
    ? { cipher: crypto.encryptString(apiKey).toString('base64') }
    : { plain: apiKey });

  const persist = () => writeFileAtomic(file, JSON.stringify(state, null, 2));

  return {
    // Safe to hand to the renderer.
    describe() {
      return {
        enabled: state.enabled,
        id: state.id,
        model: state.model,
        hasKey: Boolean(state.key),
        weakEncryption: weakEncryption(),
        onboardingComplete: state.onboardingComplete,
      };
    },

    // Partial update. An empty/missing apiKey keeps the saved key, unless the
    // provider changes: a key never carries over to a different provider.
    async set({ enabled, id, model, apiKey } = {}) {
      const next = { ...state };
      if (enabled !== undefined) next.enabled = enabled === true;
      if (id !== undefined) {
        if (!PROVIDER_IDS.has(id)) throw new Error('Unknown provider.');
        if (id !== state.id) next.key = null;
        next.id = id;
      }
      if (model !== undefined) next.model = clean(model);
      const key = clean(apiKey);
      if (key) next.key = encryptKey(key);
      if (next.enabled && next.id && next.model && next.key) next.onboardingComplete = true;
      state = next;
      await persist();
      return this.describe();
    },

    async clear() {
      state = { enabled: false, id: '', model: '', key: null, onboardingComplete: state.onboardingComplete };
      await persist();
      return this.describe();
    },

    // { id, model, apiKey } when switched on and complete, else null.
    active() {
      if (!state.enabled || !state.id || !state.model) return null;
      const apiKey = decryptKey();
      return apiKey ? { id: state.id, model: state.model, apiKey } : null;
    },

    // The saved key for `id`, for a "Test connection" on unsaved model edits.
    keyFor(id) {
      return id && id === state.id ? decryptKey() : '';
    },
  };
}
