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

// sessionStorage flag remembering that the raw-log panel was unlocked in this
// tab. UI convenience only -- the PIN itself is checked server-side.
export const DEBUG_UNLOCKED_KEY = 'orion-debug-unlocked';

export const THEME_KEY = 'orion-theme';
// Mirrored by the pre-paint script in index.html -- keep both in sync.
// Light matches the canvas token (--color-slate-50 in index.css).
export const THEME_META_COLOR = { light: '#f1f3f5', dark: '#080808' };

// 'light' | 'dark' | 'system'. Anything unrecognised (or unreadable storage)
// falls back to dark.
export const loadThemePreference = () => {
  try {
    const stored = safeStorage('local')?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
  }
};

export const HAS_SIGNED_IN_KEY = 'orion-has-signed-in';

// Set once a session lands in this browser (sign-in, sign-up or a restored
// session); the auth modal uses it to open on "Sign in" instead of "Sign up".
// Deliberately survives sign-out: it says "this browser has an account", not
// "someone is signed in".
export const markHasSignedIn = () => {
  try {
    safeStorage('local')?.setItem(HAS_SIGNED_IN_KEY, 'true');
  } catch {
    // ignore unavailable storage
  }
};

export const hasSignedInBefore = () => {
  try {
    return safeStorage('local')?.getItem(HAS_SIGNED_IN_KEY) === 'true';
  } catch {
    return false;
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

export const START_FRESH_KEY = 'orion-start-fresh';

// Start-fresh marker: the user confirmed leaving the current app ("New App" /
// "Exit") or the workspace was reset, so page loads must land on the studio
// picker instead of auto-resuming the previously-open project. Cleared when a
// project is adopted (rememberProjectId) or the user cancels out of the
// picker, so it survives any number of reloads while the new-app flow is
// still in progress.
export const markStartFresh = () => {
  try {
    safeStorage('local')?.setItem(START_FRESH_KEY, 'true');
  } catch {
    // ignore unavailable storage
  }
};

export const clearStartFresh = () => {
  try {
    safeStorage('local')?.removeItem(START_FRESH_KEY);
  } catch {
    // ignore unavailable storage
  }
};

export const isStartFresh = () => {
  try {
    return safeStorage('local')?.getItem(START_FRESH_KEY) === 'true';
  } catch {
    return false;
  }
};

// Legacy single setting, read only to seed the build key below.
export const REASONING_EFFORT_KEY = 'orion-reasoning-effort';
// The initial build (first generation of an app/site) is the only call whose
// reasoning is user-configurable. Sent to /api/chat as `reasoning_effort`; a
// Low/High choice where Low is sent as 'low' and High as 'medium', since higher
// efforts made every call in a build pipeline think for minutes. Low is the
// default (and the minimum). Edits, error repair and chat calls are hardcoded
// to LOW in llm.js.
export const BUILD_REASONING_EFFORT_KEY = 'orion-reasoning-effort-build';
export const REASONING_EFFORT_OPTIONS = ['low', 'medium'];
// Efforts saved before the Low/High choice (and the legacy combined key); the
// top ones map to High, everything else falls back to Low.
const HIGH_EFFORTS = ['medium', 'high'];

// 'build' | 'ask'; anything unrecognised falls back to 'build'.
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

// Build reasoning only. Falls back to the legacy single setting, so users who
// had already picked an effort keep it. Older saved 'none' (and the pre-toggle
// 'medium'/'high') migrate: the top efforts become High, everything else
// becomes the Low default.
export const loadReasoningEffort = () => {
  try {
    const storage = safeStorage('local');
    const stored = storage?.getItem(BUILD_REASONING_EFFORT_KEY) ?? storage?.getItem(REASONING_EFFORT_KEY);
    return HIGH_EFFORTS.includes(stored) ? 'medium' : 'low';
  } catch {
    return 'low';
  }
};

export const HERO_RAIL_COLLAPSED_KEY = 'orion-hero-rail-collapsed';

// Boolean: whether the first-build screen's side rail is icon-only. Expanded
// (with labels) by default.
export const loadHeroRailCollapsed = () => {
  try {
    return safeStorage('local')?.getItem(HERO_RAIL_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const saveHeroRailCollapsed = (collapsed) => {
  try {
    safeStorage('local')?.setItem(HERO_RAIL_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage unavailable: the preference just doesn't persist.
  }
};
