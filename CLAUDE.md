# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AppBlips turns a plain-English prompt into a working single-file app, website (multi-page) or game, shown in a live sandboxed preview. It is a React 19 + Vite 8 + Tailwind 4 SPA (plain JS/JSX, ESM, no TypeScript). It ships as an **Electron desktop app** (Windows and Linux) and is single-user: no accounts, no cloud. The same build also runs in a browser from a small local server (`server.js`: `npm start` or Docker), for macOS and people who prefer source or containers.

## Giving the user instructions

The user is a beginner. Communicate with them like one in general: plain language, explain jargon when you have to, and don't assume they know how a tool or service works.

Whenever you give the user instructions to follow (running commands, configuring secrets, etc.), make them beginner-friendly and step by step, as a numbered or bulleted list. Say exactly where to click and what to copy or type, one action per step.

## Missing tools

If a tool, program or package that isn't installed would let you do the job, or do it noticeably better (for example, testing a change for real instead of only building it), it's fine to stop and tell the user. Say what the tool is, what it would let you do, and give beginner-friendly install steps as above. Don't quietly settle for a weaker approach just because the tool is missing.

## Commands

```bash
npm run dev              # Vite on :5175 with a dev-only /api/chat middleware (hot-reload UI work)
npm run build            # production renderer build -> dist/ (desktop mode)
npm run lint             # ESLint (CI runs lint + build only)
npm run check            # type check (scripts/typecheck.js), then lint if it passes
npm start                # vite build --mode desktop + node server.js: browser version on 127.0.0.1:3000
npm run build:server     # bundle server.js into dist-server/server.mjs (used by the Dockerfile)
npm run licenses         # rebuild everything and regenerate src/lib/thirdPartyLicenses.json (Settings → Licenses)
docker compose up -d     # browser version in a container, published on 127.0.0.1:3000
npm run desktop          # vite build --mode desktop + bundle Electron main + launch Electron
npm run desktop:dist     # installers into dist-desktop/ (see RELEASING.md)
npm run release [patch|minor|major]  # scripts/release.sh: lint, bump, commit+tag+push, wait for CI, publish draft
```

**Keep testing proportionate to the change.** Run `npm run check` after edits -- it is quick and always safe. You do not need to run `npm run build` after every edit; build once at the end (and whenever a change could affect the bundle). Also run only the `testing/` file(s) that cover the code you changed (write one if none exists). Ask the user before running the full suite, starting dev servers, Playwright/browser runs or screenshots, comparing against a clean copy of HEAD, or building bundles/Docker images to try them. Finish by listing what you didn't test.

There is **no test runner** (`npm test` doesn't exist). `testing/` holds standalone scripts that use `node:assert`; run one with `node testing/testPages.js`. Not all of them are self-contained:
- `.mjs` files are headless Playwright checks (`npx playwright install chromium` once).
- `testGuidedTour.js` and `testResponsiveLayout.js` are also Playwright and need `npm run dev` running (override the URL with `TOUR_TEST_URL` / `RESPONSIVE_TEST_URL`).
- Codebase import tests use the fixture projects in `testing/fixtures/` (zipped at test time). `testCodebasePreview.mjs` needs network (esm.sh); `testCodebaseDesktop.mjs` launches the real Electron app in a temp HOME: `npm run build && node scripts/build-electron.js && env -u ELECTRON_RUN_AS_NODE xvfb-run -a node testing/testCodebaseDesktop.mjs`.
- `testPreviewStorage.js` currently fails, and `testGuidedTour.js` / `testResponsiveLayout.js` time out waiting for `#prompt` (the app now opens on the studio picker). Don't treat their failures as regressions from your change. If unsure, don't use `git stash` (it also hides changes from anyone else working in the folder): run the test against a clean copy of the last commit instead, e.g. `git archive HEAD | tar -x -C <scratch dir>`.

To run all of them without stopping at the first failure: `for f in testing/*.js; do node "$f" >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"; done`.

Config comes from `.env` (read by `npm run dev`, `server.js` and Docker's compose file; never by the desktop app, which takes its provider from Settings → AI). `.env.example` documents every variable, all optional. Releases: bump `package.json` version, push a `v*` tag, the Desktop workflow makes a draft GitHub release (see [RELEASING.md](RELEASING.md)). `npm run release` automates this but commits and pushes to master, so it needs the user's go-ahead like any other push; it refuses to run on a dirty or unsynced tree.

## Git: one branch only

**Always ask before committing or pushing.** All work happens on `master`. Once the user has said to commit/push, go straight to it; never create a feature, topic or backup branch, locally or on GitHub (this overrides any default "branch first" habit). Before committing, check `git branch --show-current` is `master`; if it isn't, stop and tell the user.

## Architecture

### One renderer, one server handler, three hosts
The main product is the Electron desktop app. The renderer is the normal `dist/` build; `electron/main.js` registers the privileged `appblips://app` protocol and answers `/api/*` in-process via `protocol.handle` — **no network port is opened**. The one server handler is:

- `electron/server/chatProxy.js` — the LLM proxy. Written with **only Fetch primitives** (`Request` in, `Response` out, no Node/CF-specific APIs), so the same code runs in Electron, as Vite dev middleware (`vite.config.js`) for hot-reload UI work, and in `server.js`. `electron/server/providers.js` (provider presets), `providerModels.js` (live model discovery), `configSummary.js` (startup summary), `relay.js` (drop hop-by-hop headers, pass the SSE stream through), `nodeHttp.js` (Node req/res ↔ Fetch, shared by Vite and server.js) and `staticFiles.js` (security headers + MIME types, shared by main.js and server.js) support it.

`server.js` is the **browser version** (`npm start`, Docker): plain `node:http`, serves `dist/` and POST `/api/chat`. It listens on `127.0.0.1` unless `HOST` is set (the Dockerfile sets `0.0.0.0`; `docker-compose.yml` publishes on `127.0.0.1` only), and rejects any `Host` that isn't localhost or listed in `APPBLIPS_ALLOWED_HOSTS` (DNS rebinding, since rebinding makes Origin match Host). In the browser, `isDesktop` is false: projects live in localStorage/IndexedDB and the provider choice (id, model, URL, never the key) in localStorage (`webProviderStore` in `desktop.js`), sent per request as `user_provider`. The key goes once to `/api/provider` (`providerApi.js`), is kept server-side in `$APPBLIPS_DATA_DIR/provider-key.json` (`keyFile.js`, mode 0600; Docker: the `appblips-data` volume) and attached to `/api/chat` by `withSavedProvider` (`savedProvider.js`, shared with main.js). Keys saved in localStorage by older versions are moved to the server on first load. The Docker image runs `dist-server/server.mjs` (Rolldown bundle via `scripts/build-server.js`, no node_modules). `APPBLIPS_LOCAL_AI_HOST` (set by compose to `host.docker.internal`) rewrites localhost for LM Studio/Ollama server-side (`localServerUrl` in chatProxy.js).

Every host is single-user: `/api/chat` performs no authentication, and a browser may call it only from the app's own origin (`isForeignOrigin` in chatProxy.js). In the desktop app, provider secrets live only in the main process, never in the renderer bundle.

### Generation pipeline (client)
`src/App.jsx` (~2.3k lines) is the composition root: workspace state, undo/redo, versions. Logic is split as:
- `src/lib/` — framework-free logic. `llm.js` drives generation: streams from `/api/chat`, runs a tool-calling refinement loop (surgical edits via `edits.js` / `directEdits.js` / `pageTools.js` rather than regenerating whole files), then syntax-checks (`syntaxCheck.js`, uses `acorn`) and auto-repairs broken output/broken page links with bounded retries. The opt-in review (`reviewBuild` → `reviewGeneratedCode` in `codeReview.js`) is inspect-only: the model screenshots and tests the live preview through `browserTools.js`/`embeddedBrowser.js` (see below), reads the code, and must finish with a `submit_review_report`. It never edits. If the report lists problems, `handleReview` in App.jsx starts a new chat session and sends the report (`mission`) as that session's first build request, so the fix is a normal build with no prior chat context. `prompts.js` holds the system prompts, with separate app / website / game variants selected by `studioMode`.
- Apps (`studioMode === 'app'`) are React: inline `<script type="text/jsx">` plus an import map of esm.sh URLs pinned to `REACT_VERSION` in `jsxCompile.js` (one React copy per page, or hooks break). Website/game pages and older Preact apps are plain HTML/JS.
- `src/hooks/` — stateful concerns (projects, preview viewport/bridge, theme).
- `src/components/` — UI.
- A project version stores `files`, a map of page filename → full HTML doc; `index.html` is always the landing page and single-page apps are `{ 'index.html': html }` (`src/lib/pages.js`, capped at `MAX_PAGES` / `MAX_FILES_BYTES` to keep saved projects small).

### Preview sandbox (security-critical)
Generated code is never rendered directly. It goes into an iframe with `sandbox` **without** `allow-same-origin` (opaque origin), so it can't touch the parent's localStorage (which holds the user's provider settings). Because storage/cookies throw `SecurityError` in that origin, `src/previewBridge.js` injects a script that shims storage, simulates mobile touch scroll, serializes the DOM for screenshots, and talks to the parent over `postMessage`. `generatedCode` must stay free of the bridge: the bridge is spliced in at render time and **must never be exported** (export uploads only the app's own files). The same rule holds for everything added to generated code: infinite-loop guards (`loopProtection.js`) are injected at preview/export time and never stored in `files`, and JSX is compiled to module scripts by `compileJsxScripts` (sucrase) at preview/export time, so `files` keeps the JSX source. Sucrase preserves line numbers, which keeps runtime error lines and loop guards aligned with the stored source; don't add transforms that insert newlines.

The embedded browser that the AI uses to test the preview has the same limits. `browserRuntime.js` is serialized into the sandboxed frame and exposes only bounded observations and actions. Real clicks and typing go through `electron/browserControls.js`, which only accepts normalized coordinates inside the `iframe[data-appblips-browser]` frame plus a per-document token, and never accepts JavaScript or selectors from the model.

### Imported codebases (`studioMode: 'codebase'`)
A customer's real React + Vite (+ TypeScript) project imported from a .zip (`ImportSiteDialog` → `src/lib/codebase/import.js`, fflate). Unlike the other studios, `files` holds the whole repo keyed by path (`src/App.tsx`, `package.json`, …; rules and limits in `codebase/paths.js`, shared with main), and each version also has `assets: {path: sha256}` for images/fonts. There is no empty codebase workspace and no full-generation path: the only way in is an import.
- **Storage:** saved versions hold `tree: {path: sha256}` instead of `files`; `useProjects` packs/unpacks them (`codebase/versions.js`) and file contents live once each in a content-addressed blob store (`src/lib/blobStore.js` → IPC `blobs.put/get` → `<Project>/blobs/<sha>` via `projectStore.putBlobs`, which re-checks every hash; IndexedDB in `npm run dev`). On desktop `site/` mirrors the current version as a real project folder.
- **Preview:** `useCodebaseBuild` bundles the project with esbuild-wasm (lazy chunk, `codebase/esbuildBrowser.js`) through a virtual-FS plugin (`codebase/bundler.js`): npm packages stay external and load from esm.sh via a generated import map pinned to package-lock versions, with every direct dependency marked external so there is one React; react-router's browser routers are swapped for memory routers (`codebase/routerShim.js`); Tailwind uses its browser builds, except v4 CSS with `@config`/`@plugin`/package imports, which gets an in-frame runtime around Tailwind's own `compile()` with the config bundled (`codebase/tailwind.js`). Stylesheet-only npm imports (`.css`, Fontsource, `swiper/css`) become `<link>`s to esm.sh, and any other bare `import 'pkg'` is tried as JS with a CSS fallback, since one failed module import blanks the whole preview. Desktop serves assets from `appblips://assets/<projectId>/<sha>` (a separate origin; `serveAsset` in main.js). The bridge runs with `projectMode` (relative links go to the router; it posts `route-changed`).
- **AI:** `codebase/llm.js` + `codebase/tools.js` (list/read/search/edit/create/delete files), with a build check after every turn that changed files (`checkCodebaseBuild`: esbuild errors, packages missing from package.json, and `importCheck.js` for imports `tsc -b` rejects but esbuild drops). The review loop doesn't support codebases yet.
- **Export:** `codebase/export.js` zips the tree back; untouched files are byte-identical. Codebase rows are excluded from JSON backups (`isBackupable`).
- **Never run project code in the renderer** (it's the privileged origin): config files are parsed (JSONC) or pattern-matched only, and the bundled `tailwind.config` executes inside the sandboxed preview frame. esbuild plugins are only our own code.

### Export
The browser builds each page's final HTML (`buildExportFiles` in App.jsx injects loop protection) and downloads it: one self-contained HTML file, or a ZIP of pages for a multi-page site (`src/lib/zip.js`). React apps can also export as a Vite project (`buildViteProject` in `reactProject.js`, which reads dependencies from the import map). There is no server-side publishing.

### Desktop (Electron)
`electron/main.js` is bundled with Rolldown into `dist-electron/main.cjs` (so the packaged app needs no `node_modules`). The renderer is the normal `dist/` build; `electron/preload.cjs` (CommonJS, sandboxed) exposes a narrow `window.appblipsDesktop` IPC API, and main re-checks the sender on every call. `src/lib/desktop.js` is the renderer-side adapter: `isDesktop` is true only there, and project storage is swapped from localStorage to on-disk (`projectStore.js`) via an in-memory cache hydrated once before render (`initDesktopStore()` in `main.jsx`) so the sync storage helpers keep working. Provider keys are encrypted with the OS keychain (`providerStore.js`).

## Conventions and gotchas

- Code comments in this repo explain *why* (security boundaries, platform quirks); keep that style and match the surrounding density.
- `__APPBLIPS_VERSION__` (Vite `define`) is a build-time global declared in `eslint.config.js`.
- localStorage keys use the legacy `orion-` prefix (e.g. `orion-theme`); the pre-paint theme script in `index.html` mirrors `THEME_META_COLOR` in `src/lib/config.js` — keep them in sync.
- Docs site is Mintlify, under `docs/` (see `docs/AGENTS.md` for its style rules); it deploys separately from the app. Mintlify only publishes `docs/` when it changes on master; nothing keeps it in sync with the code, so:
  - **Keep docs in step with every change.** When a change alters anything a user sees or does (UI labels, settings, features, install/release steps, limits, privacy or network behaviour), update the matching `docs/` pages and `README.md` in the same commit. `grep -rn` the docs for the old label or behaviour to find every page.
  - **Before a release** (`npm run release`, which asks "Are the docs up to date?"), audit `docs/` against `git log <last v* tag>..HEAD` and fix anything stale first. Check present-tense claims about things that aren't done yet, like signing or planned features.
  - **What's new:** also before a release, add the new version's notes at the top of the README's **What's new** section, written for users (plain language, grouped as New / Improved / Look and feel / For developers, from `git log <last v* tag>..HEAD`). Keep only the latest few versions there; older ones live on GitHub Releases. The same text goes in the GitHub release notes.
- `.orig` files in `src/components/` are stray merge leftovers, not source.
- Settings → Licenses reads `src/lib/thirdPartyLicenses.json`, generated from what each bundle (app + voice worker, desktop main, Docker server) actually contains (`scripts/licenses.js`). Every build checks it and fails when a dependency is added, removed or updated; run `npm run licenses` and commit the JSON.
