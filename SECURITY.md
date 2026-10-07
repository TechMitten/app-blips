# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Use GitHub's private reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, the steps to reproduce it, and the impact you think it has.

You can expect an acknowledgement within a few days. Please give us reasonable time to fix the problem before disclosing it publicly.

## What's in scope

AppBlips runs LLM-generated code in a sandboxed preview, and the desktop app answers `/api/*` in-process, so these areas matter most:

- **Preview isolation.** Escaping the sandboxed preview iframe, or a generated app reaching the parent page (see `src/previewBridge.js`).
- **The `/api/chat` proxy.** Leaking provider keys, or letting a foreign web page (or a sandboxed generated app) reach the proxy and spend the configured budget.
- **IPC and the filesystem.** Getting from the renderer to the Electron main process or outside the projects folder (see `electron/main.js`, `electron/preload.cjs`).
- **Key storage.** Reading the provider key from the OS keychain backup file.

## Running from source

`/api/chat` performs no authentication: anyone who can reach the dev server can spend your configured LLM budget. That is by design — AppBlips is a single-user application meant to run on your own computer. Keep it on localhost, or put your own access control in front of it. See the Security notes in the README.

## Keys in this repository

No secrets belong in the repository. Provider API keys and similar values are only ever read from environment variables, set in the app, or kept in your operating system's keychain. If you find a secret committed to the repository, please report it privately.
