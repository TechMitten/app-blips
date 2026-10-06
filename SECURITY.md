# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Use GitHub's private reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, the steps to reproduce it, and the impact you think it has.

You can expect an acknowledgement within a few days. Please give us reasonable time to fix the problem before disclosing it publicly.

## What's in scope

AppBlips runs LLM-generated code, and appblips.com hosts it at public URLs, so these areas matter most:

- **Preview isolation.** Escaping the sandboxed preview iframe, or a generated app reaching the parent page (see `src/previewBridge.js`).
- **Deployed apps.** Anything that lets a deployed app read another user's data, or run on the main app's origin.
- **The `/api/chat` proxy.** Auth bypass, rate-limit bypass, or leaking provider keys.
- **Firestore rules and the deploy API.** Reading or writing another user's projects, deployments, usage or subscription, or publishing under someone else's link or username.

## Self-hosting

In the default single-user configuration, `/api/chat` performs no authentication, so anyone who can reach it can spend your configured LLM budget. That is by design: a single-user AppBlips is meant to run on your own computer. If other devices on your network can reach it, put your own access control in front of it. See the Security notes in the README.

## Keys in this repository

The Firebase web API key and project identifiers are client-side configuration, not secrets. Access is enforced by Firebase Auth, `firestore.rules` and server-side checks. Real secrets (LLM keys, session secrets and similar) are only ever read from environment variables. If you find one committed to the repository, please report it privately.
