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
// falls back to light.
export const loadThemePreference = () => {
  try {
    const stored = safeStorage('local')?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
  } catch {
    return 'light';
  }
};
