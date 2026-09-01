export const LLM_CONFIG_KEY = 'orion-llm-config';
export const LLM_REMEMBER_KEY = 'orion-llm-remember';

export const DEFAULT_LLM_CONFIG = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  reasoning: 'none',
  max_tokens: ''
};

// There is no way to hide a key from the machine that types it in a
// backend-less SPA. What the sandboxed preview frame buys us is the part that
// matters: generated code can no longer read it. This toggle is the remaining
// bit of hygiene -- session-only storage for shared or untrusted machines.
export const safeStorage = (kind) => {
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    void store.length;
    return store;
  } catch {
    return null;
  }
};

export const THEME_KEY = 'orion-theme';
// Mirrored by the pre-paint script in index.html -- keep both in sync.
export const THEME_META_COLOR = { light: '#f8fafc', dark: '#080808' };

// 'light' | 'dark' | 'system'. Anything unrecognised (or unreadable storage)
// falls back to following the OS.
export const loadThemePreference = () => {
  try {
    const stored = safeStorage('local')?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
};

// Defaults to true: existing installs already keep their config in localStorage.
export const loadRememberKey = () => {
  try {
    return safeStorage('local')?.getItem(LLM_REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const configStore = (remember) => safeStorage(remember ? 'local' : 'session');

export const readStoredConfig = (store) => {
  try {
    const raw = store?.getItem(LLM_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.baseUrl || parsed.apiKey || parsed.model)) {
      return {
        baseUrl: parsed.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
        apiKey: parsed.apiKey || '',
        model: parsed.model || DEFAULT_LLM_CONFIG.model,
        reasoning: parsed.reasoning === true ? 'medium' : (parsed.reasoning === false ? 'none' : (parsed.reasoning || 'none')),
        max_tokens: parsed.max_tokens || ''
      };
    }
  } catch { /* ignore invalid stored config */ }
  return null;
};

export const loadLlmConfig = () => {
  const remember = loadRememberKey();
  // Fall back to the other store so toggling mid-session never loses the key.
  return readStoredConfig(configStore(remember))
    || readStoredConfig(configStore(!remember))
    || { ...DEFAULT_LLM_CONFIG };
};

export const saveLlmConfig = (config, remember = loadRememberKey()) => {
  try { configStore(remember)?.setItem(LLM_CONFIG_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  try { configStore(!remember)?.removeItem(LLM_CONFIG_KEY); } catch { /* ignore */ }
};

export const saveRememberKey = (remember, config) => {
  try { safeStorage('local')?.setItem(LLM_REMEMBER_KEY, remember ? 'true' : 'false'); } catch { /* ignore */ }
  saveLlmConfig(config, remember);
};

// The key crosses the network in cleartext on a plain-http remote endpoint.
// Local model servers over http are fine, and are the common case.
export const isInsecureEndpoint = (baseUrl) => {
  const trimmed = (baseUrl || '').trim();
  if (!/^http:\/\//i.test(trimmed)) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
};

export const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};
