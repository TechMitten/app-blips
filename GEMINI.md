# GEMINI.md

## Project Overview
Orion is a React + Vite single-page application that generates and iteratively updates complete mobile-friendly HTML micro apps from natural-language prompts.

The app supports two LLM providers:
- OpenRouter chat completions
- Google Gemini GenerateContent / StreamGenerateContent

Generated output is rendered directly in an iframe (`srcDoc`) and tracked as versioned history per project.

## Tech Stack
- React 19 (`react`, `react-dom`)
- Vite 8 (`@vitejs/plugin-react`)
- Tailwind CSS 4 (via PostCSS plugin)
- Firebase Web SDK (`auth`, `firestore`, `analytics`)
- lucide-react icons
- ESLint 9 flat config

## Repository Structure
- `src/App.jsx`: Main application logic and UI
- `src/components/AuthModal.jsx`: Authentication modal (Google + email/password)
- `src/firebase.js`: Firebase initialization and exports
- `src/main.jsx`: React bootstrap
- `src/index.css`, `src/App.css`: Styling
- `firebase.json`: Firebase local configuration metadata
- `firestore.rules`: Firestore access rules
- `firestore.indexes.json`: Firestore index definitions
- `eslint.config.js`: Lint configuration
- `tailwind.config.js`, `postcss.config.js`: Tailwind/PostCSS configuration

## Prerequisites
- Node.js 18+
- npm
- A Firebase project
- At least one model provider key (OpenRouter and/or Gemini)

## Install And Run
```bash
npm install
npm run dev
```

Default dev URL:
- `http://localhost:5173`

Other scripts:
- `npm run build`: Production build
- `npm run preview`: Preview built app
- `npm run lint`: Run ESLint

## Environment Variables
Create a `.env` file in the project root.

### LLM Provider Variables
- `VITE_OPENROUTER_API_KEY`
- `VITE_OPENROUTER_MODEL` (optional, default: `openrouter/free`)
- `VITE_GEMINI_API_KEY`
- `VITE_GEMINI_MODEL` (optional, default: `gemini-2.5-flash-preview-09-2025`)

Notes:
- Provider selection is stored in `localStorage` key `orion-api-provider`.
- The app can stream responses for both providers.

### Firebase Variables
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Important:
- `src/firebase.js` currently hardcodes `measurementId: "G-JMSRJG9BFC"`.
- Update this value if needed for your Firebase project.

## Firebase Setup Requirements
In Firebase Console:
1. Create a project and web app.
2. Enable Firestore.
3. Enable Firebase Authentication providers:
   - Email/Password
   - Google (required because UI uses Google sign-in popup)

Firestore security model used by this app (`firestore.rules`):
- Users can read/write only under `users/{userId}/...` when authenticated and `request.auth.uid == userId`.
- All other document paths are denied.

## Data Model
User projects are stored in Firestore at:
- `users/{uid}/projects/{projectId}`

Each project document contains:
- `name`: string
- `versions`: array of version objects
- `currentVersionIndex`: number
- `lastModified`: server timestamp

Each version object contains:
- `id`: number (timestamp-based)
- `prompt`: string
- `code`: string (full HTML)
- `timestamp`: localized time string

## Core Runtime Behavior
- Users must be authenticated before generating apps.
- If a project is unnamed and new, naming is required before first generation.
- On generation, a new version is appended.
- If generating from an older version state, future versions are truncated (undo/redo semantics).
- Project name changes are autosaved with a debounce.
- The current project id is persisted to `localStorage` as `orion-current-project-id`.
- Anonymous local progress can be migrated to Firestore when a user logs in.

## LLM Integration Notes
Prompting strategy includes:
- A fixed system prompt requiring full, raw HTML output.
- A user prompt for either creating or updating an app.

Streaming:
- Gemini stream parsing handles chunked JSON object extraction.
- OpenRouter stream parsing handles SSE `data:` lines.

Output sanitation:
- Markdown code fences are stripped.
- If HTML appears in mixed output, content is trimmed to HTML start/end.

Retry behavior:
- Exponential backoff retries are implemented for generation failures.

## Development Guidelines
When modifying this project:
1. Keep generated output handling strict: app expects full HTML documents.
2. Preserve per-user Firestore isolation (`users/{uid}` path model).
3. Avoid breaking undo/redo version semantics.
4. Keep auth-gated generation flow intact.
5. Validate both providers (`openrouter`, `gemini`) still work after API changes.
6. Run lint before shipping changes.
7. Keep all source files at 2000 lines or less for easier management and maintainability.

Recommended local validation:
```bash
npm run lint
npm run build
```

## Known Constraints And Caveats
- Generated HTML is rendered directly into an iframe via `srcDoc`; treat model output as untrusted content from a security perspective.
- Firebase Analytics is initialized unconditionally in `src/firebase.js`.
- If only one provider key is configured, selecting the other provider in settings will fail at generation time.
- Firestore queries sort by `lastModified`; ensure indexes remain compatible when query shape changes.

## Quick Troubleshooting
- "Gemini API key is missing": set `VITE_GEMINI_API_KEY`.
- "OpenRouter API key is missing": set `VITE_OPENROUTER_API_KEY`.
- Auth popup/sign-in issues: verify enabled providers in Firebase Console.
- No projects loading/saving: verify Firestore rules and Firebase env variables.
- Build/lint issues: run `npm run lint` and inspect `eslint.config.js`.
