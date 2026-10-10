<p align="center">
  <img src="public/darkthemelog.png" alt="AppBlips — Text to App and Website Generator" width="360" />
</p>

<p align="center">
  <strong>The simple way to turn an idea into a working app or website.</strong><br />
  Describe what you want in plain English, watch it get built in seconds, and use it right away.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="https://docs.appblips.com/"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.appblips.com-080808"></a>
  <a href="https://github.com/techmitten/app-blips/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/techmitten/app-blips?style=flat&color=yellow"></a>
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
</p>

<p align="center">
  <a href="https://docs.appblips.com/">Documentation</a> ·
  <a href="https://github.com/TechMitten/app-blips/releases">Download</a> ·
  <a href="#license">License</a>
</p>

## Why AppBlips?

**AppBlips is built for everyone.** If you've never written a line of code, you can describe what you want in plain language and use the result a few seconds later. If you code every day, you get a fast way to sketch ideas, prototype tools, and build small apps and games without setting up a project. Every app or website is designed around plain-language prompting, instant preview, and a clean path from idea to working result, and the code is always there to read, export, and change. AppBlips strips away setup work so you can focus on the app itself.

## What it is

AppBlips lets you describe an app, a game, or a website in plain language and get back a working version you can preview, tweak, and use immediately. Type what you want, and AppBlips builds it as a single, self-contained app or game, or a website with the structure and styling you asked for.

AppBlips has three studios, chosen from the launch screen:

- **App Studio** — interactive tools and dashboards. JavaScript-driven, saves its data in the browser, and designed to feel native on a phone (mobile preview by default).
- **Website Studio** — content-first pages such as landing pages, portfolios, restaurant or business sites, and blogs. It builds real website anatomy (navigation, hero, content sections, footer), then lets you refine it with prompts or click-to-edit tools.
- **Game Studio** — playable browser games with a real game loop: raw Canvas 2D for simple arcade games or the Phaser 3 engine (loaded from CDN) for sprite, tilemap and physics-heavy games, with controls, scoring, levels, juice, and sound tuned for both touch and keyboard.

The studios share the same workflow: prompt, live preview, versions, and export.

Under the hood, AppBlips is a React app that sends your build prompt to an AI model through a local, single-user proxy and renders the result live in a safely sandboxed preview. That builder connection is how it turns plain-English requests into quickly editable output.

AppBlips runs as a **desktop app** (Windows and Linux): it runs on your computer, powered by your own AI provider key. No account, no cloud sync, and your projects are saved as folders you can back up or move. See [Quick start](#quick-start) below.

## Features

- **One simple prompt box** — describe your idea in plain English and get a working app, game, or website back
- **App, Website, and Game studios** — pick the studio that fits; each has its own prompts, starter ideas, and default preview size
- **Click-to-edit websites** — in the Website Studio, click text, images, and links right in the preview to change them directly, with an AI-assisted edit through chat when a change needs more nuance
- **Instant live preview** — see exactly what you built, right next to the prompt, with no extra step
- **Ask for changes in plain English** — request a tweak and AppBlips edits the app, game, or website for you, no code required
- **Attach images** — drop in a screenshot or reference picture and have AppBlips build from it
- **Undo/redo** — every generation and edit is saved as a version you can always go back to
- **Mobile and desktop views** — check how your app or website looks on different screen sizes, with adjustable zoom
- **Export to HTML** — download any generated app or website as a single self-contained HTML file, ready to host or share anywhere


## Documentation

Full guides live at **[docs.appblips.com](https://docs.appblips.com/)**:

- **[Introduction](https://docs.appblips.com/introduction)** — what AppBlips is and how it works
- **[Desktop app quickstart](https://docs.appblips.com/quickstart-desktop)** — install, add your API key, and build your first app
- **[Feature guides](https://docs.appblips.com/features/building-apps)** — deep dives into the App, Website, and Game studios

## Quick start

### Desktop app (Windows and Linux)

Download the installer for your system from the **[latest release](https://github.com/TechMitten/app-blips/releases/latest)** (scroll down to **Assets**):

- **Windows:** download `AppBlips-Setup-<version>.exe`, run it and follow the installer.
- **Linux (AppImage):** download `AppBlips-<version>-x86_64.AppImage`. It works on any distribution. Right-click the file → Properties → allow it to run as a program, then double-click it.
- **Debian / Ubuntu (.deb):** download `AppBlips-<version>-amd64.deb` and double-click it to install it with your software center.

All versions and checksums are on the **[Releases](https://github.com/TechMitten/app-blips/releases)** page.

> **Windows 11 note:** Windows 11's Smart App Control can block the installer, because AppBlips isn't code-signed yet. If you see "Smart App Control blocked an app that may be unsafe," see [how to install anyway](https://docs.appblips.com/reference/troubleshooting#windows-installer-is-blocked). The Linux builds aren't affected.

The first time you open it, AppBlips asks for an OpenRouter API key and lets you choose from a curated set of coding models. Get a key from [OpenRouter](https://openrouter.ai/settings/keys). Your key is encrypted with your system keychain, and your projects are saved in `Documents/AppBlips/Projects`. See the [desktop app guide](https://docs.appblips.com/quickstart-desktop) for details.

The app tells you when a new version is out. On Windows and with the AppImage it downloads the update itself and offers to restart; you can turn the check off in Settings → Workspace.

On macOS there is no installer yet.

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
testing/             # Standalone Node scripts for exercising the proxy and preview
```

For a full architectural deep-dive (generation flow, preview sandboxing, LLM proxy internals), see [`CLAUDE.md`](CLAUDE.md).

## Security notes

- Generated apps are never rendered directly — they're injected into a sandboxed iframe (`sandbox` without `allow-same-origin`) with an opaque origin, so the app can't reach the parent page and vice versa.
- The desktop app opens no network port, so other devices can't reach it or spend your AI key. Your key is encrypted with the system keychain.
- Windows builds aren't code-signed yet, which is why Smart App Control can block the installer. See the [code signing policy](https://docs.appblips.com/reference/code-signing-policy) for how releases are built and signed.

## License

This project is licensed under the [MIT License](LICENSE).
