# Documentation project instructions

For Mintlify product knowledge (components, configuration, writing standards), install the Mintlify skill: `npx skills add https://mintlify.com/docs`

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json` (navigation and redirects). A page that isn't listed there doesn't appear in the sidebar
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP
- Mintlify only publishes `docs/` when it changes on `master`. Nothing keeps it in sync with the app, so update the docs in the same commit as any change a user would notice (see the repo's `CLAUDE.md`)

## Audience

Most readers are beginners who have never used an API key or a terminal.

- Write instructions as numbered steps, one action per step. Say exactly where to click and what to type
- Explain jargon the first time it appears on a page (API key, token, model, CDN)
- Lead with the easiest path (for example the Microsoft Store on Windows) and put alternatives after it

## Terminology

- **AppBlips** for the product. Never "the tool" or "the platform"
- **Desktop app** (installed on Windows or Linux) and **browser version** (run from source with `npm start`, or with Docker). Say "from source or Docker" when both are meant
- **Microsoft Store version** and **installer from GitHub** when the two Windows installs behave differently (signing, updates)
- Studios, exactly as on screen: **Mobile & Web App**, **Responsive Website**, **Browser Game**, **Quick Start & Library**, **Import a site**. In running text, "the App studio", "the Website studio" and "the Game studio" are fine
- **App** for what the user builds, **project** for what is saved (a project holds every version and the chat)
- **Imported site** for a React + Vite project opened from a `.zip`
- **AI provider**, **API key** and **model**. Not "LLM", "endpoint" or "backend" in user-facing text
- **Build mode** and **Ask mode**; **review** for the optional AI review after a build

## UI labels

- Copy every label exactly from the app's source (`src/components/`), including capitals. Check it there before writing; don't guess from memory
- Settings paths are bold with arrows: **Settings → API**. Provider, key and model are under **API**; reasoning, output tokens, review and other AI behaviour are under **AI**. **Workspace**, **Appearance**, **Data**, **Legal**, **Licenses**, **About** and **Danger Zone** are the other tabs
- Icon-only keys: describe the icon and give its tooltip text, for example "the **Select parent** key (an arrow pointing up to a line)"
- Quote error messages exactly as the app shows them, so readers can search for them

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise: one idea per sentence
- Use sentence case for new headings. Some older headings are Title Case; fix them when you edit that section (anchors don't change, because Mintlify lowercases them)
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, environment variables and code references
- Spelling: match the page you're editing. Keep the app's own spelling inside UI labels (for example **Text color**)

## Components

- `<Steps>` for setup sequences, `<Tabs>` for per-platform instructions
- `<AccordionGroup>` for troubleshooting and FAQ entries. Title troubleshooting entries with the error message or symptom the reader sees
- `<ParamField>` with `default=` for each setting in `reference/settings.mdx` and each variable in `self-hosting/configuration.mdx`
- `<Note>`, `<Tip>` and `<Warning>` sparingly: at most one or two per section
- Use lists, not tables, for anything longer than a few short rows

## Content boundaries

- Don't describe planned or unfinished features as if they exist (signing, macOS installer, and so on). Check signing and release claims against `RELEASING.md` and `.github/workflows/`
- Privacy and network claims must match the code: everything AppBlips connects to is listed in the FAQ entry "What does AppBlips connect to?". Update it when that changes
- Don't use version-relative wording such as "the new version" or "before this change". Name the version number instead
- Keep developer-only commands (`npm run dev`, release scripts, tests) out of user pages. Commands to run AppBlips belong in `quickstart-source.mdx` and the self-hosting pages
- Don't document internal behaviour users can't see or act on (prompt wording, retry counts, file formats inside `project.json`)
