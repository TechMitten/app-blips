# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AppBlips is a React SPA that generates small single-file HTML apps from a text prompt via an OpenAI-chat-completions-compatible LLM API, then renders them live in a sandboxed preview iframe. There is no application backend beyond a single proxy endpoint: the LLM endpoint, key, model, and tuning knobs are fixed server-side via env vars (not user-configurable), and the browser calls `/api/chat` on AppBlips's own origin rather than the LLM provider directly. See "LLM proxy" below.

## Commands

- `npm run dev` — start Vite dev server (port 5173, `host: true` for LAN/devcontainer access)
- `npm run build` — production build
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run preview` — preview the production build

There is no test suite configured.

## Architecture

The app is split into `App.jsx` (workspace/generation state + composition), `src/lib/` (framework-free logic), `src/hooks/` (stateful concerns), and `src/components/` (presentational UI):

- **[src/App.jsx](src/App.jsx)** — the `App` component: owns the workspace/generation state (prompt, `generatedCode`, `versions`/undo-redo, streaming refs, `handleGenerate`, naming/new-app flow, `resetCurrentWorkspace`) and composes everything else.
- **[src/previewBridge.js](src/previewBridge.js)** — a self-contained script injected into the generated app's HTML at render time, documented in detail in its file header.
- **src/lib/** — pure logic, no React:
  - `llm.js` — `requestModelText` / `generateAppCode` / `generateContextualSuggestions` / `generateNewStarterIdeas` (the API layer)
  - `edits.js` — `sanitizeHtmlResponse` + the surgical-edit engine (`applySurgicalEdits` and friends)
  - `prompts.js` — system prompts and tool schemas; `constants.js` — presets, `PREVIEW_MODES`, marquee/streaming constants
  - `config.js` — theme persistence helpers; `helpers.js` — syntax highlighter, preview-box math, misc
  - `deploy.js` — public-URL deployment calls; `projectsStorage.js` — localStorage↔Supabase project row plumbing
- **src/hooks/** — `useTheme`, `useAuth` (session + import offer), `useProjects` (list/persistence/resume), `useDeployment`, `usePreviewViewport` (mode/orientation/zoom), `useBuildPaneResize`, `usePreviewBridge` (the postMessage driver), `useSuggestions`.
- **src/components/** — `Header`, `HistorySidebar`, `BuildPanel` (with `StarterIdeas`, `ChatTranscript`, `SuggestionsBar`, `PromptInput`), `PreviewPane` (with `DeviceMockup`, `CodeView`), and modals: `Modal`/`ConfirmModal` (shared shells), `SettingsModal`, `ProjectsListModal`, `DeployModal`, `NamingModal`, `AuthModal`, `ImportModal`, `AccountSettingsModal`. Self-contained modals (`AuthModal`, `SettingsModal`, `AccountSettingsModal`) own their form state and talk to `supabase`/`lib/config` directly.

### Generation flow

1. **Initial generation** (`generatedCode` is empty): `buildInitialGenerationPrompt` builds a layout-specific instruction (mobile/desktop/both), sent with `HTML_SYSTEM_PROMPT` as a single non-tool completion. The response is cleaned by `sanitizeHtmlResponse` (strips markdown fences, finds `<!DOCTYPE html>`/`<html>` boundaries) to get raw HTML.
2. **Refinement** (`generatedCode` already exists): switches to a "surgical edit" loop. The model is forced (`tool_choice`) to call `apply_surgical_edits` with search/replace blocks anchored on `<!-- @section: name -->` landmark comments. `applySurgicalEdits` tries an exact string match first, then a whitespace-normalized fuzzy line-by-line match. On failure it retries up to 3 times, feeding the error back to the model as corrective context (`generateAppCode`'s self-healing loop).
3. Both paths go through `requestModelText`, which POSTs to `/api/chat` (same-origin proxy, see "LLM proxy" below) with exponential backoff retry (`delays` array) and supports SSE streaming (`onChunk`) with a 60s stall timeout, accumulating both text deltas and `tool_calls` deltas.

Each successful generation/edit is pushed onto a `versions` array (undo/redo via `currentVersionIndex`); going back and generating again truncates future versions, like standard undo history.

### Preview isolation (security-critical — read before touching this)

The generated app's HTML is never rendered directly. `injectPreviewBridge` (in `previewBridge.js`) splices a bridge `<script>` into the head/html/body of `generatedCode` at render time only, producing `srcDoc` fed to an iframe that has `sandbox` **without** `allow-same-origin` — the frame's origin is opaque, so the parent cannot reach `iframe.contentDocument` and generated code cannot reach the parent.

Consequences that matter when editing this code:
- The bridge is computed in a `useMemo` in `App.jsx` and is **never** written back into `generatedCode`. It must stay out of downloads, the clipboard, the code panel, `localStorage['orion-projects']`, and especially out of reach of `applySurgicalEdits`'s fuzzy matcher (which would otherwise happily "fix" bridge code during a refinement pass).
- Parent↔frame communication is `postMessage` only, authenticated by a per-render random `token` plus checking `event.source === iframe.contentWindow` (never `event.origin`, which is always the string `"null"` for an opaque origin). `targetOrigin: '*'` is required and is safe only because the protocol never carries a secret — don't add one.
- The bridge shims `localStorage`/`sessionStorage`/`document.cookie` inside the frame (real APIs throw `SecurityError` on an opaque origin) and implements the mobile touch-scroll/momentum simulation, toggled on/off via a `configure` message keyed to `previewMode === 'mobile'`.
- `BRIDGE_SOURCE` is checked at module load to contain no literal `</`, which would truncate the injected `<script>` tag.

### LLM proxy

- The LLM base URL, API key, model, `max_tokens`, and reasoning effort are **not** user-configurable — they're read server-side from `ORION_LLM_BASE_URL` / `ORION_LLM_API_KEY` / `ORION_LLM_MODEL` / `ORION_LLM_MAX_TOKENS` / `ORION_LLM_REASONING_EFFORT` env vars (see `.env.example`). None are `VITE_`-prefixed, so Vite never inlines them into the client bundle.
- `functions/_lib/chatProxy.js` (`handleChatProxy(request, env)`) is the single implementation of the proxy: it builds the upstream OpenAI-style request from env + the client's `{ messages, tools, tool_choice, stream, reasoning_effort }` body, and streams the upstream response straight back — it's a transparent relay, not a reimplementation, so `requestModelText`'s SSE-parsing/retry logic in `src/lib/llm.js` is unaware a proxy exists.
- In production (Cloudflare Pages) this runs as the Pages Function `functions/api/chat.js`, which just calls `handleChatProxy`. `functions/[[path]].js` is a separate, unrelated Function serving deployed user apps on a second hostname (`my.appblips.com`) — don't conflate the two.
- In local dev (`npm run dev`, plain Vite — Pages Functions don't run under Vite), `vite.config.js` registers dev-server middleware on `/api/chat` that calls the same `handleChatProxy`, reading env via `loadEnv(mode, cwd, '')` from a local `.env`. This keeps `npm run dev` working with no `wrangler` dependency and no behavior drift between dev and prod.
- Cloudflare Pages deployments need the same five vars set under Settings → Environment variables (API key marked Secret) — nothing in the app config does this automatically.
- Projects are persisted to `localStorage['orion-projects']` as `{id, name, data: {versions, currentVersionIndex}, updatedAt}` rows; the last-open project id is in `localStorage['orion-current-project-id']`.

### Preview rendering

`PREVIEW_MODES` defines fixed mobile (399×820) / desktop (1468×1022) viewport presets rendered inside a scaled container; zoom is either auto-fit (recalculated on resize via `previewContainerRef`) or manual (`handleManualZoom`), independent per `previewMode`.

## Security posture

Both `vite.config.js` (dev server headers) and `index.html` (meta CSP) set `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a restrictive `base-uri`/`object-src`. `index.html`'s comment block explains why its CSP `<meta>` tag deliberately omits `script-src`: a `srcdoc` iframe inherits the embedder's CSP, so any `script-src` there would break both the generated app's inline scripts/Tailwind CDN tag and (with `'self'`) the dev server's own React-Refresh preamble.
