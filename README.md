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
  <a href="#disclaimer">Disclaimer</a> ·
  <a href="#license">License</a>
</p>

---

https://github.com/user-attachments/assets/58e2c34c-e469-4f2c-886b-7a163c0dea6f


**AppBlips is built for everyone.** Whether you've never written a line of code or you ship production apps every day, AppBlips turns plain-English prompts into working apps, games, and websites in seconds. 

It runs locally on your machine—bring your own API key (Anthropic, OpenAI, Gemini, DeepSeek, or OpenRouter). No mandatory accounts, no cloud lock-in, and the generated code is always yours to inspect, export, or host anywhere.

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
- **Click-to-Edit & Chat Refinements** — Click text, images, and links directly in Website Studio to make quick changes (drag a box or Shift+click to select several at once, or right-click to ask the AI for a change right there, add text or an image, or cut, copy, paste, duplicate, move or delete), or ask the AI in plain English for deeper structural tweaks.
- **Project Image Gallery ("My Images", beta)** — Upload your own photos and logos from Settings → Tools → My images (or search free Pixabay stock photos with your own Pixabay key and add the ones you pick) and tell the AI how to use them (e.g., *"put team-photo in the hero"*). Reference screenshots are also supported.
- **Local Voice Input** — Speak your prompts using the built-in microphone. Powered by a bundled Whisper model running locally on your hardware—zero audio is uploaded.
- **Built-in Code Editor** — Open the **Code** tab, click **Edit** and change the code yourself, with syntax colours and autocomplete (word suggestions worked out on your computer, never by the AI; on by default, switch off in **Settings → Workspace → Code autocomplete**). Each save becomes a new version you can undo, and an error in your own edit is reported, not silently rewritten by the AI.
- **Automatic Versioning** — Every generation and edit is saved as a snapshot you can undo/redo at any time.

### AI & Integrations
- **Bring Your Own Key** — Connect your own API keys. AppBlips itself is free; your provider bills you for what you use.
- **One-Click Connectors** — Wire up Web3Forms (contact emails), Umami/Plausible (analytics), tawk.to (live chat), Square (payments), Pollinations (AI image generation & chat), Pixabay (free stock photos for My images), or Tavily (lets the AI search the web while it builds, with your own Tavily key) via **Settings → Connectors**. React Bits (free animated components you ask for by name) is coming soon. The built-in **SEO** tool (**Settings → Tools**) needs no account: answer a few friendly questions and the AI adds professional search-engine optimization, plus a sitemap and robots file when you export or publish.

### Sharing & Hosting
- **Single-File HTML Export** — Download any generated project as a self-contained HTML file ready to share or host anywhere.
- **One-Click Web Publishing** — Push your project live to a free `*.surge.sh` HTTPS address (with optional custom favicon and an optional password that keeps your code encrypted until a visitor unlocks it) directly from the preview toolbar.
- **Built-in Showcase** — Browse community websites and games directly inside the app (even offline), and submit your own published creations.

<details>
<summary><strong>🎉 What's New in v0.1.24 (Click to expand)</strong></summary>
<br />

### v0.1.24

**New**
- **Edit code by hand:** open the **Code** tab (or **Files** for an imported project), click **Edit** and type your own changes, with the syntax colours lined up under the cursor. Save with the **Save** button or **Ctrl+S**: each save is a normal version, so undo and history work as usual. Unsaved changes are kept if you switch to the Preview tab, and AppBlips asks before you switch page or file.
- **Code autocomplete:** while you edit, suggested words appear under the cursor (words from your file, plus JavaScript, CSS and HTML names). Use the arrow keys to pick and **Enter** or **Tab** to insert, or **Esc** to close. Suggestions are worked out on your computer; the AI is never called. On by default; switch it off in **Settings → Workspace → Code autocomplete**.

**Improved**
- **Your own edits stay yours:** if code you saved by hand has an error, AppBlips now shows the error and its line in the chat instead of having the AI rewrite your change automatically (which also spent tokens you didn't ask for). Saving again clears it.
- **Clearer updates for Linux .deb installs:** the update notice and **Settings → Check** now show the right steps for how you installed AppBlips, with a command to copy: `apt upgrade` (or your software center) if you added the AppBlips package source, otherwise installing the downloaded .deb.
- **Desktop preview opens full size:** the **Desktop** button now shows the preview at full size. The framed desktop window is one click away on the **Full size** toggle, and pressing **Desktop** again keeps the view you chose.
- **Agent computer removed:** the AI no longer runs npm on computer.appblips.com, so nothing is sent there anymore and the **Agent computer** switch is gone from **Settings → Connectors**. For imported sites, the AI edits `package.json` itself and AppBlips' built-in build check tests the result.

**Look and feel**
- The buttons on the building screen (app header, Build panel, preview toolbar, embedded browser and click-to-edit bar) now look like raised keys that lift on hover and press down when clicked, with selected options shown held down. Works in light and dark themes and on phones.

### v0.1.22 and v0.1.23

**New**
- **Tavily web search connector:** add your own Tavily key in **Settings → Connectors** and the AI can search the web while it builds, for facts it doesn't know (a real business's address and opening hours, current news, how to use a service) instead of guessing. Tavily's free plan includes 1,000 searches a month.

**Improved**
- **Bring your own key only:** AppBlips AI Credits have been removed. Builds always use the AI provider you set up in **Settings**, and AppBlips itself is free. First-run setup is now three short steps (name, avatar, AI provider), and **Settings → Account & Usage** and the credits badge in the Build pane are gone. Any credits sign-in saved by an older version is deleted on startup.
- **Your AI model's own safeguards only:** AppBlips no longer adds its own content rules on top of the model you choose, and Pixabay search no longer forces safe search. Refusals from your provider still show as before.
- The Showcase uses lightweight still thumbnails, so browsing it uses less memory and CPU.

**For developers**
- Updated build tools and dependencies (Electron Builder, Capacitor CLI, ESLint, minimatch, glob) to fix known security issues.

*For older releases, see the [full changelog](https://docs.appblips.com/changelog) or [GitHub Releases](https://github.com/TechMitten/app-blips/releases).*
</details>

---

## Quick Start

### 1. Desktop App (Windows & Linux)
- **Windows:** Install from the **[Microsoft Store](https://apps.microsoft.com/detail/9nk9ss4v2n1k)** (signed by Microsoft with automatic updates).
- **Linux:** Download the latest `.AppImage` (any distro) or `.deb` (Debian/Ubuntu) from **[GitHub Releases](https://github.com/TechMitten/app-blips/releases/latest)**. Debian/Ubuntu users can also add the [AppBlips package source](https://docs.appblips.com/quickstart-desktop) to update with `sudo apt upgrade`. *(For AppImage: right-click → Properties → allow executing as a program).*
- **macOS:** No native installer yet—use Docker or run from source below.

> **First run:** Choose where to save your projects, then paste an API key (Anthropic, OpenAI, Gemini, DeepSeek, or OpenRouter). Keys are encrypted using your OS system keychain.

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

#### Pollinations Connector
- **Integration:** Uses Pollinations' device flow (`electron/server/pollinationsApi.js`). Keyless `gen.pollinations.ai` URLs are resolved server-side after build into public `media.pollinations.ai` assets and bundled on export.
- **In-App AI:** Injects `window.Pollinations` (`chat`, `image`, `mountConnect`) via `src/lib/pollinationsHelper.js`. Supports visitor-paid device flow (default) or a budget-capped site key.
- **Test:** `node testing/testPollinations.js` (offline; stubbed).

#### Pixabay Connector
- **Integration:** The user's own Pixabay API key is checked and stored server-side (`electron/server/pixabayApi.js`; OS keychain on desktop, `pixabay-key.json` in the browser version). The page only sees its last four characters. Search results are sanitized and cached for 24 hours, as Pixabay's API terms ask.
- **Flow:** Picked photos are downloaded by id through the server (never by URL) and added to the project's My images via `useImageGallery`'s `addFiles`, with a note built from their tags. The AI never calls Pixabay.
- **Test:** `node testing/testPixabayApi.js` (offline; stubbed).

</details>

---

## Security & Privacy

- **Strict Sandboxing:** Generated apps run inside a sandboxed iframe (`sandbox` without `allow-same-origin`) using an opaque origin, isolating them completely from the parent app.
- **Local-First Keys:** The desktop app opens zero network ports and encrypts API keys in your OS keychain. The browser/Docker server binds strictly to `127.0.0.1` (`localhost`) and stores keys on disk (`~/.appblips` or `appblips-data` volume with restricted permissions)—never in browser storage.
- **Opt-In Cloud Services:** Nothing leaves your machine unless you connect an external provider or explicitly click **Publish** to upload static files to Surge.

## Disclaimer

AppBlips is a tool. The apps, websites, games and other content it produces are generated by the AI provider you choose, from your prompts, and **you are solely responsible for that output and for how you use, publish or share it.** AI output can be inaccurate, insecure or infringe someone else's rights, so review and test anything you build before you rely on it or put it in front of other people.

Using AppBlips to create, publish or distribute anything unlawful, or to infringe the rights of others, is prohibited by the [AppBlips Terms of Service](https://www.appblips.com/terms). You must also follow the terms of your AI provider and of any service you connect or publish to, such as [Surge](https://surge.sh/terms).

AppBlips is provided "as is", without warranty of any kind, as set out in the [MIT License](LICENSE).

## License

Licensed under the [MIT License](LICENSE). Third-party open-source licenses are available inside the app under **Settings → About → Licenses**.
