# Orion

A React + Vite single-page tool that generates mobile-friendly HTML micro apps from natural-language prompts using a Gemini-like API.

## Features

- AI app generation with prompt-driven updates and version history
- Mobile preview (iframe) and raw code view
- Undo/redo through generated versions
- Download generated HTML as a file
- Tailwind CSS UI + lucide-react icon system
- Responsive two-pane workspace (prompt + preview)
- **User Authentication**: Sign up and login using Firebase.
- **Persistence**: Save and load your generated apps and their full version history to the cloud.

## Stack

- React 19
- Vite 4+ (vite.config.js)
- Tailwind CSS 4 + PostCSS
- lucide-react icons
- ESLint (with React plugin)

## Project layout

- `src/App.jsx`: core application logic (prompt form, API call, versioning, preview)
- `src/main.jsx`: render app bootstrapped by ReactDOM
- `src/index.css` / `src/App.css`: base styling

## Setup

1. Clone repository
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:5173`

## API requirement

`src/App.jsx` now supports two providers via a settings UI:

- `openrouter` using `VITE_OPENROUTER_API_KEY`
- `gemini` using `VITE_GEMINI_API_KEY`
- models set in `.env`:
  - `VITE_OPENROUTER_MODEL` (default: `openrouter/free`)
  - `VITE_GEMINI_MODEL` (default: `gemini-2.5-flash-preview-09-2025`)

- `https://generativelanguage.googleapis.com/v1beta/models/<your model>:generateContent?key=YOUR_KEY`

## Firebase Setup

To enable user accounts and cloud saving:

1. Create a Firebase Project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication** (Email/Password Provider).
3. Create a **Firestore Database** in test mode or with appropriate security rules.
4. Add a **Web App** to the project to get your SDK configuration.
5. Fill in the Firebase variables in your `.env` file:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

## Scripts

- `npm run dev`: start Vite dev server
- `npm run build`: production bundle
- `npm run preview`: preview built output
- `npm run lint`: run ESLint

## Notes

- The app currently calls a remote generation API and embeds the result in an iframe.
- Ensure CORS and API billing/quotas are configured for your key.
- The code output is treated as raw HTML and displayed directly in `iframe srcDoc`.
