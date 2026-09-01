# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Orion is a client-only React SPA that generates small single-file HTML apps from a text prompt via an OpenAI-chat-completions-compatible LLM API, then renders them live in a sandboxed preview iframe. There is no backend — the LLM endpoint, key, and model are configured by the user in Settings and calls go straight from the browser to that endpoint.

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
  - `config.js` — LLM config/theme persistence helpers; `helpers.js` — syntax highlighter, preview-box math, misc
  - `deploy.js` — public-URL deployment calls; `projectsStorage.js` — localStorage↔Supabase project row plumbing
- **src/hooks/** — `useTheme`, `useAuth` (session + import offer), `useProjects` (list/persistence/resume), `useDeployment`, `usePreviewViewport` (mode/orientation/zoom), `useBuildPaneResize`, `usePreviewBridge` (the postMessage driver), `useSuggestions`.
- **src/components/** — `Header`, `HistorySidebar`, `BuildPanel` (with `StarterIdeas`, `ChatTranscript`, `SuggestionsBar`, `PromptInput`), `PreviewPane` (with `DeviceMockup`, `CodeView`), and modals: `Modal`/`ConfirmModal` (shared shells), `SettingsModal`, `ProjectsListModal`, `DeployModal`, `NamingModal`, `AuthModal`, `ImportModal`, `AccountSettingsModal`. Self-contained modals (`AuthModal`, `SettingsModal`, `AccountSettingsModal`) own their form state and talk to `supabase`/`lib/config` directly.

### Generation flow

1. **Initial generation** (`generatedCode` is empty): `buildInitialGenerationPrompt` builds a layout-specific instruction (mobile/desktop/both), sent with `HTML_SYSTEM_PROMPT` as a single non-tool completion. The response is cleaned by `sanitizeHtmlResponse` (strips markdown fences, finds `<!DOCTYPE html>`/`<html>` boundaries) to get raw HTML.
2. **Refinement** (`generatedCode` already exists): switches to a "surgical edit" loop. The model is forced (`tool_choice`) to call `apply_surgical_edits` with search/replace blocks anchored on `<!-- @section: name -->` landmark comments. `applySurgicalEdits` tries an exact string match first, then a whitespace-normalized fuzzy line-by-line match. On failure it retries up to 3 times, feeding the error back to the model as corrective context (`generateAppCode`'s self-healing loop).
3. Both paths go through `requestModelText`, which POSTs to `{baseUrl}/chat/completions` with exponential backoff retry (`delays` array) and supports SSE streaming (`onChunk`) with a 60s stall timeout, accumulating both text deltas and `tool_calls` deltas.

Each successful generation/edit is pushed onto a `versions` array (undo/redo via `currentVersionIndex`); going back and generating again truncates future versions, like standard undo history.

### Preview isolation (security-critical — read before touching this)

The generated app's HTML is never rendered directly. `injectPreviewBridge` (in `previewBridge.js`) splices a bridge `<script>` into the head/html/body of `generatedCode` at render time only, producing `srcDoc` fed to an iframe that has `sandbox` **without** `allow-same-origin` — the frame's origin is opaque, so the parent cannot reach `iframe.contentDocument` and generated code cannot reach the parent.

Consequences that matter when editing this code:
- The bridge is computed in a `useMemo` in `App.jsx` and is **never** written back into `generatedCode`. It must stay out of downloads, the clipboard, the code panel, `localStorage['orion-projects']`, and especially out of reach of `applySurgicalEdits`'s fuzzy matcher (which would otherwise happily "fix" bridge code during a refinement pass).
- Parent↔frame communication is `postMessage` only, authenticated by a per-render random `token` plus checking `event.source === iframe.contentWindow` (never `event.origin`, which is always the string `"null"` for an opaque origin). `targetOrigin: '*'` is required and is safe only because the protocol never carries a secret — don't add one.
- The bridge shims `localStorage`/`sessionStorage`/`document.cookie` inside the frame (real APIs throw `SecurityError` on an opaque origin) and implements the mobile touch-scroll/momentum simulation, toggled on/off via a `configure` message keyed to `previewMode === 'mobile'`.
- `BRIDGE_SOURCE` is checked at module load to contain no literal `</`, which would truncate the injected `<script>` tag.

### LLM config & storage

- Config (`baseUrl`, `apiKey`, `model`) lives in `localStorage` or `sessionStorage` depending on a "remember key" toggle (`orion-llm-remember`); `loadLlmConfig` falls back to whichever store isn't the current preference so toggling mid-session never silently loses the key. There's no way to truly hide a key from the browser that types it in — the sandboxed iframe only guarantees generated code can't read it.
- `isInsecureEndpoint` warns (doesn't block) on plaintext `http://` to a non-localhost host, since the key would cross the network in cleartext.
- Projects are persisted to `localStorage['orion-projects']` as `{id, name, data: {versions, currentVersionIndex}, updatedAt}` rows; the last-open project id is in `localStorage['orion-current-project-id']`.

### Preview rendering

`PREVIEW_MODES` defines fixed mobile (399×820) / desktop (1468×1022) viewport presets rendered inside a scaled container; zoom is either auto-fit (recalculated on resize via `previewContainerRef`) or manual (`handleManualZoom`), independent per `previewMode`.

## Security posture

Both `vite.config.js` (dev server headers) and `index.html` (meta CSP) set `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a restrictive `base-uri`/`object-src`. `index.html`'s comment block explains why its CSP `<meta>` tag deliberately omits `script-src`: a `srcdoc` iframe inherits the embedder's CSP, so any `script-src` there would break both the generated app's inline scripts/Tailwind CDN tag and (with `'self'`) the dev server's own React-Refresh preamble.
