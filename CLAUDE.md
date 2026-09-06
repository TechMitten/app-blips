# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AppBlips is a React SPA that generates small single-file HTML apps from a text prompt via an OpenAI-chat-completions-compatible LLM API, then renders them live in a sandboxed preview iframe. There is no application backend beyond a single proxy endpoint: the LLM endpoint, key, model, and tuning knobs are fixed server-side via env vars (not user-configurable), and the browser calls `/api/chat` on AppBlips's own origin rather than the LLM provider directly. See "LLM proxy" below.

The app runs in one of two modes, chosen entirely by env vars (see "Hosting modes: self-hosted vs. Firebase-hosted" below) — there's no runtime toggle:
- **Self-hosted** (default): single local user, no sign-in, no cloud sync, no deploy-to-public-URL. Nothing talks to Firebase.
- **Hosted**: Firebase Auth + Firestore (projects, deployments) + Storage (deployed HTML), fronted by a Cloudflare Pages Function that verifies ID tokens before relaying to the LLM.

## Commands

- `npm run dev` — start Vite dev server (port 5173, `host: true` for LAN/devcontainer access)
- `npm run build` — production build
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run preview` — preview the production build

There is no automated test suite wired to `npm test`. `testing/` holds standalone scripts run directly with node (e.g. `node testing/test-reply.js`, `node testing/testSyntax.js`) that exercise `generateAppCode`/`checkSyntax` against a real LLM call or fixture HTML — not a CI-run suite.

## Architecture

The app is split into `App.jsx` (workspace/generation state + composition), `src/lib/` (framework-free logic), `src/hooks/` (stateful concerns), and `src/components/` (presentational UI):

- **[src/App.jsx](src/App.jsx)** — the `App` component: owns the workspace/generation state (prompt, `generatedCode`, `versions`/undo-redo, streaming refs, `handleGenerate`, naming/new-app flow, `resetCurrentWorkspace`) and composes everything else.
- **[src/previewBridge.js](src/previewBridge.js)** — a self-contained script injected into the generated app's HTML at render time, documented in detail in its file header.
- **[src/firebase.js](src/firebase.js)** — the single Firebase SDK init point, gated on `firebaseEnabled` (`SELF_HOSTED_MODE === 'false'`). When disabled, `app`/`auth`/`db`/`storage` all stay `null` and no Firebase code (including the App Check network call) runs.
- **src/lib/** — pure logic, no React:
  - `llm.js` — `requestModelText` / `generateAppCode` / `generateContextualSuggestions` / `generateNewStarterIdeas` (the API layer; attaches the Firebase ID token + App Check token to every `/api/chat` call)
  - `edits.js` — `sanitizeHtmlResponse` + the surgical-edit engine (`applySurgicalEdits` and friends)
  - `prompts.js` — system prompts and tool schemas; `constants.js` — presets, `PREVIEW_MODES`, marquee/streaming constants
  - `config.js` — theme/UI-preference persistence helpers; `helpers.js` — syntax highlighter, preview-box math, misc
  - `syntaxCheck.js` — Acorn-based JS syntax check for generated `<script>` blocks; `markdown.js` — small dependency-free markdown renderer for chat transcript text
  - `deploy.js` — public-URL deployment (Firestore `deployments` doc + Storage upload); `projectsStorage.js` — localStorage↔Firestore project row plumbing
  - `crypto.js` — client-side PBKDF2/AES-GCM encryption for password-protected deploys, wrapping the HTML in a standalone unlock-screen page
  - `pwa.js` / `analytics.js` / `seo.js` — snippets spliced into deployed HTML at deploy time (and re-injected at serve time in `functions/[[path]].js`) for installability, Umami analytics (hosted mode only), and noindex/favicon tags
  - `pendingJob.js` — persists an in-flight generation to `localStorage` so an interrupted build can be detected and offered for retry on next load
  - `auth/` — the auth adapter; see "Hosting modes" below
- **src/hooks/** — `useTheme`, `useChatFont`, `useAuth` (session + one-time local→cloud import offer), `useProjects` (list/persistence/resume), `useDeployment`, `usePreviewViewport` (mode/orientation/zoom), `useBuildPaneResize`, `usePreviewBridge` (the postMessage driver), `useSuggestions`.
- **src/components/** — `Header`, `HistorySidebar`, `BuildPanel` (with `StarterIdeas`, `ChatTranscript`, `SuggestionsBar`, `PromptInput`), `PreviewPane` (with `DeviceMockup`, `CodeView`), `SplashScreen`, `AuthToast`, and modals: `Modal`/`ConfirmModal` (shared shells), `SettingsModal`, `ProjectsListModal`, `DeployModal`, `NamingModal`, `AuthModal`, `ImportModal`, `AccountSettingsModal`. Self-contained modals (`AuthModal`, `SettingsModal`, `AccountSettingsModal`) own their form state and talk to `firebase`/`lib/config` directly. Auth-related UI (`AuthModal`, sign-in affordances in `Header`) only renders when `firebaseEnabled`.

### Hosting modes: self-hosted vs. Firebase-hosted

One env var, `SELF_HOSTED_MODE`, drives both the browser bundle ([src/firebase.js](src/firebase.js)) and the server-side proxy (`functions/_lib/chatProxy.js`), even though those are two different runtimes: it has no `VITE_` prefix (unlike `VITE_FIREBASE_*` below), but `vite.config.js`'s `envPrefix` explicitly allow-lists it into `import.meta.env` too, alongside the default `VITE_` prefix. Default is unset/anything other than `"false"` = self-hosted; set `SELF_HOSTED_MODE=false` for hosted mode.
- Self-hosted: [src/lib/auth/mockAuthProvider.js](src/lib/auth/mockAuthProvider.js) supplies a single fixed always-signed-in `local-user`; every method besides `onAuthStateChanged` is a no-op (auth UI never renders in this mode, so they're unreachable in practice). `/api/chat` treats every request as that same local user and performs no token check — self-hosters exposing the app beyond localhost are responsible for their own access control.
- Hosted: [src/lib/auth/firebaseAuthProvider.js](src/lib/auth/firebaseAuthProvider.js) backs real sign-in (email/password, GitHub, Google) via Firebase Auth. `/api/chat` requires a valid Firebase ID token (verified server-side via the `accounts:lookup` REST endpoint, not just "a token was present") plus an optional App Check token; a missing/invalid token gets a 401. Projects sync to Firestore (`projects` collection) and deploys go through Firestore (`deployments` collection, slug → storage path) + Storage (`orion-deploys` bucket) — see `firestore.rules`/`storage.rules` for the per-user ownership checks.
- [src/lib/auth/index.js](src/lib/auth/index.js) picks between the two providers based on `firebaseEnabled`; `useAuth`/`AuthModal`/`llm.js`/etc. only ever import from `lib/auth`, never the concrete providers, so they stay unaware of which is active.
- On first sign-in in hosted mode, `useAuth`'s import flow offers to migrate any `localStorage['orion-projects']` rows into Firestore (one-time per user, flagged via `orion-imported-<uid>`).

### Generation flow

1. **Initial generation** (`generatedCode` is empty): `buildInitialGenerationPrompt` builds a layout-specific instruction (mobile/desktop/both), sent with `HTML_SYSTEM_PROMPT` as a single non-tool completion. The response is cleaned by `sanitizeHtmlResponse` (strips markdown fences, finds `<!DOCTYPE html>`/`<html>` boundaries) to get raw HTML.
2. **Refinement** (`generatedCode` already exists): switches to a "surgical edit" loop. The model is forced (`tool_choice`) to call `apply_surgical_edits` with search/replace blocks anchored on `<!-- @section: name -->` landmark comments. `applySurgicalEdits` tries an exact string match first, then a whitespace-normalized fuzzy line-by-line match. On failure it retries up to 3 times, feeding the error back to the model as corrective context (`generateAppCode`'s self-healing loop).
3. Both paths go through `requestModelText`, which POSTs to `/api/chat` (same-origin proxy, see "LLM proxy" below) with exponential backoff retry (`delays` array) and supports SSE streaming (`onChunk`) with a 60s stall timeout, accumulating both text deltas and `tool_calls` deltas.

Each successful generation/edit is pushed onto a `versions` array (undo/redo via `currentVersionIndex`); going back and generating again truncates future versions, like standard undo history. `pendingJob.js` records the in-flight prompt/project before each generation starts so an interrupted build (tab closed mid-stream) can be detected and retried on next load.

### Preview isolation (security-critical — read before touching this)

The generated app's HTML is never rendered directly. `injectPreviewBridge` (in `previewBridge.js`) splices a bridge `<script>` into the head/html/body of `generatedCode` at render time only, producing `srcDoc` fed to an iframe that has `sandbox` **without** `allow-same-origin` — the frame's origin is opaque, so the parent cannot reach `iframe.contentDocument` and generated code cannot reach the parent.

Consequences that matter when editing this code:
- The bridge is computed in a `useMemo` in `App.jsx` and is **never** written back into `generatedCode`. It must stay out of downloads, the clipboard, the code panel, `localStorage['orion-projects']`, and especially out of reach of `applySurgicalEdits`'s fuzzy matcher (which would otherwise happily "fix" bridge code during a refinement pass).
- Parent↔frame communication is `postMessage` only, authenticated by a per-render random `token` plus checking `event.source === iframe.contentWindow` (never `event.origin`, which is always the string `"null"` for an opaque origin). `targetOrigin: '*'` is required and is safe only because the protocol never carries a secret — don't add one.
- The bridge shims `localStorage`/`sessionStorage`/`document.cookie` inside the frame (real APIs throw `SecurityError` on an opaque origin) and implements the mobile touch-scroll/momentum simulation, toggled on/off via a `configure` message keyed to `previewMode === 'mobile'`.
- `BRIDGE_SOURCE` is checked at module load to contain no literal `</`, which would truncate the injected `<script>` tag.

### LLM proxy

- The LLM base URL, API key, model, `max_tokens`, and reasoning effort are **not** user-configurable — they're read server-side from `APPBLIPS_LLM_BASE_URL` / `APPBLIPS_LLM_API_KEY` / `APPBLIPS_LLM_MODEL` / `APPBLIPS_LLM_MAX_TOKENS` / `APPBLIPS_LLM_REASONING_EFFORT` env vars (see `.env.example`). None are `VITE_`-prefixed, so Vite never inlines them into the client bundle.
- `functions/_lib/chatProxy.js` (`handleChatProxy(request, env)`) is the single implementation of the proxy: it builds the upstream OpenAI-style request from env + the client's `{ messages, tools, tool_choice, stream, reasoning_effort }` body, and streams the upstream response straight back — it's a transparent relay, not a reimplementation, so `requestModelText`'s SSE-parsing/retry logic in `src/lib/llm.js` is unaware a proxy exists.
- In **hosted mode** (`SELF_HOSTED_MODE=false`), every request must carry a valid Firebase ID token, verified against Firebase's `accounts:lookup` endpoint (plus `FIREBASE_API_KEY`); a missing/invalid token is rejected with 401 before the request reaches the LLM. In **self-hosted mode** (default), there is no token check at all — anyone who can reach `/api/chat` spends the configured LLM budget, so self-hosters exposing this beyond localhost need their own access control in front of it. `APPBLIPS_CHAT_RATE_LIMIT_MAX`/`APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS` exist as config but `checkRateLimit` is currently a stub that always allows.
- In production (Cloudflare Pages) this runs as the Pages Function `functions/api/chat.js`, which just calls `handleChatProxy`. `functions/[[path]].js` is a separate, unrelated Function serving deployed user apps on a second hostname (`my.appblips.com`) — don't conflate the two.
- In local dev (`npm run dev`, plain Vite — Pages Functions don't run under Vite), `vite.config.js` registers dev-server middleware on `/api/chat` that calls the same `handleChatProxy`, forwarding the `authorization` and `x-firebase-appcheck` headers and reading env via `loadEnv(mode, cwd, '')` from a local `.env`. This keeps `npm run dev` working with no `wrangler` dependency and no behavior drift between dev and prod.
- Cloudflare Pages deployments need the same env vars set under Settings → Environment variables (`APPBLIPS_LLM_API_KEY` and, in hosted mode, `FIREBASE_API_KEY` marked Secret) — nothing in the app config does this automatically.
- Projects are persisted to `localStorage['orion-projects']` as `{id, name, data: {versions, currentVersionIndex}, updatedAt}` rows in self-hosted mode (or as the pre-import cache in hosted mode); the last-open project id is in `localStorage['orion-current-project-id']`.

### Deploy-to-public-URL (hosted mode only)

- `deploy.js` uploads `generatedCode` (never the preview bridge) as a single `.html` object to the Firebase Storage `orion-deploys` bucket, then writes a `deployments/{slug}` Firestore doc mapping the public slug to that storage path (`registerDeployment`; retries with a random suffix on slug collision).
- The object is deliberately **not** served straight from Firebase Storage's public URL: `functions/[[path]].js` is a Cloudflare Pages Function bound to a dedicated hostname (`my.appblips.com`) that looks up the slug in Firestore via the REST API and re-serves the HTML with a real `text/html` content type and a locked-down CSP (see file header for the full rationale). Deployed apps must stay on this separate hostname — they're LLM-generated code with full script privileges, and on the SPA's own origin they could read `localStorage` (the user's session, and in self-hosted contexts any LLM config).
- Optional deploy-time extras, all spliced into the HTML before upload (and some re-injected at serve time for older deploys): PWA installability (`pwa.js`, plus the `_pwa/{slug}/{manifest.webmanifest,sw.js}` route in `functions/[[path]].js`), Umami analytics (`analytics.js`, hosted mode only), noindex/custom favicon (`seo.js`), and password protection (`crypto.js` — PBKDF2+AES-GCM, wraps the app in a standalone unlock-screen page that decrypts and `document.write`s the real HTML client-side).
- Some in-repo comments still describe the pre-migration Supabase-backed serving story (why a Cloudflare Function is needed to fix `text/plain` responses); the mechanism they explain still applies, but the code path is Firebase Storage + Firestore, not Supabase. A few `src/lib/*` files (`constants.js`, `deploy.js`, `helpers.js`, `projectsStorage.js`) likewise still reference "Supabase" in comments/naming despite operating on Firestore/Storage now.

### Preview rendering

`PREVIEW_MODES` defines fixed mobile (399×820) / desktop (1468×1022) viewport presets rendered inside a scaled container; zoom is either auto-fit (recalculated on resize via `previewContainerRef`) or manual (`handleManualZoom`), independent per `previewMode`.

## Security posture

Both `vite.config.js` (dev server headers) and `index.html` (meta CSP) set `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a restrictive `base-uri`/`object-src`. `index.html`'s comment block explains why its CSP `<meta>` tag deliberately omits `script-src`: a `srcdoc` iframe inherits the embedder's CSP, so any `script-src` there would break both the generated app's inline scripts/Tailwind CDN tag and (with `'self'`) the dev server's own React-Refresh preamble.

`firestore.rules` and `storage.rules` enforce per-user ownership in hosted mode: a `projects` doc is only readable/writable by its `user_id`; a `deployments` doc is publicly readable (so `functions/[[path]].js` can resolve slugs with no auth) but only its owner can create/update/delete it; Storage objects under `orion-deploys/{userId}/` are publicly readable but writable only by that `userId`.

## Testing Guidelines

- **Default to manual testing for simple edits:** Do not run Playwright tests for every single edit. It is faster for the user to test straightforward, routine, or isolated UI changes manually.
- **Use Playwright only for complex edits:** Run Playwright tests when making architectural changes, modifying complex state logic, or executing multi-file refactors where automated testing provides more value and reliability than manual verification.
