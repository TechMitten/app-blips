1| <p align="center">
2|   <img src="public/darkthemelog.png" alt="AppBlips — Text to App and Website Generator" width="360" />
3| </p>
4| 
5| <p align="center">
6|   <strong>The simple way to turn an idea into a working app or website.</strong><br />
7|   Describe what you want in plain English, watch it get built in seconds, and use it right away.
8| </p>
9| 
10| <p align="center">
11|   <a href="https://appblips.com">Website</a> ·
12|   <a href="https://docs.appblips.com/">Documentation</a> ·
13|   <a href="https://docs.appblips.com/quickstart-self-hosted">Self-hosting guide</a> ·
14|   <a href="#license">License</a>
15| </p>
16| 
17| <p align="center">
18|   <a href="LICENSE"><img alt="License: Elastic License 2.0" src="https://img.shields.io/badge/license-Elastic_2.0-blue.svg"></a>
19|   <a href="https://docs.appblips.com/"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.appblips.com-080808"></a>
20|   <a href="https://github.com/techmitten/app-blips/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/techmitten/app-blips?style=flat&color=yellow"></a>
21|   <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
22|   <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white">
23|   <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
24| </p>
25| 
26| https://github.com/user-attachments/assets/f4bc6002-6cbe-4529-a027-49d5292c3820
27| 
28| ## Why AppBlips?
29| 
30| Tools like Bolt and Lovable are great, but they're built for developers — multi-file projects, build pipelines, and IDE-style interfaces. **AppBlips is built to be simple.** Every app or website[...]
31| 
32| ## What it is
33| 
34| AppBlips lets you describe an app or website in plain language and get back a working version you can preview, tweak, and use immediately. Type what you want, and AppBlips builds it as a single, s[...]
35| 
36| AppBlips has two studios, switchable from the header:
37| 
38| - **App Studio** — interactive tools, games, and dashboards. JavaScript-driven, saves its data in the browser, and designed to feel native on a phone (mobile preview by default).
39| - **Website Studio** — content-first pages such as landing pages, portfolios, restaurant or business sites, and blogs. It builds real website anatomy (navigation, hero, content sections, footer)[...]
40| 
41| Both studios share the same workflow: prompt, live preview, versions, export, and deploy.
42| 
43| Under the hood, AppBlips is a React app that sends your build prompt to an AI model through a server-side proxy and renders the result live in a safely sandboxed preview. That builder connection i[...]
44| 
45| There are two ways to run it:
46| 
47| - **Hosted** ([appblips.com](https://appblips.com)) — the official service. Sign in and build straight from your browser, with nothing to install. Your projects sync to your account, and any app[...]
48| - **Self-hosted** — run your own copy on your computer, for your own use. A single local user, no sign-in and no cloud sync — just you and the app. See [License](#license) for what is allowed.
49| 
50| See [Quick start](#quick-start) below to pick one.
51| 
52| ## Features
53| 
54| - **One simple prompt box** — describe your idea in plain English and get a working app or website back
55| - **App and Website studios** — pick the studio that fits; each has its own prompts, starter ideas, and default preview size
56| - **Click-to-edit websites** — in the Website Studio, click text, images, and links right in the preview to change them directly, with an AI-assisted edit through chat when a change needs more t[...]
57| - **Instant live preview** — see exactly what you built, right next to the prompt, with no extra deploy step
58| - **Ask for changes in plain English** — request a tweak and AppBlips edits the app or website for you, no code required
59| - **Attach images** — drop in a screenshot or reference picture and have AppBlips build from it
60| - **AI-powered generated apps** — turn on AI before building and ask for features that call `blip.ai.text(...)`
61| - **Undo/redo** — every generation and edit is saved as a version you can always go back to
62| - **Mobile and desktop views** — check how your app or website looks on different screen sizes, with adjustable zoom
63| - **Export to HTML** — download any generated app or website as a single self-contained HTML file, ready to host or share anywhere
64| - **Deploy to a public URL** *(hosted only)* — publish an app or website to its own link, installable as a PWA and optionally password-protected
65| 
66| ## Documentation
67| 
68| Full guides live at **[docs.appblips.com](https://docs.appblips.com/)**: an [introduction](https://docs.appblips.com/introduction), the [hosted](https://docs.appblips.com/quickstart-hosted) and [s[...]
69| 
70| ## Quick start
71| 
72| ### Hosted (suggested)
73| 
74| Go to **[appblips.com](https://appblips.com)**, sign in, and start typing. There's nothing to install and no API key to bring. Apps you deploy are automatically assigned their own public URL and a[...]
75| 
76| ### Self-hosted
77| 
78| Prefer to run AppBlips on your own computer? There is no signup, and once it is running, using it is as simple as typing a prompt. You need one server-side API key to power the builder. AI inside [...]
79| 
80| **Prerequisites:** [Node.js](https://nodejs.org/) 20.19+ (or 22.12+) and npm (npm comes bundled with Node.js).
81| 
82| ```bash
83| git clone https://github.com/techmitten/app-blips.git   # download the project
84| cd app-blips                                            # move into the project folder
85| npm install                                             # install dependencies
86| cp .env.example .env                                    # create your local config file
87| ```
88| 
89| Open the new `.env` file and fill in **two lines**: the API key for one AI provider, and the model. The file lists OpenAI, OpenRouter, DeepSeek and Z.ai; a provider is active once its key is fille[...]
90| 
91| ```
92| APPBLIPS_OPENAI_API_KEY=your-api-key
93| APPBLIPS_LLM_MODEL=gpt-5.1
94| ```
95| 
96| Use OpenRouter to reach Claude, Gemini and most other models. Any other OpenAI-chat-completions-compatible endpoint works too (see "Advanced" in `.env.example`). When AppBlips starts, it prints wh[...]
97| 
98| Then start AppBlips:
99| 
100| ```bash
101| npm run dev
102| ```
103| 
104| Open `http://localhost:5175` in your browser — that is it, you are ready to build.
105| 
106| ### AI inside the apps you build
107| 
108| Turn on the **AI** switch before generating or refining an app, then describe the feature in ordinary language. For example:
109| 
110| > Build a joke-writing app. When someone chooses a topic and presses Generate, call `blip.ai.text` to write one short, family-friendly joke, show a loading state, and display a friendly retry mes[...]
111| 
112| AppBlips teaches the generated code the `blip.ai.text(messages, options)` API. References such as `BLIP.AI.TEXT` in a build prompt are accepted too; generated JavaScript uses the canonical lowerc[...]
113| 
114| By default, AI in your apps uses the same provider and model as the builder, so there is nothing extra to set up. If you would rather have each person bring their own key, set `APPBLIPS_GENERATED[...]
115| 
116| The generated app can also expose a settings action that calls `blip.ai.configure()`. It can check `blip.ai.isConfigured()` and disconnect with `blip.ai.clearConfiguration()`. App authors do not [...]
117| 
| 118| When self-hosted, generated apps reach your provider through your own AppBlips at `/api/app-ai/chat`. They always share the builder's provider, key and model. The browser only ever receives the r[...]
119| 
120| ## Running with Docker
121| 
122| If you'd rather not run the dev server, you can use Docker instead of `npm run dev`. The image builds the static client and serves it — along with the builder `/api/chat` endpoint and optional [...]
123| 
124| ```bash
125| docker compose up --build
126| ```
127| 
128| This reads environment variables from the same `.env` file as above and serves the app on `http://localhost:3000`. The port is bound to `127.0.0.1`, so only your own computer can reach it.
129| 
130| `APPBLIPS_GENERATED_AI_MODE` and `APPBLIPS_APP_AI_RELAY_URL` are baked into the client at build time, so after changing either one, rerun `docker compose up --build` (a plain restart won't pick i[...]
131| 
132| ## Configuration
133| 
134| Your settings live in the `.env` file. With `APPBLIPS_GENERATED_AI_MODE=byok`, each person using a finished AI-enabled app supplies their own provider settings in that app instead. See [`.env.exa[...]
135| 
136| | Group | Variables | Notes |
137| | --- | --- | --- |
138| | LLM (required, one provider) | `APPBLIPS_OPENAI_API_KEY`, `APPBLIPS_OPENROUTER_API_KEY`, `APPBLIPS_DEEPSEEK_API_KEY` or `APPBLIPS_ZAI_API_KEY`, plus `APPBLIPS_LLM_MODEL` | A provider is active [...]
139| | LLM tuning (optional) | `APPBLIPS_LLM_MAX_TOKENS`, `APPBLIPS_LLM_ASK_MAX_TOKENS`, `APPBLIPS_LLM_TEMPERATURE` | `APPBLIPS_LLM_ASK_MAX_TOKENS` caps Ask-mode replies only (default `8192`, independ[...]
140| | Rate limiting (optional) | `APPBLIPS_CHAT_RATE_LIMIT_MAX`, `APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS` | Per-user limit on `/api/chat`, defaulting to 60 requests per 300s. Tracked in memory per s[...]
141| | Generated-app AI mode | `APPBLIPS_GENERATED_AI_MODE`, `APPBLIPS_APP_AI_RELAY_URL` | Self-hosted only. The default `relay` sends app AI through your builder provider; `byok` makes each person us[...]
142| | Generated-app AI limits (optional) | `APPBLIPS_APP_AI_MAX_TOKENS`, `APPBLIPS_APP_AI_TEMPERATURE`, `APPBLIPS_APP_AI_REASONING_EFFORT` | AI in generated apps always uses the builder's provider, k[...]
143| | Generated-app relay controls | `APPBLIPS_APP_AI_ALLOWED_ORIGINS`, `APPBLIPS_APP_AI_RATE_LIMIT_MAX`, `APPBLIPS_APP_AI_RATE_LIMIT_WINDOW_SECONDS` | Exact cross-origin allowlist and per-IP in-memo[...]
144| | Deployed-app AI sessions | `APPBLIPS_SESSION_SECRET`, `APPBLIPS_AI_SESSION_TTL_SECONDS`, `APPBLIPS_AI_REQUIRE_SESSION`, `APPBLIPS_AI_REQUIRE_ORIGIN`, `TURNSTILE_SECRET`, `VITE_AI_SESSION_ENABLE[...]
145| | Hosting mode | `SELF_HOSTED_MODE` | Defaults to self-hosted and is not in `.env.example`. `false` enables the Firebase-backed hosted mode that runs appblips.com; its settings are in [`.env.host[...]
146| 
147| > **Note:** self-hosted AppBlips is meant to run on your own computer. `/api/chat` performs no authentication — every request is treated as the same local user — so keep it on localhost. If y[...]
148| 
149| ---
150| 
151| *The sections below are for developers working on AppBlips itself. If you just want to build apps, you're already set — open AppBlips and start typing.*
152| 
153| ## Available scripts
154| 
155| | Command | Description |
156| | --- | --- |
157| | `npm run dev` | Start the Vite dev server on port 5175 |
158| | `npm run build` | Production build to `dist/` |
159| | `npm run lint` | Run ESLint |
160| | `npm run preview` | Preview the production build locally |
161| | `npm run usage` | Usage dashboard for the appblips.com maintainers (hosted mode only; needs the Firebase CLI logged in) |
162| 
163| There's no automated test suite wired to `npm test`. The `testing/` directory holds standalone scripts run directly with Node (e.g. `node testing/testChatProxy.js`, `node testing/test-ai-relay.js[...]
164| 
165| ## Project structure
166| 
167| ```
168| src/
169|   App.jsx            # Workspace/generation state, undo-redo, composition root
170|   previewBridge.js   # Script injected into generated apps to bridge the sandboxed iframe
171|   firebase.js        # Single Firebase SDK init point (no-op in self-hosted mode)
172|   lib/               # Framework-free logic: LLM calls, surgical edits, prompts, deploy, crypto...
173|   hooks/             # Stateful concerns: auth, projects, deployment, preview viewport...
174|   components/        # Presentational UI: Header, BuildPanel, PreviewPane, modals...
175|   functions/           # /api/chat proxy and AI relays, plus the Cloudflare Pages Functions behind appblips.com
176|   server.js            # Standalone Node server used by the Docker setup
177|   scripts/             # Maintainer tooling for appblips.com (usage dashboard)
178|   testing/             # Standalone Node scripts for exercising the proxy, AI relay and preview
179| ```
180| 
181| For a full architectural deep-dive (generation flow, preview sandboxing, LLM proxy internals, deploy pipeline), see [`CLAUDE.md`](CLAUDE.md).
182| 
183| ## Security notes
184| 
185| - Generated apps are never rendered directly — they're injected into a sandboxed iframe (`sandbox` without `allow-same-origin`) with an opaque origin, so the app can't reach the parent page and[...]
186| - Self-hosted BYOK credentials are entered explicitly by the finished-app user and live in browser storage only. Session storage is the default; persistent storage is opt-in. They are never bundl[...]
187| - The self-hosted generated-app relay (`/api/app-ai/chat`) spends your provider key. It only accepts same-origin calls unless you list other origins in `APPBLIPS_APP_AI_ALLOWED_ORIGINS`, and its [...]
188| - In self-hosted mode, `/api/chat` has no token verification — every request is treated as the same local user, so anyone who can reach it can spend your configured AI budget. Keep it on localh[...]
189| - On appblips.com, deployed apps are served from a separate hostname, never the app's own origin — they're AI-generated code with full script privileges, so keeping them off-origin stops them r[...]
190| 
