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

## Why AppBlips?

**AppBlips is built for everyone.** If you've never written a line of code, you can describe what you want in plain language and use the result a few seconds later. If you code every day, you get a fast way to sketch ideas, prototype tools, and build small apps and games without setting up a project. Every app or website is designed around plain-language prompting, instant preview, and a clean path from idea to working result, and the code is always there to read, export, and change. AppBlips strips away setup work so you can focus on the app itself.

## What it is

AppBlips lets you describe an app, a game, or a website in plain language and get back a working version you can preview, tweak, and use immediately. Type what you want, and AppBlips builds it as a single, self-contained app or game, or a website with the structure and styling you asked for.

AppBlips has three studios, chosen from the launch screen:

- **App Studio** — interactive tools and dashboards. JavaScript-driven, saves its data in the browser, and designed to feel native on a phone (mobile preview by default).
- **Website Studio** — content-first pages such as landing pages, portfolios, restaurant or business sites, and blogs. It builds real website anatomy (navigation, hero, content sections, footer), adds libraries such as Swiper carousels, GSAP scroll animations or Leaflet maps when the site needs them, then lets you refine it with prompts or click-to-edit tools.
- **Game Studio** — playable browser games with a real game loop: raw Canvas 2D for simple arcade games or the Phaser 3 engine (loaded from CDN) for sprite, tilemap and physics-heavy games, with controls, scoring, levels, juice, and sound tuned for both touch and keyboard.

The studios share the same workflow: prompt, live preview, versions, and export.

Under the hood, AppBlips is a React app that sends your build prompt to an AI model through a local, single-user proxy and renders the result live in a safely sandboxed preview. That builder connection is how it turns plain-English requests into quickly editable output.

AppBlips runs on your computer, powered by your own AI provider key. No account, no cloud sync. Install the **desktop app** (Windows and Linux), or **run it from source** or with **Docker** on any system and use it in your browser. See [Quick start](#quick-start) below.

## What's new

### 0.1.14

**New: Full size preview.** A **Full size** button next to the device sizes drops the window frame and shows your page at its real size, filling the whole preview area. It works in every studio.

**New: About tab in Settings.** **Settings → About** shows the AppBlips version you're running (desktop app or browser version), links to the website and source code, and a **Report a bug** link that opens a new issue on GitHub.

**Improved**

- **Preview toolbar:** Rotate, Full size and a new **Reload** button are always in the same place, so the toolbar no longer shifts when you switch devices. Buttons that don't apply to the current view are greyed out.
- **Phone and tablet previews:** they no longer show a desktop-style browser bar, just like a real phone or tablet. While the AI is testing your page, its status and **Stop** button appear in the preview toolbar instead.
- **Images in games:** the Game Studio can now use Pollinations to make title art, backgrounds and sprites.
- **Questions about connectors:** in Ask mode, the AI now knows which services you've connected, instead of wrongly saying it can't use them.
- **Guided tour:** updated for recent features: Publish, Full size, Reload, importing a site and Settings → Connectors. Imported sites get their own steps.

**Look and feel**

- **Building screen:** in the dark theme, the live code card has a soft white border instead of a red one.
- **Guided tour:** the tour cards stand out clearly against the dark theme.

Older releases: see the [changelog](https://docs.appblips.com/changelog) or [GitHub Releases](https://github.com/TechMitten/app-blips/releases).

## Features

- **One simple prompt box** — describe your idea in plain English and get a working app, game, or website back
- **App, Website, and Game studios** — pick the studio that fits; each has its own prompts, starter ideas, and default preview size
- **Click-to-edit websites** — in the Website Studio, click text, images, and links right in the preview to change them directly, with an AI-assisted edit through chat when a change needs more nuance
- **Instant live preview** — see exactly what you built, right next to the prompt, with no extra step
- **Ask for changes in plain English** — request a tweak and AppBlips edits the app, game, or website for you, no code required
- **Attach images** — drop in a screenshot or reference picture and have AppBlips build from it
- **My images** — upload your own photos and logos to a project's gallery, then ask the AI to "put team-photo in the hero" or "use all my images"; they're shipped with the site when you export or publish
- **AppBlips AI Credits** — no API key? Start a free 3-day trial (100 credits) or buy a pay-as-you-go pack in **Settings → API**; a credit pack is used for every build until you switch to your own provider
- **Speak your prompt** — click the microphone and describe your idea; speech is turned into text on your own computer with Whisper, nothing is uploaded
- **Undo/redo** — every generation and edit is saved as a version you can always go back to
- **Token usage** — a live counter shows the tokens a build is using as it runs, and each AI reply keeps its total, as reported by your AI provider
- **Mobile and desktop views** — check how your app or website looks on different screen sizes, with adjustable zoom
- **Export to HTML** — download any generated app or website as a single self-contained HTML file, ready to host or share anywhere
- **Publish to the web** — one click puts your app, website or game online at a free `surge.sh` address with HTTPS (needs a free [Surge](https://surge.sh) account, which you can create right in the Publish window)
- **Showcase** — explore real websites and games built with AppBlips right in the app, and submit your own published project to be featured
- **Connectors** — link Web3Forms, Umami, Plausible, tawk.to, Square or Pollinations in **Settings → Connectors**, and the AI wires them into what it builds: forms that email you, visitor stats, live chat, payments, AI-generated images and AI features


## Documentation

Full guides live at **[docs.appblips.com](https://docs.appblips.com/)**:

- **[Introduction](https://docs.appblips.com/introduction)** — what AppBlips is and how it works
- **[Desktop app quickstart](https://docs.appblips.com/quickstart-desktop)** — install, add your API key, and build your first app
- **[Run from source](https://docs.appblips.com/quickstart-source)** — run it in your browser with Node.js, or build the desktop app yourself
- **[Docker](https://docs.appblips.com/self-hosting/docker)** — run it in a container with one command
- **[Feature guides](https://docs.appblips.com/features/building-apps)** — deep dives into the App, Website, and Game studios
- **[Publish to the web](https://docs.appblips.com/features/publishing)** — put a project online at a free `surge.sh` address
- **[Showcase](https://docs.appblips.com/features/showcase)** — explore projects built with AppBlips and submit your own

## Quick start

### Desktop app (Windows and Linux)

- **Windows:** install from the **[Microsoft Store](https://apps.microsoft.com/detail/9nk9ss4v2n1k)**. It's signed by Microsoft (no install warnings) and the Store keeps it up to date for you.
- **Linux:** download an installer from the **[latest release](https://github.com/TechMitten/app-blips/releases/latest)** (scroll down to **Assets**):
  - **AppImage:** download `AppBlips-<version>-x86_64.AppImage`. It works on any distribution. Right-click the file → Properties → allow it to run as a program, then double-click it.
  - **Debian / Ubuntu (.deb):** download `AppBlips-<version>-amd64.deb` and double-click it to install it with your software center.

All Linux versions and checksums are on the **[Releases](https://github.com/TechMitten/app-blips/releases)** page.

The first time you open it, AppBlips asks for your name, a chat avatar and where to save your projects, then asks you to choose an AI provider (Anthropic by default; OpenAI, Gemini, DeepSeek, OpenRouter, or LM Studio/Ollama on your own computer), paste its API key and pick a model. Get an Anthropic key from the [Claude Console](https://platform.claude.com/settings/keys). Your key is encrypted with your system keychain, and your projects are saved in AppBlips' own data folder (open it from Settings → Data). See the [desktop app guide](https://docs.appblips.com/quickstart-desktop) for details.

The app tells you when a new version is out. On the Microsoft Store it updates itself through the Store; with the AppImage it downloads the update itself and offers to restart; click **Check now** in Settings → Workspace to check straight away, or turn the check off there.

On macOS there is no installer yet: run it from source or with Docker instead (below).

### Run from source (Windows, macOS, Linux)

You need [Node.js](https://nodejs.org/) 22.12 or newer (the LTS version).

1. Get the code and install it:

   ```bash
   git clone https://github.com/techmitten/app-blips.git
   cd app-blips
   npm install
   ```

2. Start AppBlips in your browser:

   ```bash
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) and add your AI provider when asked.

Your projects are saved in your browser (your API key is saved by AppBlips on your computer, not in the browser), so back up with **Settings → Data → Export** now and then. Prefer the desktop app? Run `npm run desktop` instead of `npm start`, or `npm run desktop:dist` to build your own installers into `dist-desktop/`. See the [run from source guide](https://docs.appblips.com/quickstart-source) for details, including updating.

### Docker

With [Docker](https://docs.docker.com/get-docker/) installed, in the `app-blips` folder run:

```bash
docker compose up -d
```

Then open [http://localhost:3000](http://localhost:3000). It's the same browser version, with nothing else to install. Stop it with `docker compose down`; update with `git pull` and `docker compose up -d --build`. See the [Docker guide](https://docs.appblips.com/self-hosting/docker) for ports and local models.

### Optional configuration

The browser version and Docker can read an AI provider and server settings from a `.env` file: copy `.env.example` to `.env` and fill in what you need. Everything in it is optional; see the [configuration reference](https://docs.appblips.com/self-hosting/configuration).

## Project structure

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

### Voice input (Whisper)

Voice input turns speech into text entirely on the user's computer. Nothing is uploaded, and it works the same in the desktop app and the browser version.

- **Model:** OpenAI's [Whisper base](https://huggingface.co/openai/whisper-base) (multilingual), using the 8-bit quantized ONNX conversion from [`onnx-community/whisper-base`](https://huggingface.co/onnx-community/whisper-base). It's about 76 MB.
- **Runtime:** [transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) running on ONNX Runtime's WebAssembly backend, single-threaded, inside a Web Worker (`src/lib/whisperWorker.js`), so the UI stays responsive.
- **Recording:** `src/hooks/useSpeechRecognition.js` records the microphone with `MediaRecorder` (up to 2 minutes), decodes it to 16 kHz mono, and sends it to the worker. The worker loads the model the first time the mic is used and keeps it for the session. Whisper is given the system language first and detects the language itself if that one isn't supported.
- **Bundled, not downloaded at runtime:** `scripts/fetch-whisper-model.js` downloads the model files into `public/whisper/` (gitignored), from one pinned Hugging Face revision, and checks each file's SHA-256. A mismatch fails the build. It runs automatically when Vite starts (`npm run dev` or any build) and does nothing if the files are already there. Run `node scripts/fetch-whisper-model.js` to fetch them ahead of time, for example before an offline build. Vite copies them into `dist/`, so the desktop app, `npm start` and Docker all ship the model. The Dockerfile fetches it in its own layer, so rebuilding after `git pull` doesn't download it again.
- **No network at runtime:** the worker turns off remote model loading and the browser cache, and loads ONNX Runtime's `.wasm` from the app bundle instead of a CDN.
- **Microphone permission:** in the desktop app, `electron/main.js` grants the `media` permission only for audio and only to the app's own top-level page. The sandboxed preview, where generated apps run, can't use the microphone, and nothing can use the camera. The Microsoft Store package declares the `microphone` capability.
- **Test:** after `npm run build`, `node testing/testVoiceInput.mjs` (Playwright) plays a speech clip through a fake microphone and checks both the transcript and that no request left the app's own server.

### Publishing with Surge

**Publish** (the globe button in the preview toolbar) puts an app, website or game online with [Surge](https://surge.sh), free static hosting with HTTPS on every `<name>.surge.sh` address. Imported codebases can't be published yet.

- **Accounts:** each person uses their own free Surge account. The Publish window offers **I have an account** or **Create an account** (password typed twice). Surge creates an account for any email it hasn't seen, so there's no separate sign-up step.
- **What's uploaded:** the same pages **Export** downloads (JSX compiled, loop protection added, no preview bridge), plus copies of any Pollinations images and My images uploads they use under `images/` (`src/lib/siteImages.js`, `src/lib/galleryImages.js`) and the optional **Site icon** as `favicon.png` (resized to a small PNG in the browser and linked from every page's `<head>`, `src/lib/favicon.js`), packed as a gzipped tar and sent to Surge's API. AppBlips remembers the last address per project, so publishing that project again offers **Update site** (same address) or **Unpublish** (takes it offline).
- **Where it runs:** the upload happens in AppBlips' own server code (`electron/server/surgeApi.js`), not in the page, because Surge's API doesn't accept requests from web pages. It's the same handler in the desktop app, `npm start`/Docker and `npm run dev`.
- **Sign-in storage:** the password goes to Surge once and is never saved. The token Surge returns is kept like the AI key: encrypted with the system keychain on desktop (`electron/surgeStore.js`), or in `surge-token.json` next to `provider-key.json` (mode 0600) in the browser version. The page only ever sees the account email. Sign in or out from the Publish window or the **Surge** card in **Settings → Connectors** (the same window with nothing to publish); **Factory Reset** also signs out.
- **Limits:** only `*.surge.sh` addresses for now (no custom domains). Surge rate-limits publishing, and its [terms](https://surge.sh/terms) apply to what you publish. For an older address AppBlips no longer remembers, run `npx surge teardown <name>.surge.sh`.
- **Test:** `node testing/testSurgeApi.js` (no network; Surge is stubbed).

### My images (project gallery)

The **My images** key in the prompt box opens a per-project gallery (`src/components/ImageGalleryModal.jsx`, `src/hooks/useImageGallery.js`, `src/lib/galleryImages.js`).

- **Storage:** the bytes go in the project's content-addressed blob store (`src/lib/blobStore.js`: `blobs/` in the desktop project folder, IndexedDB elsewhere); the project row keeps only `data.images` (`[{ hash, name, type, width, height, size, note }]`), not versioned. Uploads made before the first save wait in memory. Desktop blob cleanup keeps listed images (`referencedBlobs` in `electron/projectStore.js`). JSON backups carry the list but not the bytes.
- **AI:** the system prompt lists each image's path, size and the user's note (`buildImageGalleryNote` in `src/lib/prompts.js`); the AI never sees the pixels.
- **Paths:** pages refer to an image as `images/<name>`, its published path. The preview swaps that for an `appblips://assets` URL (desktop) or a `data:` URL at render time (`injectPreviewBridge`'s `gallery` option), never in stored `files`. Export and Publish add the referenced images at `images/<name>` (inlined as `data:` URLs in a single-file export, `public/images/` in a React project).
- **Test:** `node testing/testGalleryImages.js`.

### AppBlips AI Credits

An optional way to build without your own AI key (`electron/server/creditsApi.js`, `src/lib/credits.js`). In **Settings → API** (or on the desktop setup screen) the user starts the **3-day free trial** (100 credits), or buys a **Starter** (1,000), **Builder** (2,750) or **Studio** (6,000) pack through [Polar](https://polar.sh), then clicks **Connect Credits** with the email used at checkout. Paid credits never expire.

- **Use:** while credits are connected they pay for every build, edit, review and Ask reply, using DeepSeek. A provider the user saves under Settings → API takes over and pauses credits (**Use AppBlips Credits instead** switches back); **Disconnect** forgets the credit token. One credit is about 4,000 weighted tokens (output counts triple), at least one per request.
- **Where it runs:** the same handler in the desktop app, `npm start`/Docker, `npm run dev` and Android. The packaged app relays to `appblips.com`, which holds the Polar and DeepSeek keys; with `POLAR_TOKEN` and `DEEPSEEK_API_KEY` set in `.env` the server talks to them directly.
- **Credit token:** stored like the AI key: encrypted with the system keychain on desktop (`credits.json`), or in `credits-key.json` (mode 0600) next to `provider-key.json` in the browser version. The page only sees the email and balance.
- **Test:** `node testing/testCreditsApi.js` (no network).

### Pollinations connector

**Settings → Connectors → Pollinations** lets the AI make images and add AI features with [Pollinations](https://github.com/pollinations/pollinations), but only when the user asks for them.

- **Sign-in:** Pollinations' device flow with AppBlips' publishable App Key (`src/lib/pollinationsApp.js`), run server-side in `electron/server/pollinationsApi.js` (same handler in all three hosts). The user key it returns is stored like the Surge token: keychain-encrypted on desktop, `pollinations-key.json` (mode 0600) in the browser version. The page only sees the account name. **Factory Reset** signs out.
- **Images:** the AI writes keyless `https://gen.pollinations.ai/image/...` URLs; after the build, `resolveImages` (`src/lib/pollinations.js`) has the server generate each one with the user's key and swaps in the stored copy's public `media.pollinations.ai` address. Publish and Export copy those images into the site.
- **AI features in built apps:** the AI only calls `window.Pollinations` (`chat`, `image`, `mountConnect`), which `src/lib/pollinationsHelper.js` adds at preview/export time, like loop protection. The user picks who pays (`aiPayer`): visitors (default; a Connect button runs the device flow with AppBlips' App Key and each visitor spends their own Pollen) or a budget-capped site key shared by all their sites (no visitor sign-in; scrambled in the page but not secret, which Settings says plainly; keys without a budget or with account permissions are refused). The AI's instructions follow the choice.
- **Test:** `node testing/testPollinations.js` (no network; Pollinations is stubbed).

For a full architectural deep-dive (generation flow, preview sandboxing, LLM proxy internals), see [`CLAUDE.md`](CLAUDE.md).

## Security notes

- Generated apps are never rendered directly — they're injected into a sandboxed iframe (`sandbox` without `allow-same-origin`) with an opaque origin, so the app can't reach the parent page and vice versa.
- The desktop app opens no network port, so other devices can't reach it or spend your AI key. Your key is encrypted with the system keychain.
- The browser version (`npm start`, Docker) has no sign-in either. It listens on `127.0.0.1` only and answers only when opened as `localhost`, so other devices and other websites can't use it. Keep it that way, or put your own access control in front of it. A key entered in the app is saved by the server in a file only you can read (`~/.appblips`, or the `appblips-data` volume in Docker), never in your browser.
- **AppBlips AI Credits** are optional. When connected, your prompts and code are sent through AppBlips' servers to DeepSeek instead of straight to your own provider. Nothing is sent that way unless you connect credits, and a provider you set yourself always takes priority.
- **Publish** sends your project's pages to Surge only when you click it. Your Surge password isn't saved, and the token Surge returns stays outside the page, like the AI key.
- Windows builds aren't code-signed yet, which is why Smart App Control can block the installer. See the [code signing policy](https://docs.appblips.com/reference/code-signing-policy) for how releases are built and how to check a download.

## License

This project is licensed under the [MIT License](LICENSE). The open source projects AppBlips includes, and their licenses, are listed in the app under **Settings → Licenses**.
