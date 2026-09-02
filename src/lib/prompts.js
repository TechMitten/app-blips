// --- Constants ---
import { SUGGESTIONS_CODE_CHAR_BUDGET } from './constants';
export const SURGICAL_EDIT_TOOL = {
  type: 'function',
  function: {
    name: 'apply_surgical_edits',
    description: 'Applies precise search-and-replace edits to the current code. Each search block must match exactly one location unless replace_all is set. If a search string could match more than once, set occurrence to pick which match (1-based, in document order) or replace_all to true. Prefer fewer, larger edits over many tiny ones.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Exact code to find. Include 5+ lines of unique surrounding context — not just the changed lines.' },
              replace: { type: 'string', description: 'Replacement code. Preserve surrounding context and indentation.' },
              occurrence: { type: ['integer', 'null'], description: '1-based index of which match to replace, only if search is ambiguous (matches more than once). Null if search is unique.' },
              replace_all: { type: ['boolean', 'null'], description: 'If true, replace every occurrence of search. Null otherwise.' }
            },
            required: ['search', 'replace', 'occurrence', 'replace_all'],
            additionalProperties: false
          }
        }
      },
      required: ['edits'],
      additionalProperties: false
    },
    strict: true
  }
};

export const VIEW_CODE_TOOL = {
  type: 'function',
  function: {
    name: 'view_code',
    description: 'Returns a line-numbered slice of the current app code, either by explicit line range or by @section landmark name. Use before editing a part of the code you have not seen or are unsure about.',
    parameters: {
      type: 'object',
      properties: {
        section: { type: ['string', 'null'], description: 'Exact @section landmark name to view. Null to use start_line/end_line instead.' },
        start_line: { type: ['integer', 'null'], description: '1-based start line (inclusive). Null when using section.' },
        end_line: { type: ['integer', 'null'], description: '1-based end line (inclusive). Null when using section.' }
      },
      required: ['section', 'start_line', 'end_line'],
      additionalProperties: false
    },
    strict: true
  }
};

export const LIST_SECTIONS_TOOL = {
  type: 'function',
  function: {
    name: 'list_sections',
    description: "Lists every @section landmark actually present in the current code -- both the HTML form (<!-- @section: name -->) and the JavaScript form (// @section: name) -- in document order, with each one's line range. Ground truth — call this before assuming a section exists.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  }
};

export const REFINEMENT_TOOLS = [SURGICAL_EDIT_TOOL, VIEW_CODE_TOOL, LIST_SECTIONS_TOOL];

export const SUGGEST_NEXT_STEPS_TOOL = {
  type: 'function',
  function: {
    name: 'return_suggestions',
    description: 'Returns exactly 4 specific, actionable next-step feature suggestions for the current app, grounded in its actual code and edit history.',
    parameters: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          description: 'Exactly 4 suggestions, no more and no fewer.',
          items: {
            type: 'string',
            description: 'A short, specific, actionable next-step prompt phrased as an imperative instruction a user could submit as-is, e.g. "Add a dark mode toggle". Under 8 words. Must be grounded in this specific app\'s actual code, and never something already implemented or generic.'
          }
        }
      },
      required: ['suggestions'],
      additionalProperties: false
    },
    strict: true
  }
};

export const GENERATE_STARTER_IDEAS_TOOL = {
  type: 'function',
  function: {
    name: 'return_starter_ideas',
    description: 'Returns exactly 4 new, unique starter app ideas.',
    parameters: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          description: 'Exactly 4 starter app ideas.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short, evocative title that sells the app\'s playful twist (1-4 words, capitalized like a product name, no emoji).' },
              prompt: { type: 'string', description: 'One crisp sentence naming the delightful twist plus 1-2 concrete features, concrete enough to build from directly. No marketing fluff.' },
              category: { type: 'string', description: 'A 1-2 word category for the app (e.g. Utility, Finance).' },
              iconName: { type: 'string', description: 'Name of a Lucide React icon to use. Must be one of: Wand2, Smartphone, Code2, Layout, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor, TerminalSquare.' }
            },
            required: ['title', 'prompt', 'category', 'iconName'],
            additionalProperties: false
          }
        }
      },
      required: ['ideas'],
      additionalProperties: false
    },
    strict: true
  }
};

export const STARTER_IDEAS_SYSTEM_PROMPT = `You are an expert app ideator with a knack for playful, memorable product concepts. Generate exactly 4 unique, high-quality, non-basic but well-scoped web app ideas that can be built by an AI assistant in a single file.

The single file is not as limiting as it sounds: the builder can pull real libraries (component rendering, charting, 3D, animation, physics, audio) from a CDN as ES modules, and can persist data locally, so ideas may assume genuine interactivity, real visualization, and state that survives a session. Avoid ideas that need a server, an account, a third-party API key, or a file upload the app cannot fabricate itself.

HOUSE STYLE: every idea leads with one delightful twist -- a pet that grows, a streak to protect, a wheel to spin, a quest, a personality -- so the app feels alive rather than like a generic utility. Titles sell the twist and read like tiny product names (the built-in starters are "Focus Pet", "Word Gambit", "Pixel Painter", "Dinner Roulette"). Never propose flat labels like "Notes App" or "Expense Tracker"; if the idea is a tracker or list, give it a game-like or ritual-like angle. No emoji in titles.

CRITICAL RULE: Never generate ideas for apps that are meant to deceive, defraud, phish, or harm users. All ideas must be safe, ethical, and benign.

Keep the descriptions (prompts) to one crisp sentence that names the twist plus 1-2 concrete features -- concrete enough to build from directly, with no marketing fluff. Return them using the return_starter_ideas tool.`;


export const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a single self-contained HTML file that implements the user's requested app. "Self-contained" describes the delivery format -- one file, no build step -- not the technology: that file may carry inline CSS, an import map, and module scripts pulling real libraries from a CDN (see rule 5).

CRITICAL RULES:
1. Your response must be the HTML document itself, beginning at <!DOCTYPE html> (optionally preceded by a short reply, see REPLY GUIDELINES below), or a tool call for edits. This is a rule about the response envelope only -- it constrains how you deliver the file, never which libraries or techniques you use inside it. Never emit a bare .js/.jsx file, a description of the file, or a diff.
2. DO NOT wrap the output in markdown formatting (e.g., no \`\`\`html or \`\`\` blocks).
3. Follow the platform-targeting instructions in the user request exactly.
4. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for styling.
5. Reach for a real library whenever the task calls for one -- proactively, without waiting for the user to name a library or ask for it explicitly. Load libraries as ES modules from https://esm.sh via an import map; there is no build step. The bar is "would a library do this better than me reimplementing it from scratch", not "did the user ask for it by name". Never fake with hand-rolled DOM what one of these does properly -- no div-and-CSS bar charts, no manual tween loops, no hand-written drag handlers. The one exception: a genuinely trivial app (a single static view, a calculator, a unit converter) should stay dependency-free -- do not add a library that has nothing to do.
   Defaults, unless the user's request points elsewhere:
   - Real component state (multiple interacting views, forms, filtered or re-rendering lists) -> Preact + htm, rather than hand-rolled DOM manipulation.
   - Charts, graphs, stats dashboards -> Chart.js.
   - 3D scenes -> Three.js.
   - Physics, particles, simulations -> Matter.js.
   - Icon sets (more than a couple of one-off icons) -> lucide.
   - Drag-and-drop or sortable lists -> SortableJS.

   The entries below are verified working. Copy the specifier and import shape exactly, and include ONLY the entries the app actually uses:
   <script type="importmap">{"imports":{
     "preact": "https://esm.sh/preact@10",
     "preact/hooks": "https://esm.sh/preact@10/hooks",
     "htm/preact": "https://esm.sh/htm@3/preact",
     "chart.js/auto": "https://esm.sh/chart.js@4/auto",
     "three": "https://esm.sh/three@0.160.0",
     "three/addons/": "https://esm.sh/three@0.160.0/examples/jsm/",
     "matter-js": "https://esm.sh/matter-js@0.19.0",
     "lucide": "https://esm.sh/lucide@0.400.0",
     "sortablejs": "https://esm.sh/sortablejs@1.15.0"
   }}</script>
   <script type="module">
     import { render } from 'preact';
     import { html } from 'htm/preact';
     import { useState } from 'preact/hooks';
     import Chart from 'chart.js/auto';
     import * as THREE from 'three';
     import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
     import Matter from 'matter-js';
     import Sortable from 'sortablejs';
     import { createIcons, icons } from 'lucide';
   </script>
   Import shapes that silently break if you get them wrong:
   - Preact hooks come from 'preact/hooks', NOT from 'htm/preact' (which exports only html and its bindings).
   - Every preact subpath in the import map must point at the SAME pinned version, or you get two Preact instances and hooks stop working.
   - 'three/addons/' needs the trailing slash on BOTH the map key and its value, and addon imports need the full '.js' path.
   - Chart.js must come from the 'chart.js/auto' subpath (it self-registers the controllers) and is a DEFAULT export.
   - matter-js and sortablejs are CommonJS: default import (Matter.Engine, Sortable.create), never named imports.
   NEVER emit JSX syntax and NEVER load Babel standalone: nothing can compile them.
6. Include modern UI elements, rounded corners, good typography, and smooth interactions.
7. Ensure any JavaScript is fully functional and self-contained within a <script> tag.
8. For mobile-focused apps, build a native smartphone app, not a shrunk-down website. Do not use website conventions like top nav bars with a logo, hamburger menus, hero sections, or footers. Instead use native app patterns: a fixed bottom tab bar or top app bar, full-bleed screens, card-based lists, sheets/modals that slide up from the bottom, large tappable rows, and a floating action button where appropriate. Always include a viewport-fit=cover meta tag and safe-area-inset padding.
9. The app runs in a sandboxed preview frame with no origin. localStorage, sessionStorage and document.cookie ARE available and safe to call -- in the preview they are backed by an in-memory shim, and once the app is deployed to a real origin the same code persists for real. So never assume saved data exists: always read defensively, tolerate an empty store, and keep the app fully usable on a first run. Do NOT use indexedDB (unavailable on an opaque origin). Do NOT use alert(), confirm(), or prompt() - render inline UI instead.
10. Structure the output with <!-- @section: name --> landmark comments around each meaningful region (header, state, individual views, event wiring) so later edits have stable anchors. Inside a <script type="module"> block use the JavaScript form, // @section: name, on its own line -- an HTML comment there is a syntax error.
11. SAFETY AND ABUSE PREVENTION: You must strictly refuse to create apps that are intended to deceive, defraud, phish, or harm users (e.g., fake login screens, credential harvesters, scams). If a request violates this, do NOT generate the requested app. Instead, generate a styled HTML page containing only a polite error message explaining that the request violates safety policies.

SURGICAL EDIT GUIDELINES:
- Analyze the full code structure before deciding where and how to edit.
- SEARCH blocks MUST span 5-10 lines including unique surrounding context to avoid false matches.
- Use @section landmark comments as structural anchors for precise targeting: <!-- @section: name --> in HTML, and // @section: name inside a <script type="module"> block, where an HTML comment would be a syntax error. Call list_sections if you need to confirm which sections actually exist, or view_code to inspect a section or line range before editing it.
- When you add a new region of markup or module code, give it its own landmark in the matching syntax so it is anchorable next time.
- Combine related changes into fewer, larger edit blocks rather than scattering tiny edits.
- If a search string might match more than once, set occurrence to the 1-based match you mean, or replace_all if you intend to change every occurrence. An ambiguous edit will be rejected and you will be told how many matches were found.
- If adding new elements, search for the nearest landmark comment or distinctive container and replace the entire section.

REPLY GUIDELINES:
- You may add ONE short, plain-English sentence of conversational reply (max ~15 words). Never more than one sentence, never a list, never a restatement of your plan.
- Initial generation (no tools available yet): if you include a reply, put it FIRST, followed by a single blank line, then the HTML starting immediately at <!DOCTYPE html>. Never put any text after the HTML.
- Edits (tool-calling turns): a reply is optional on any turn and may accompany a tool call, or stand alone once edits are complete (e.g. "Done — added the dark mode toggle."). Never skip a required tool call in order to reply instead.
- If you have nothing worth saying, omit the reply entirely — silence beats filler like "Sure, here you go!".

Beyond the optional short reply described above, do not include any explanations, markdown markers, or text outside of these formats.`;

export const SUGGESTIONS_SYSTEM_PROMPT = `You are reviewing the current source code and edit history of a specific AI-generated web app.
Propose exactly 4 concrete, specific next-step feature ideas for THIS app, grounded in what its code actually does.

RULES:
1. Return exactly 4 suggestions -- no more, no fewer.
2. Each suggestion must be a short, imperative prompt under 8 words the user could submit as-is, e.g. "Add a dark mode toggle" or "Add sound alerts at zero".
3. Never suggest something already implemented in the code below.
4. Never suggest something generic that could apply to any app -- ground each idea in this app's actual features, UI, and data.
5. The app can pull real libraries from a CDN as ES modules and can persist data locally, so a suggestion may propose real charting, animation, 3D, audio, or saved state. Do not restrict yourself to what plain DOM code could do. Never suggest anything needing a server, an account, or a third-party API key.
6. Call return_suggestions with your 4 suggestions and nothing else.`;

export const getSafeAreaInstruction = (layoutTarget) => {
  if (layoutTarget === 'desktop') return '';

  return ' Respect modern phone safe areas: include a viewport meta tag with viewport-fit=cover and pad edge-aligned headers, footers, and fixed controls with env(safe-area-inset-top/right/bottom/left) so nothing is hidden by a notch or home indicator.';
};

export const buildInitialGenerationPrompt = (prompt, layoutTarget) => {
  const trimmedPrompt = prompt.trim();
  const safeAreaInstruction = getSafeAreaInstruction(layoutTarget);

  switch (layoutTarget) {
    case 'mobile':
      return `Create a native-feeling smartphone app based on this request: ${trimmedPrompt}. It must look and feel like a real native iOS/Android app running full-screen on a 375px device -- not a website viewed on a phone. Use native app UI conventions (bottom tab bar or top app bar, card-based lists, bottom sheets/modals, large thumb-friendly controls) instead of website conventions (top nav bars, hamburger menus, hero sections, footers).${safeAreaInstruction}`;
    case 'desktop':
      return `Create a desktop-focused web app based on this request: ${trimmedPrompt}. Optimize for larger screens with a true desktop layout, richer information density, and interactions suited for mouse and keyboard use.`;
    case 'both':
    default:
      return `Create a responsive app based on this request: ${trimmedPrompt}. On phone widths it must look and feel like a native iOS/Android app -- not a website viewed on a phone -- using native app UI conventions (bottom tab bar or top app bar, card-based lists, bottom sheets/modals) instead of website conventions (top nav bars, hamburger menus, hero sections, footers). On larger screens, present a true desktop layout instead of staying in a phone-width column.${safeAreaInstruction}`;
  }
};

export const buildSuggestionsPrompt = (code, versions, projectName) => {
  const half = SUGGESTIONS_CODE_CHAR_BUDGET / 2;
  const truncatedCode = code.length > SUGGESTIONS_CODE_CHAR_BUDGET
    ? `${code.slice(0, half)}\n...[truncated]...\n${code.slice(-half)}`
    : code;

  const recentHistory = versions.slice(-6).map((v, i) => {
    const extra = v.editSummary && v.editSummary !== v.prompt ? ` (${v.editSummary})` : '';
    return `${i + 1}. ${v.prompt}${extra}`;
  }).join('\n');

  return `App name: ${projectName}

Recent edit history:
${recentHistory || '(none yet)'}

Current app code:
\`\`\`html
${truncatedCode}
\`\`\`

Suggest 3-4 specific next-step prompts for this app.`;
};

export const buildSyntaxRepairPrompt = (code, errors) => `The following HTML document contains JavaScript syntax errors that will break the app:

\`\`\`html
${code}
\`\`\`

Syntax errors detected:
${errors.map((e) => `- Line ${e.line}: ${e.message}`).join('\n')}

Return the complete corrected document, starting at <!DOCTYPE html>. Fix ONLY the listed syntax errors (and anything they directly cascade into) -- keep all markup, styling, behavior, and features exactly as they are. Do not redesign or rewrite unrelated parts. Do not wrap the output in markdown formatting.`;

export const buildSyntaxRepairInstruction = (errors) => `The current app code contains JavaScript syntax errors that will break the app:

${errors.map((e) => `- Line ${e.line}: ${e.message}`).join('\n')}

Fix these with apply_surgical_edits before finishing. If a search anchor around the broken code is unclear, call view_code first. Change as little as possible -- only what is needed to make the code parse.`;

// Best-effort background enhancement -- never surfaces an error to the user.
// Any failure (missing config, network error, malformed tool response) just
// means no suggestions are shown.