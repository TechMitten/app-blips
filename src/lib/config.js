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
// Light matches the canvas token (--color-slate-50 in index.css).
export const THEME_META_COLOR = { light: '#f1f3f5', dark: '#080808' };

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

export const CHAT_FONT_KEY = 'orion-chat-font';
export const CHAT_FONT_OPTIONS = ['small', 'default', 'large', 'xlarge'];

// One of CHAT_FONT_OPTIONS; anything else falls back to 'default'. The value
// only selects a CSS variable set (see the chat-font block in App.css), so the
// components themselves stay agnostic about concrete pixel sizes.
export const loadChatFont = () => {
  try {
    const stored = safeStorage('local')?.getItem(CHAT_FONT_KEY);
    return CHAT_FONT_OPTIONS.includes(stored) ? stored : 'default';
  } catch {
    return 'default';
  }
};

export const SHOW_CODE_VIEW_KEY = 'orion-show-code-view';

// Boolean: whether the Code tab is offered in the preview toolbar. Off by
// default, so casual users never see the raw generated HTML.
export const loadShowCodeView = () => {
  try {
    return safeStorage('local')?.getItem(SHOW_CODE_VIEW_KEY) === 'true';
  } catch {
    return false;
  }
};
