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
    description: "Lists every <!-- @section: name --> landmark actually present in the current code, in document order, with each one's line range. Ground truth — call this before assuming a section exists.",
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
              title: { type: 'string', description: 'Short title for the app (2-4 words).' },
              prompt: { type: 'string', description: 'A very concise 1 sentence prompt describing the app, without fluff.' },
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

export const STARTER_IDEAS_SYSTEM_PROMPT = `You are an expert app ideator. Generate exactly 4 unique, high-quality, non-basic but well-scoped web app ideas that can be built by an AI assistant in a single file. Keep the descriptions (prompts) very concise and straight to the point, removing extraneous adjectives. Return them using the return_starter_ideas tool.`;


export const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a complete, self-contained HTML file (with inline CSS and JS) that implements the user's requested app.

CRITICAL RULES:
1. Output raw HTML code (optionally preceded by a short reply, see REPLY GUIDELINES below) or use the provided tools for edits.
2. DO NOT wrap the output in markdown formatting (e.g., no \`\`\`html or \`\`\` blocks).
3. Follow the platform-targeting instructions in the user request exactly.
4. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for styling.
5. Include modern UI elements, rounded corners, good typography, and smooth interactions.
6. Ensure any JavaScript is fully functional and self-contained within a <script> tag.
7. For mobile-focused apps, always include viewport-fit=cover meta tag and safe-area-inset padding.
8. The app runs in a sandboxed preview frame with no origin. Do NOT use localStorage, sessionStorage, indexedDB, or document.cookie - hold all state in JavaScript variables. Do NOT use alert(), confirm(), or prompt() - render inline UI instead.

SURGICAL EDIT GUIDELINES:
- Analyze the full code structure before deciding where and how to edit.
- SEARCH blocks MUST span 5-10 lines including unique surrounding context to avoid false matches.
- Use <!-- @section: name --> landmark comments as structural anchors for precise targeting. Call list_sections if you need to confirm which sections actually exist, or view_code to inspect a section or line range before editing it.
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
5. Call return_suggestions with your 4 suggestions and nothing else.`;

export const getSafeAreaInstruction = (layoutTarget) => {
  if (layoutTarget === 'desktop') return '';

  return ' Respect modern phone safe areas: include a viewport meta tag with viewport-fit=cover and pad edge-aligned headers, footers, and fixed controls with env(safe-area-inset-top/right/bottom/left) so nothing is hidden by a notch or home indicator.';
};

export const buildInitialGenerationPrompt = (prompt, layoutTarget) => {
  const trimmedPrompt = prompt.trim();
  const safeAreaInstruction = getSafeAreaInstruction(layoutTarget);

  switch (layoutTarget) {
    case 'mobile':
      return `Create a mobile-first web app based on this request: ${trimmedPrompt}. Optimize for a polished 375px touch-screen experience with compact spacing, thumb-friendly controls, and a layout that feels native on phones.${safeAreaInstruction}`;
    case 'desktop':
      return `Create a desktop-focused web app based on this request: ${trimmedPrompt}. Optimize for larger screens with a true desktop layout, richer information density, and interactions suited for mouse and keyboard use.`;
    case 'both':
    default:
      return `Create a responsive web app based on this request: ${trimmedPrompt}. It must look polished on mobile and also present a true desktop layout on larger screens instead of staying in a phone-width column.${safeAreaInstruction}`;
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

// Best-effort background enhancement -- never surfaces an error to the user.
// Any failure (missing config, network error, malformed tool response) just
// means no suggestions are shown.