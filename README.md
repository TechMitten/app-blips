# NanoApp Studio (Orion)

A React + Vite single-page tool that generates mobile-friendly HTML micro apps from natural-language prompts using a Gemini-like API.

## Features

- AI app generation with prompt-driven updates and version history
- Mobile preview (iframe) and raw code view
- Undo/redo through generated versions
- Download generated HTML as a file
- Tailwind CSS UI + lucide-react icon system
- Responsive two-pane workspace (prompt + preview)

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

`src/App.jsx` contains `generateAppCode` with an empty `apiKey` placeholder. Set your API key from the Google Gemini-like endpoint before using generation:

- `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=YOUR_KEY`

## Scripts

- `npm run dev`: start Vite dev server
- `npm run build`: production bundle
- `npm run preview`: preview built output
- `npm run lint`: run ESLint

## Notes

- The app currently calls a remote generation API and embeds the result in an iframe.
- Ensure CORS and API billing/quotas are configured for your key.
- The code output is treated as raw HTML and displayed directly in `iframe srcDoc`.
