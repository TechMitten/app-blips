# Contributing to AppBlips

Thanks for helping out. Issues and pull requests are welcome.

AppBlips is licensed under the [Elastic License 2.0](LICENSE). By opening a pull request, you agree that your contribution is licensed under the same terms.

## Running it locally

```bash
npm install
cp .env.example .env    # then fill in one provider key and APPBLIPS_LLM_MODEL (e.g. APPBLIPS_OPENAI_API_KEY)
npm run dev             # http://localhost:5175
```

By default this runs in self-hosted mode: no sign-in, no Firebase. You only need an OpenAI-compatible LLM endpoint. See the [README](README.md) for the full configuration.

## Before you open a pull request

1. Run `npm run lint` and fix anything it reports.
2. Run `npm run build` to make sure the production build still works.
3. If you changed code in `src/lib/` or `functions/_lib/`, run the matching script in `testing/`, for example `node testing/testChatProxy.js`. These are standalone Node scripts, not a single `npm test` suite.
4. Keep the change focused. One fix or feature per pull request is easier to review.

## Things to be careful with

- **Preview isolation.** The generated app's iframe must never get `allow-same-origin`, and the preview bridge must never be written into saved project code. See the "Preview isolation" section of [CLAUDE.md](CLAUDE.md) before touching `src/previewBridge.js` or `usePreviewBridge`.
- **Secrets.** Never commit `.env` or any provider key. The `APPBLIPS_*` server variables must not be added to Vite's `envPrefix`.
- **New LLM tools.** Add any new tool name to `ALLOWED_TOOL_NAMES` in `functions/_lib/chatProxy.js`, or hosted mode will reject it.

## Reporting security problems

Please don't use public issues for those. See [SECURITY.md](SECURITY.md).
