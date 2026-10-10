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
// falls back to dark.
export const loadThemePreference = () => {
  try {
    const stored = safeStorage('local')?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
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

export const ASK_TO_REVIEW_KEY = 'orion-ask-to-review';

// Boolean: whether each finished build or edit offers an AI review (code check
// plus browser test). A review can take dozens of model calls, so it only runs
// when the user says yes; off means no offer and no review. On by default;
// only an explicit 'false' turns it off.
export const loadAskToReview = () => {
  try {
    return safeStorage('local')?.getItem(ASK_TO_REVIEW_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const GAME_ENGINE_ROUTER_KEY = 'orion-game-engine-router';

// Boolean: whether new games get an engine (Phaser, Three.js or none) picked
// from their genre. On by default; only an explicit 'false' turns it off.
export const loadGameEngineRouter = () => {
  try {
    return safeStorage('local')?.getItem(GAME_ENGINE_ROUTER_KEY) !== 'false';
  } catch {
    return true;
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

export const SPLASH_LAST_SHOWN_KEY = 'orion-splash-last-shown';
const SPLASH_REPLAY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The intro is for first impressions; replaying it on every reload or new tab
// just gets in a returning user's way. Show it at most once a day. Unreadable
// storage counts as due, so a locked-down browser still gets the intro.
export const isSplashDue = () => {
  try {
    const lastShown = Number(safeStorage('local')?.getItem(SPLASH_LAST_SHOWN_KEY));
    return !Number.isFinite(lastShown) || lastShown <= 0
      || Date.now() - lastShown >= SPLASH_REPLAY_INTERVAL_MS;
  } catch {
    return true;
  }
};

export const markSplashShown = () => {
  try {
    safeStorage('local')?.setItem(SPLASH_LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    // ignore unavailable storage
  }
};

export const CHECK_UPDATES_KEY = 'orion-check-updates';
export const DISMISSED_UPDATE_KEY = 'orion-update-dismissed';

// Boolean: whether the app asks GitHub for new releases
// (lib/updates.js, desktop updater). On by default; off is stored explicitly.
export const loadCheckUpdates = () => {
  try {
    return safeStorage('local')?.getItem(CHECK_UPDATES_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const saveCheckUpdates = (enabled) => {
  try {
    safeStorage('local')?.setItem(CHECK_UPDATES_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore unavailable storage
  }
};

// The release version whose update notice the user closed, so it doesn't
// come back until an even newer one is out.
export const loadDismissedUpdate = () => {
  try {
    return safeStorage('local')?.getItem(DISMISSED_UPDATE_KEY) || '';
  } catch {
    return '';
  }
};

export const saveDismissedUpdate = (version) => {
  try {
    safeStorage('local')?.setItem(DISMISSED_UPDATE_KEY, String(version));
  } catch {
    // ignore unavailable storage
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

// Session storage survives renderer reloads but ends when the app window
// closes. Read this before mounting React so StrictMode cannot consume the
// first-launch flag twice.
export const beginAppSession = () => {
  const key = 'orion-app-session-started';
  try {
    const storage = safeStorage('session');
    const coldStart = storage?.getItem(key) !== 'true';
    storage?.setItem(key, 'true');
    if (coldStart) markStartFresh();
    return coldStart;
  } catch {
    markStartFresh();
    return true;
  }
};

// Start-fresh marker: a cold launch, leaving the current app ("New App" /
// "Exit"), or a workspace reset means page loads must land on the studio
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
// Off/Low/High choice where Off is sent as 'none'. Off is the default.
// Edits, error repair and chat calls are hardcoded to LOW in llm.js.
export const BUILD_REASONING_EFFORT_KEY = 'orion-reasoning-effort-build';
export const REASONING_EFFORT_OPTIONS = ['none', 'low', 'high'];
// Older saved efforts (including the legacy combined key): the top ones map
// to High, and unrecognised values fall back to Off.
const HIGH_EFFORTS = ['medium', 'high'];

// Output limits are optional device settings. No saved value means the
// provider chooses its limit, independently for building and Ask mode.
export const BUILD_MAX_TOKENS_KEY = 'orion-max-tokens-build';
export const ASK_MAX_TOKENS_KEY = 'orion-max-tokens-ask';
const outputTokensKey = (askMode) => askMode ? ASK_MAX_TOKENS_KEY : BUILD_MAX_TOKENS_KEY;

export const loadOutputTokenLimit = (askMode = false) => {
  try {
    const stored = safeStorage('local')?.getItem(outputTokensKey(askMode));
    const value = Number(stored);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

export const saveOutputTokenLimit = (value, askMode = false) => {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)) return;
  try {
    const storage = safeStorage('local');
    if (value == null) storage?.removeItem(outputTokensKey(askMode));
    else storage?.setItem(outputTokensKey(askMode), String(value));
  } catch { /* storage unavailable */ }
};
// 'build' | 'ask'; anything unrecognised falls back to 'build'.
export const CHAT_MODE_KEY = 'orion-chat-mode';

// 'build' | 'ask'.
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
// had already picked an effort keep it. Older saved 'medium' migrates to High;
// missing or unrecognised values default to Off ('none').
export const loadReasoningEffort = () => {
  try {
    const storage = safeStorage('local');
    const stored = storage?.getItem(BUILD_REASONING_EFFORT_KEY) ?? storage?.getItem(REASONING_EFFORT_KEY);
    if (stored === 'none' || stored === 'low' || stored === 'high') return stored;
    if (HIGH_EFFORTS.includes(stored)) return 'high';
    return 'none';
  } catch {
    return 'none';
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
