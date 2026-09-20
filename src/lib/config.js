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

// One of CHAT_FONT_OPTIONS; anything else falls back to 'small'. The value
// only selects a CSS variable set (see the chat-font block in App.css), so the
// components themselves stay agnostic about concrete pixel sizes.
export const loadChatFont = () => {
  try {
    const stored = safeStorage('local')?.getItem(CHAT_FONT_KEY);
    return CHAT_FONT_OPTIONS.includes(stored) ? stored : 'small';
  } catch {
    return 'small';
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

export const ASK_CLARIFYING_QUESTIONS_KEY = 'orion-ask-clarifying-questions';

// Boolean: whether the AI should ask clarifying questions before building. Off by
// default; an explicitly saved user choice is preserved.
export const loadAskClarifyingQuestions = () => {
  try {
    return safeStorage('local')?.getItem(ASK_CLARIFYING_QUESTIONS_KEY) === 'true';
  } catch {
    return false;
  }
};

export const SKIP_SPLASH_KEY = 'orion-skip-splash';

// Boolean: when true the splash screen is skipped entirely on load. Off by
// default so new users still see the branded intro.
export const loadSkipSplash = () => {
  try {
    return safeStorage('local')?.getItem(SKIP_SPLASH_KEY) === 'true';
  } catch {
    return false;
  }
};

export const AUTO_FOLLOW_CODE_KEY = 'orion-auto-follow-code';

// Boolean: whether the Code tab auto-scrolls to follow the latest streamed
// line during generation. On by default; an explicitly saved user choice is
// preserved.
export const loadAutoFollowCode = () => {
  try {
    const stored = safeStorage('local')?.getItem(AUTO_FOLLOW_CODE_KEY);
    return stored === null || stored === undefined ? true : stored === 'true';
  } catch {
    return true;
  }
};

export const LIVE_CODE_PREVIEW_KEY = 'orion-live-code-preview';

// Boolean: whether the build overlay in the preview pane shows the streaming
// code peek while generating. On by default; an explicitly saved user choice is
// preserved.
export const loadLiveCodePreview = () => {
  try {
    const stored = safeStorage('local')?.getItem(LIVE_CODE_PREVIEW_KEY);
    return stored === null || stored === undefined ? true : stored === 'true';
  } catch {
    return true;
  }
};

export const BUILD_PANE_SIDE_KEY = 'orion-build-pane-side';

// Which side of the workspace the build pane sits on: 'left' (default) or 'right'.
export const loadBuildPaneSide = () => {
  try {
    return safeStorage('local')?.getItem(BUILD_PANE_SIDE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
};

export const REASONING_EFFORT_KEY = 'orion-reasoning-effort';
// Sent to /api/chat as `reasoning_effort` for the heavy generation call. 'none'
// disables reasoning; the rest map straight to the OpenAI-compatible values.
export const REASONING_EFFORT_OPTIONS = ['none', 'low', 'medium', 'high'];

// One of REASONING_EFFORT_OPTIONS; anything unrecognised falls back to 'none',
// which is also the default so reasoning stays off until the user opts in.
export const CHAT_MODE_KEY = 'orion-chat-mode';

// 'build' | 'ask'. The AI stop of the mode reel is Build + aiEnabled, which is
// saved per project, so only the build/ask half needs remembering here.
export const loadChatMode = () => {
  try {
    return safeStorage('local')?.getItem(CHAT_MODE_KEY) === 'ask' ? 'ask' : 'build';
  } catch {
    return 'build';
  }
};

export const saveChatMode = (mode) => {
  try {
    safeStorage('local')?.setItem(CHAT_MODE_KEY, mode === 'ask' ? 'ask' : 'build');
  } catch {
    // ignore unavailable storage
  }
};

export const loadReasoningEffort = () => {
  try {
    const stored = safeStorage('local')?.getItem(REASONING_EFFORT_KEY);
    return REASONING_EFFORT_OPTIONS.includes(stored) ? stored : 'none';
  } catch {
    return 'none';
  }
};
