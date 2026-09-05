<p align="center">
  <img src="public/appblips-logo.png" alt="AppBlips — Text to App Generator" width="360" />
</p>

<p align="center">
  Generate small, single-file HTML apps from a text prompt via an LLM, and preview them live in a sandboxed iframe.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

## What it is

AppBlips is a React single-page app that turns a text prompt into a self-contained HTML app (markup, styles, and script all in one file) using an OpenAI-chat-completions-compatible LLM API, then renders it live inside a sandboxed preview iframe. There's no application backend beyond a single `/api/chat` proxy endpoint — the LLM base URL, API key, model, and tuning knobs are fixed server-side via environment variables (not user-configurable), and the browser always talks to AppBlips's own origin rather than the LLM provider directly.

The app runs in one of two modes, chosen entirely by environment variables (no runtime toggle):

- **Self-hosted** (default) — single local user, no sign-in, no cloud sync, no deploy-to-public-URL. Nothing talks to Firebase.
- **Hosted** — Firebase Auth + Firestore (projects, deployments) + Storage (deployed HTML), fronted by a Cloudflare Pages Function that verifies ID tokens before relaying to the LLM.

## Features

- Live preview in a sandboxed iframe, isolated from the parent app (see [Security notes](#security-notes))
- AI-driven "surgical edits" for refinements — the model edits existing apps via targeted search/replace blocks instead of regenerating the whole file
- Undo/redo version history for every generation and edit
- Mobile and desktop preview modes with adjustable zoom
- Optional hosted mode: account sign-in, cloud-synced projects, and one-click deploy to a public URL
- Self-hosted mode: no account required, runs entirely on your own infrastructure

## Quick start

**Prerequisites:** Node.js 20+ and npm.

```bash
git clone https://github.com/techmitten/app-blips.git
cd app-blips
npm install
cp .env.example .env
```

Edit `.env` and set at minimum:

```
APPBLIPS_LLM_BASE_URL=https://api.openai.com/v1
APPBLIPS_LLM_API_KEY=your-api-key
APPBLIPS_LLM_MODEL=gpt-4o
```

Then start the dev server:

```bash
npm run dev
```

Open `http://localhost:5173`. This runs in self-hosted mode by default — no sign-in, no Firebase.

## Running with Docker

A `Dockerfile` and `docker-compose.yml` are provided for self-hosted deployments. The image builds the static client and serves it (along with `/api/chat`) from a small dependency-free Node server (`server.js`) — no `wrangler` or Cloudflare-specific tooling required.

```bash
docker compose up --build
```

This reads environment variables from `.env` (same file as above) and serves the app on `http://localhost:3000`. Docker deployment currently only supports self-hosted mode.

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example) for the full, authoritative list. The key groups:

| Group | Variables | Notes |
| --- | --- | --- |
| LLM (required) | `APPBLIPS_LLM_BASE_URL`, `APPBLIPS_LLM_API_KEY`, `APPBLIPS_LLM_MODEL`, `APPBLIPS_LLM_MAX_TOKENS`, `APPBLIPS_LLM_REASONING_EFFORT` | Server-side only, never exposed to the browser bundle |
| Rate limiting (optional) | `APPBLIPS_CHAT_RATE_LIMIT_MAX`, `APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS` | Config exists, but the underlying check is currently a stub that always allows requests |
| Hosting mode | `VITE_USE_FIREBASE`, `USE_FIREBASE` | Both must be set the same way (`"true"` for hosted mode) — one is read by the browser bundle, the other by the server-side proxy |
| Firebase (hosted mode only) | `VITE_FIREBASE_*`, `FIREBASE_API_KEY` | Leave unset for self-hosting |

> **Note:** In self-hosted mode, `/api/chat` performs no authentication — every request is treated as the same local user. If you expose the app beyond localhost, you're responsible for putting your own access control in front of it.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on port 5173 |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

There's no automated test suite wired to `npm test`. The `testing/` directory holds standalone scripts run directly with Node (e.g. `node testing/test-reply.js`, `node testing/testSyntax.js`) that exercise generation and syntax-checking against a real LLM call or fixture HTML.

## Project structure

```
src/
  App.jsx              # Workspace/generation state, undo-redo, composition root
  previewBridge.js      # Script injected into generated apps to bridge the sandboxed iframe
  firebase.js           # Single Firebase SDK init point (no-op in self-hosted mode)
  lib/                   # Framework-free logic: LLM calls, surgical edits, prompts, deploy, crypto...
  hooks/                 # Stateful concerns: auth, projects, deployment, preview viewport...
  components/            # Presentational UI: Header, BuildPanel, PreviewPane, modals...
functions/               # Cloudflare Pages Functions: /api/chat proxy, deployed-app server
server.js                # Standalone Node server for Docker self-hosted deployments
testing/                 # Standalone Node scripts for exercising generation/syntax-checking
```

For a full architectural deep-dive (generation flow, preview sandboxing, LLM proxy internals, deploy pipeline), see [`CLAUDE.md`](CLAUDE.md).

## Security notes

- Generated apps are never rendered directly — they're injected into a sandboxed iframe (`sandbox` without `allow-same-origin`) with an opaque origin, so the app can't reach the parent page and the parent can't reach the app's DOM. See `src/previewBridge.js` for details.
- In self-hosted mode, `/api/chat` has no token verification. In hosted mode, every request must carry a valid Firebase ID token, verified server-side.
- Deployed apps (hosted mode) are served from a dedicated hostname, never the main app's origin, since they're LLM-generated code with full script privileges.

## Deploying (hosted mode only)

Deploy-to-public-URL uploads the generated HTML to Firebase Storage and registers it in Firestore. Deployed apps are served from a separate hostname via a Cloudflare Pages Function that resolves the slug and re-serves the HTML with a locked-down CSP — never from the main app's own origin or Firebase Storage's public URL directly.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` before submitting a PR. See [`CLAUDE.md`](CLAUDE.md) for a detailed guide to the codebase's architecture and conventions.

## License

MIT — see [LICENSE](LICENSE).
