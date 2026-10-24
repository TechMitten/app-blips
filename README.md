<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png" />
    <img src="docs/logo-light.png" alt="AppBlips — Text to App and Website Generator" width="320" />
  </picture>
</p>

<p align="center">
  <strong>The simple way to turn an idea into a working app or website.</strong><br />
  Describe what you want in plain English, watch it get built in seconds, and use it right away.
</p>

<p align="center">
  <a href="https://apps.microsoft.com/detail/9nk9ss4v2n1k?hl=en-US&amp;gl=US"><img alt="Download for Windows" src=".github/readme/download-windows.svg" width="200" height="61"></a>
  <a href="https://github.com/TechMitten/app-blips/releases/latest"><img alt="Download for Ubuntu" src=".github/readme/download-ubuntu.svg" width="200" height="61"></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="https://docs.appblips.com/"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.appblips.com-080808"></a>
  <a href="https://github.com/techmitten/app-blips/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/techmitten/app-blips?style=flat&color=yellow"></a>
  <a href="https://discord.gg/a7QfqbvaF9"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white"></a>
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
</p>

<p align="center">
  <a href="https://docs.appblips.com/">Documentation</a> ·
  <a href="https://github.com/TechMitten/app-blips/releases">Download</a> ·
  <a href="https://discord.gg/a7QfqbvaF9">Discord</a> ·
  <a href="#license">License</a>
</p>

---

https://github.com/user-attachments/assets/58e2c34c-e469-4f2c-886b-7a163c0dea6f


**AppBlips is built for everyone.** Whether you've never written a line of code or you ship production apps every day, AppBlips turns plain-English prompts into working apps, games, and websites in seconds. 

It runs locally on your machine—bring your own API key (Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, or local LM Studio/Ollama) or use built-in **AppBlips AI Credits**. No mandatory accounts, no cloud lock-in, and the generated code is always yours to inspect, export, or host anywhere.

## Three Studios, One Workflow

Every studio shares the same fast loop: **Prompt → Live Preview → Version History → Export/Publish**.

| Studio | Best For | Under the Hood |
| :--- | :--- | :--- |
| **App Studio** | Interactive tools, utilities, and dashboards | JavaScript-driven, persists data in the browser, defaults to mobile preview. |
| **Website Studio** | Landing pages, portfolios, business sites, and blogs | Full website anatomy with Swiper, GSAP, or Leaflet. Supports both AI edits and direct click-to-edit. |
| **Game Studio** | Playable 2D browser games with touch & keyboard controls | Raw Canvas 2D for simple arcade games or Phaser 3 (via CDN) for physics, sprites, and tilemaps. |

## Key Features

### Creation & Editing
- **Instant Live Preview** — Watch your app, game, or website render right next to your prompt in a safely sandboxed view, with mobile/desktop toggles and zoom controls.
- **Click-to-Edit & Chat Refinements** — Click text, images, and links directly in Website Studio to make quick changes, or ask the AI in plain English for deeper structural tweaks.
- **Project Image Gallery ("My Images")** — Upload your own photos and logos to a project's gallery and tell the AI how to use them (e.g., *"put team-photo in the hero"*). Reference screenshots are also supported.
- **Local Voice Input** — Speak your prompts using the built-in microphone. Powered by a bundled Whisper model running locally on your hardware—zero audio is uploaded.
- **Automatic Versioning** — Every generation and edit is saved as a snapshot you can undo/redo at any time.

### AI & Integrations
- **Bring Your Own Key or Use Credits** — Connect your own API keys (or local models) for free, or subscribe to **AppBlips AI Credits** (starts with a 3-day, 100-credit trial; converts to the $10/mo Starter Plan for 1,000 credits/mo unless cancelled).
- **One-Click Connectors** — Wire up Web3Forms (contact emails), Umami/Plausible (analytics), tawk.to (live chat), Square (payments), or Pollinations (AI image generation & chat) via **Settings → Connectors**.

### Sharing & Hosting
- **Single-File HTML Export** — Download any generated project as a self-contained HTML file ready to share or host anywhere.
- **One-Click Web Publishing** — Push your project live to a free `*.surge.sh` HTTPS address (with optional custom favicon) directly from the preview toolbar.
- **Built-in Showcase** — Browse community websites and games directly inside the app (even offline), and submit your own published creations.

<details>
<summary><strong>🎉 What's New in v0.1.15 (Click to expand)</strong></summary>
<br />

- **AppBlips AI Credits:** Build without an API key. Start a 3-day free trial (100 credits; requires a valid payment method and converts to the $10/month Starter Plan for 1,000 credits/mo unless cancelled in **Settings → Account & Usage**) or pick a monthly plan (Starter, Builder, or Studio). Your own saved API provider always takes priority if configured.
- **My Images Gallery:** Upload project photos and logos, ask the AI to place them by name, and have them automatically bundled on export or publish.
- **Showcase & Site Icons:** Browse real AppBlips projects from the studio picker (even offline) and attach custom favicons when publishing to Surge.
- **Quality of Life:** Streamlined first-run setup, a refreshed Light theme with higher contrast, Full-size preview support for websites, external link confirmation prompts, a manual **Check now** update button in **Settings → Workspace**, and Electron 44.9.1 security updates.

*For older releases, see the [full changelog](https://docs.appblips.com/changelog) or [GitHub Releases](https://github.com/TechMitten/app-blips/releases).*
</details>

---

## Quick Start

### 1. Desktop App (Windows & Linux)
- **Windows:** Install from the **[Microsoft Store](https://apps.microsoft.com/detail/9nk9ss4v2n1k)** (signed by Microsoft with automatic updates).
- **Linux:** Download the latest `.AppImage` (any distro) or `.deb` (Debian/Ubuntu) from **[GitHub Releases](https://github.com/TechMitten/app-blips/releases/latest)**. *(For AppImage: right-click → Properties → allow executing as a program).*
- **macOS:** No native installer yet—use Docker or run from source below.

> **First run:** Choose where to save your projects, then either connect **AppBlips AI Credits** or paste an API key (Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, or local LM Studio/Ollama). Keys are encrypted using your OS system keychain.

### 2. Docker (All Platforms)
With [Docker Compose v2](https://docs.docker.com/get-docker/) installed, run from the project root:

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). Stop with `docker compose down`, or update with `git pull && docker compose up -d --build`.

### 3. Run from Source (Windows, macOS, Linux)
Requires [Node.js](https://nodejs.org/) 22.12 LTS or newer.

```bash
git clone [https://github.com/techmitten/app-blips.git](https://github.com/techmitten/app-blips.git)
cd app-blips
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). 
- **Want the Electron desktop app?** Run `npm run desktop` (dev) or `npm run desktop:dist` to build installers into `dist-desktop/`.
- **Optional `.env` setup:** Copy `.env.example` to `.env` to pre-configure providers or server settings. See the [Configuration Reference](https://docs.appblips.com/self-hosting/configuration).

---

## Documentation

Full guides and references live at **[docs.appblips.com](https://docs.appblips.com/)**:

- **[Introduction](https://docs.appblips.com/introduction)** · **[Desktop Quickstart](https://docs.appblips.com/quickstart-desktop)** · **[Run from Source](https://docs.appblips.com/quickstart-source)** · **[Docker Guide](https://docs.appblips.com/self-hosting/docker)**
- **[Studio Feature Guides](https://docs.appblips.com/features/building-apps)** · **[Publishing to Surge](https://docs.appblips.com/features/publishing)** · **[Community Showcase](https://docs.appblips.com/features/showcase)**

---

## Architecture & Developer Notes

```text
src/
  App.jsx            # Workspace/generation state, undo-redo, composition root
  previewBridge.js   # Script injected into generated apps to bridge the sandboxed iframe
  lib/               # Framework-free logic: LLM calls, surgical edits, prompts...
  hooks/             # Stateful concerns: projects, preview viewport, theme...
  components/        # Presentational UI: Header, BuildPanel, PreviewPane, modals...
electron/            # Desktop app: main process, preload, on-disk project store,
                     # encrypted provider settings, and the in-process /api/chat handler
server.js            # Browser version (npm start, Docker): serves dist/ and /api/chat
Dockerfile           # Container image for the browser version (docker-compose.yml)
testing/             # Standalone Node scripts for exercising the proxy and preview
scripts/             # Build helpers, including fetch-whisper-model.js for voice input
```

<details>
<summary><strong>🔧 Deep Dive: Subsystems & Testing (Click to expand)</strong></summary>
<br />

For a complete architectural walkthrough (generation flow, preview sandboxing, and LLM proxy internals), see [`CLAUDE.md`](CLAUDE.md).

#### Voice Input (Whisper)
- **Model & Runtime:** Uses an 8-bit quantized ONNX conversion of OpenAI's multilingual `whisper-base` (~76 MB) via `@huggingface/transformers` (WASM backend) inside a dedicated Web Worker (`src/lib/whisperWorker.js`).
- **Offline Bundling:** `scripts/fetch-whisper-model.js` pulls pinned model files into `public/whisper/` during build/dev and verifies SHA-256 hashes. No external network calls occur at runtime.
- **Permissions:** `electron/main.js` restricts `media` audio permissions strictly to the top-level app UI—never the sandboxed preview iframe, and never the camera.
- **Test:** `node testing/testVoiceInput.mjs` (after `npm run build`).

#### Publishing with Surge
- **Flow:** Compiles JSX, injects loop protection, strips the preview bridge, bundles referenced Pollinations/gallery images under `images/` plus `favicon.png` (`src/lib/favicon.js`), and uploads a gzipped tarball to Surge via `electron/server/surgeApi.js`.
- **Auth Storage:** Passwords are never saved. The returned Surge token is encrypted in the system keychain on desktop (`electron/surgeStore.js`) or saved with `0600` permissions in `surge-token.json` for browser/Docker builds.
- **Test:** `node testing/testSurgeApi.js` (offline; Surge is stubbed).

#### My Images (Project Gallery)
- **Storage & References:** Image bytes live in a content-addressed blob store (`blobs/` on desktop, IndexedDB in browser), while project metadata tracks `[{ hash, name, type, width, height, size, note }]`.
- **Privacy & Export:** The AI only receives image file paths, dimensions, and user notes (`buildImageGalleryNote` in `src/lib/prompts.js`)—never raw pixels. At render time, `images/<name>` swaps to `appblips://assets` or `data:` URLs, and bundles cleanly on export/publish.
- **Test:** `node testing/testGalleryImages.js`.

#### AppBlips AI Credits
- **Billing & Auth:** Managed via [Polar](https://polar.sh) (`electron/server/creditsApi.js`, `src/lib/credits.js`). Users authenticate via emailed one-time codes (`/api/credits/connect` and `/api/credits/verify`). Credits route requests to DeepSeek (~4,000 weighted tokens per credit; output weighted 3x).
- **Host Relay vs. Direct:** Packaged apps relay through `appblips.com`; self-hosters can set `POLAR_TOKEN` (with `orders:read`) and `DEEPSEEK_API_KEY` in `.env` for direct mode. Tokens are stored encrypted on desktop (`credits.json`) or `0600` (`credits-key.json`) on server.
- **Test:** `npm run test:credits` (add `POLAR_TOKEN` and `APPBLIPS_POLAR_CONTRACT=1` for live contract verification).

#### Pollinations Connector
- **Integration:** Uses Pollinations' device flow (`electron/server/pollinationsApi.js`). Keyless `gen.pollinations.ai` URLs are resolved server-side after build into public `media.pollinations.ai` assets and bundled on export.
- **In-App AI:** Injects `window.Pollinations` (`chat`, `image`, `mountConnect`) via `src/lib/pollinationsHelper.js`. Supports visitor-paid device flow (default) or a budget-capped site key.
- **Test:** `node testing/testPollinations.js` (offline; stubbed).

</details>

---

## Security & Privacy

- **Strict Sandboxing:** Generated apps run inside a sandboxed iframe (`sandbox` without `allow-same-origin`) using an opaque origin, isolating them completely from the parent app.
- **Local-First Keys:** The desktop app opens zero network ports and encrypts API keys in your OS keychain. The browser/Docker server binds strictly to `127.0.0.1` (`localhost`) and stores keys on disk (`~/.appblips` or `appblips-data` volume with restricted permissions)—never in browser storage.
- **Opt-In Cloud Services:** Nothing leaves your machine unless you connect an external provider, opt into AppBlips AI Credits (which routes prompts through AppBlips' proxy to DeepSeek), or explicitly click **Publish** to upload static files to Surge.

## License

Licensed under the [MIT License](LICENSE). Third-party open-source licenses are available inside the app under **Settings → Licenses**.
