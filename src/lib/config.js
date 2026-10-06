import { isDesktop } from './desktop.js';
import { USER_PROVIDER_IDS } from '../../functions/_lib/providers.js';

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

// Per account: the Plans screen was already shown after sign-up in this
// browser, so a reload in the sign-up session doesn't show it again.
const PLANS_PROMPTED_KEY = 'orion-plans-prompted';

export const markPlansPrompted = (uid) => {
  try {
    safeStorage('local')?.setItem(`${PLANS_PROMPTED_KEY}:${uid}`, 'true');
  } catch {
    // ignore unavailable storage
  }
};

export const wasPlansPrompted = (uid) => {
  try {
    return safeStorage('local')?.getItem(`${PLANS_PROMPTED_KEY}:${uid}`) === 'true';
  } catch {
    return false;
  }
};

// sessionStorage marker set just before the web OAuth flow navigates away to
// Google/GitHub. The provider sends the tab back with a full page load, which
// would otherwise look like a fresh visit (splash replays, the restored
// session is treated as silent). Per-tab, so only the tab that started the
// sign-in sees it.
export const OAUTH_RETURN_KEY = 'orion-oauth-return';

export const markOAuthRedirect = () => {
  try {
    safeStorage('session')?.setItem(OAUTH_RETURN_KEY, 'true');
  } catch {
    // ignore unavailable storage
  }
};

// Reads and clears the marker, so a later manual reload is a normal load.
export const consumeOAuthReturn = () => {
  try {
    const store = safeStorage('session');
    const returning = store?.getItem(OAUTH_RETURN_KEY) === 'true';
    store?.removeItem(OAUTH_RETURN_KEY);
    return returning;
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

export const SPLASH_LAST_SHOWN_KEY = 'orion-splash-last-shown';
const SPLASH_REPLAY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The intro is for first impressions; replaying it on every reload or new tab
// just gets in a returning user's way. Show it at most once a day. Unreadable
// storage counts as due, so a locked-down browser still gets the intro.
export const isSplashDue = () => {
  try {
    const last = Number(safeStorage('local')?.getItem(SPLASH_LAST_SHOWN_KEY));
    return !(last > 0 && Date.now() - last < SPLASH_REPLAY_INTERVAL_MS);
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

// Boolean: whether a self-hosted copy asks GitHub for new releases
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
// Low/High choice where Low is sent as 'low' and High as 'high'. Low is the
// default (and the minimum). Edits, error repair and chat calls are hardcoded
// to LOW in llm.js.
export const BUILD_REASONING_EFFORT_KEY = 'orion-reasoning-effort-build';
export const REASONING_EFFORT_OPTIONS = ['none', 'low', 'high'];
// Efforts saved before the Low/High choice (and the legacy combined key); the
// top ones map to High, everything else falls back to Low.
const HIGH_EFFORTS = ['medium', 'high'];

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
// had already picked an effort keep it. Older saved 'none' (and the pre-toggle
// 'medium'/'high') migrate: the top efforts become High, everything else
// becomes the Low default.
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

export const USER_PROVIDER_KEY = 'orion-user-provider';

// The user's own AI provider from Settings → AI: { enabled, id, model, apiKey,
// remember }. Lives in localStorage when `remember` is on, otherwise in
// sessionStorage (gone when the tab closes); never both. It is sent to
// /api/chat with each request (llm.js) and replaces the server's env provider
// for that request. Never put it in project data, exports or the preview.
const parseUserProvider = (raw) => {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    return {
      enabled: value.enabled === true,
      id: typeof value.id === 'string' ? value.id : '',
      model: typeof value.model === 'string' ? value.model : '',
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    };
  } catch {
    return null;
  }
};

export const loadUserProvider = () => {
  const session = safeStorage('session')?.getItem(USER_PROVIDER_KEY);
  if (session) {
    const parsed = parseUserProvider(session);
    if (parsed) return { ...parsed, remember: false };
  }
  const local = safeStorage('local')?.getItem(USER_PROVIDER_KEY);
  const parsed = local ? parseUserProvider(local) : null;
  return parsed ? { ...parsed, remember: true } : null;
};

export const clearUserProvider = () => {
  try { safeStorage('local')?.removeItem(USER_PROVIDER_KEY); } catch { /* storage unavailable */ }
  try { safeStorage('session')?.removeItem(USER_PROVIDER_KEY); } catch { /* storage unavailable */ }
};

// Returns false when the chosen storage is unavailable.
export const saveUserProvider = ({ enabled, id, model, apiKey, remember }) => {
  clearUserProvider();
  try {
    const store = safeStorage(remember ? 'local' : 'session');
    if (!store) return false;
    store.setItem(USER_PROVIDER_KEY, JSON.stringify({
      enabled: !!enabled,
      id: String(id || ''),
      model: String(model || '').trim(),
      apiKey: String(apiKey || '').trim(),
    }));
    return true;
  } catch {
    return false;
  }
};

// { id, model, apiKey } for /api/chat when the user's provider is switched on
// and complete, otherwise null (the server's env provider is used).
// The desktop app keeps the provider in the main process (Settings → AI writes
// it there) and attaches it to /api/chat itself, so the renderer sends none.
export const activeUserProvider = () => {
  if (isDesktop) return null;
  const cfg = loadUserProvider();
  if (!cfg?.enabled || !cfg.id || !cfg.model.trim() || !cfg.apiKey.trim()) return null;
  // A provider saved before it was dropped from the list would be refused by
  // /api/chat on every request; ignore it so the env provider answers instead.
  if (!USER_PROVIDER_IDS.includes(cfg.id)) return null;
  return { id: cfg.id, model: cfg.model.trim(), apiKey: cfg.apiKey.trim() };
};
