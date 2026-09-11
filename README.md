<p align="center">
  <img src="public/appblips-logo.png" alt="AppBlips — Text to App Generator" width="360" />
</p>

<p align="center">
  <strong>The simple way to turn an idea into a working app.</strong><br />
  Describe what you want in plain English, watch it get built in seconds, and use it right away.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/techmitten/app-blips/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/techmitten/app-blips?style=flat&color=yellow"></a>
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
</p>

<p align="center">
  <a href="https://appblips.com">
    <img src="https://s13.gifyu.com/images/buqof.gif" alt="Typing a prompt in AppBlips and watching a working game get built live" width="700" />
  </a>
</p>

## Why AppBlips?

Tools like Bolt and Lovable are great, but they're built for developers — multi-file projects, build pipelines, and IDE-style interfaces. **AppBlips is built to be simple.** Every app you generate is just one file, the interface is a single prompt box and a live preview, and there's nothing extra to learn. If you want to describe an idea and get a real, working website or app back — without wading through a complicated tool built for professional developers — AppBlips is for you.

## What it is

AppBlips lets you describe an app or website in plain language and get back a working version you can preview, tweak, and use immediately. Type what you want, and AppBlips builds it as a single, self-contained file — no project setup, no separate files to manage, no build step to run before you can see it.

Under the hood, AppBlips is a React app that sends your prompt to an AI model through a single built-in proxy and renders the result live in a safely sandboxed preview. The AI connection is configured once, by whoever sets up AppBlips — as a user, you never manage API keys or model settings yourself.

There are two ways to run it:

- **Hosted** ([appblips.com](https://appblips.com)) — sign in and build straight from your browser, with nothing to install. Your projects sync to your account, and any app can be deployed to its own public URL as an installable PWA.
- **Self-hosted** — run it on your own machine or server. A single local user, no sign-in and no cloud sync — just you and the app.

See [Quick start](#quick-start) below to pick one.

## Features

- **One simple prompt box** — describe your idea in plain English and get a working app back
- **Instant live preview** — see exactly what you built, right next to the prompt, with no extra deploy step
- **Ask for changes in plain English** — request a tweak and AppBlips edits the app for you, no code required
- **Attach images** — drop in a screenshot or reference picture and have AppBlips build from it
- **Undo/redo** — every generation and edit is saved as a version you can always go back to
- **Mobile and desktop views** — check how your app looks on different screen sizes, with adjustable zoom
- **Export to HTML** — download any generated app as a single self-contained HTML file, ready to host or share anywhere
- **Deploy to a public URL** *(hosted only)* — publish an app to its own link, installable as a PWA and optionally password-protected

## Quick start

### Hosted (suggested)

Go to **[appblips.com](https://appblips.com)**, sign in, and start typing. There's nothing to install and no API key to bring. Apps you deploy are automatically assigned their own public URL and are installable as PWAs.

### Self-hosted

Prefer to run AppBlips yourself? There's no signup, and once it's running, using it is as simple as typing a prompt. You'll need an API key from an AI provider.

**Prerequisites:** [Node.js](https://nodejs.org/) 20+ and npm (npm comes bundled with Node.js).

```bash
git clone https://github.com/techmitten/app-blips.git   # download the project
cd app-blips                                            # move into the project folder
npm install                                             # install dependencies
cp .env.example .env                                    # create your local config file
```

Open the new `.env` file and set, at minimum, the AI provider to use:

```
APPBLIPS_LLM_BASE_URL=https://api.openai.com/v1
APPBLIPS_LLM_API_KEY=your-api-key
APPBLIPS_LLM_MODEL=gpt-4o
```

Any OpenAI-chat-completions-compatible endpoint works here, not just OpenAI's own.

Then start AppBlips:

```bash
npm run dev
```

Open `http://localhost:5175` in your browser — that's it, you're ready to build.

## Running with Docker

For a longer-lived self-hosted setup, use Docker instead of `npm run dev`. The image builds the static client and serves it — along with `/api/chat` — from a small dependency-free Node server ([`server.js`](server.js)), so no `wrangler` or Cloudflare-specific tooling is required.

```bash
docker compose up --build
```

This reads environment variables from the same `.env` file as above and serves the app on `http://localhost:3000`.

## Configuration

Everything about how AppBlips runs is set once, in your `.env` file — as a user you'll never see or touch this. All configuration is via environment variables — see [`.env.example`](.env.example) for the full, authoritative list. The key groups:

| Group | Variables | Notes |
| --- | --- | --- |
| LLM (required) | `APPBLIPS_LLM_BASE_URL`, `APPBLIPS_LLM_API_KEY`, `APPBLIPS_LLM_MODEL` | Server-side only, never exposed to the browser bundle |
| LLM tuning (optional) | `APPBLIPS_LLM_MAX_TOKENS`, `APPBLIPS_LLM_TEMPERATURE`, `APPBLIPS_LLM_REASONING_EFFORT` | `APPBLIPS_LLM_TEMPERATURE` defaults to `0.2` |
| Rate limiting (optional) | `APPBLIPS_CHAT_RATE_LIMIT_MAX`, `APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS` | Per-user limit on `/api/chat`, defaulting to 60 requests per 300s. Tracked in memory per server instance, so treat it as a speed bump rather than a hard budget cap |
| Hosting mode | `SELF_HOSTED_MODE` | Defaults to self-hosted. Only `false` enables the Firebase-backed hosted mode |

> **Note:** in self-hosted mode `/api/chat` performs no authentication — every request is treated as the same local user. If you expose the app beyond localhost, you're responsible for putting your own access control in front of it.

---

*The sections below are for developers working on AppBlips itself. If you just want to build apps, you're already set — open AppBlips and start typing.*

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on port 5175 |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

There's no automated test suite wired to `npm test`. The `testing/` directory holds standalone scripts run directly with Node (e.g. `node testing/test-reply.js`, `node testing/testSyntax.js`) that exercise generation and syntax-checking against a real LLM call or fixture HTML.

## Project structure

```
src/
  App.jsx            # Workspace/generation state, undo-redo, composition root
  previewBridge.js   # Script injected into generated apps to bridge the sandboxed iframe
  firebase.js        # Single Firebase SDK init point (no-op in self-hosted mode)
  lib/               # Framework-free logic: LLM calls, surgical edits, prompts, deploy, crypto...
  hooks/             # Stateful concerns: auth, projects, deployment, preview viewport...
  components/        # Presentational UI: Header, BuildPanel, PreviewPane, modals...
functions/           # Cloudflare Pages Functions: /api/chat proxy, deployed-app server
server.js            # Standalone Node server for Docker self-hosted deployments
testing/             # Standalone Node scripts for exercising generation/syntax-checking
```

For a full architectural deep-dive (generation flow, preview sandboxing, LLM proxy internals, deploy pipeline), see [`CLAUDE.md`](CLAUDE.md).

## Security notes

- Generated apps are never rendered directly — they're injected into a sandboxed iframe (`sandbox` without `allow-same-origin`) with an opaque origin, so the app can't reach the parent page and the parent can't reach the app's DOM. See [`src/previewBridge.js`](src/previewBridge.js) for details.
- In self-hosted mode, `/api/chat` has no token verification — every request is treated as the same local user, so anyone who can reach it can spend your configured AI budget. Don't expose it beyond localhost without adding your own access control. (In hosted mode the proxy requires a valid Firebase ID token and App Check token.)
- Deployed apps are served from a separate hostname, never the app's own origin — they're AI-generated code with full script privileges, so keeping them off-origin stops them reading anything the SPA stores.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` before submitting a PR.

## License

MIT — see [LICENSE](LICENSE).
