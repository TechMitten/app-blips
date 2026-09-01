import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge, BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from './previewBridge';
import { supabase } from './supabase';
import AccountSettingsModal from './components/AccountSettingsModal';
import { 
  Wand2, 
  ShieldAlert,
  Smartphone, 
  Code2, 
  Play, 
  Loader2, 
  History, 
  Settings, 
  Layout, 
  Download,
  RefreshCw,
  Sparkles,
  ChevronRight,
  TerminalSquare,
  Timer,
  CloudSun,
  Receipt,
  ListChecks,
  Plus,
  Edit2,
  Clock,
  ListTodo,
  Wallet,
  Undo2,
  Redo2,
  FolderOpen,
  X,
  Copy,
  Check,
  Trash2,
  ZoomIn,
  ZoomOut,
  Monitor,
  Moon,
  Sun,
  PanelLeftOpen,
  PanelLeftClose,
  TriangleAlert,
  Eye,
  EyeOff,
  Calculator,
  KeyRound,
  Ruler,
  LogIn,
  LogOut,
  User,
  CloudUpload,
  Mail,
  ExternalLink,
  Zap,
  Layers,
  Search
} from 'lucide-react';
// --- Constants ---
const SURGICAL_EDIT_TOOL = {
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

const VIEW_CODE_TOOL = {
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

const LIST_SECTIONS_TOOL = {
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

const REFINEMENT_TOOLS = [SURGICAL_EDIT_TOOL, VIEW_CODE_TOOL, LIST_SECTIONS_TOOL];

const SUGGEST_NEXT_STEPS_TOOL = {
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

const GENERATE_STARTER_IDEAS_TOOL = {
  type: 'function',
  function: {
    name: 'return_starter_ideas',
    description: 'Returns exactly 8 new, unique starter app ideas.',
    parameters: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          description: 'Exactly 8 starter app ideas.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short title for the app (2-4 words).' },
              prompt: { type: 'string', description: 'A 1-2 sentence prompt describing the app.' },
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

const STARTER_IDEAS_SYSTEM_PROMPT = `You are an expert app ideator. Generate exactly 8 unique, high-quality, non-basic but well-scoped web app ideas that can be built by an AI assistant in a single file. Return them using the return_starter_ideas tool.`;


const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
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

const SUGGESTIONS_SYSTEM_PROMPT = `You are reviewing the current source code and edit history of a specific AI-generated web app.
Propose exactly 4 concrete, specific next-step feature ideas for THIS app, grounded in what its code actually does.

RULES:
1. Return exactly 4 suggestions -- no more, no fewer.
2. Each suggestion must be a short, imperative prompt under 8 words the user could submit as-is, e.g. "Add a dark mode toggle" or "Add sound alerts at zero".
3. Never suggest something already implemented in the code below.
4. Never suggest something generic that could apply to any app -- ground each idea in this app's actual features, UI, and data.
5. Call return_suggestions with your 4 suggestions and nothing else.`;

const getSafeAreaInstruction = (layoutTarget) => {
  if (layoutTarget === 'desktop') return '';

  return ' Respect modern phone safe areas: include a viewport meta tag with viewport-fit=cover and pad edge-aligned headers, footers, and fixed controls with env(safe-area-inset-top/right/bottom/left) so nothing is hidden by a notch or home indicator.';
};

const LLM_CONFIG_KEY = 'orion-llm-config';
const LLM_REMEMBER_KEY = 'orion-llm-remember';

const DEFAULT_LLM_CONFIG = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  reasoning: false
};

// There is no way to hide a key from the machine that types it in a
// backend-less SPA. What the sandboxed preview frame buys us is the part that
// matters: generated code can no longer read it. This toggle is the remaining
// bit of hygiene -- session-only storage for shared or untrusted machines.
const safeStorage = (kind) => {
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    void store.length;
    return store;
  } catch {
    return null;
  }
};

const THEME_KEY = 'orion-theme';
// Mirrored by the pre-paint script in index.html -- keep both in sync.
const THEME_META_COLOR = { light: '#f8fafc', dark: '#10131c' };

// 'light' | 'dark' | 'system'. Anything unrecognised (or unreadable storage)
// falls back to following the OS.
const loadThemePreference = () => {
  try {
    const stored = safeStorage('local')?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
};

// Defaults to true: existing installs already keep their config in localStorage.
const loadRememberKey = () => {
  try {
    return safeStorage('local')?.getItem(LLM_REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
};

const configStore = (remember) => safeStorage(remember ? 'local' : 'session');

const readStoredConfig = (store) => {
  try {
    const raw = store?.getItem(LLM_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.baseUrl || parsed.apiKey || parsed.model)) {
      return {
        baseUrl: parsed.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
        apiKey: parsed.apiKey || '',
        model: parsed.model || DEFAULT_LLM_CONFIG.model,
        reasoning: parsed.reasoning === true
      };
    }
  } catch { /* ignore invalid stored config */ }
  return null;
};

const loadLlmConfig = () => {
  const remember = loadRememberKey();
  // Fall back to the other store so toggling mid-session never loses the key.
  return readStoredConfig(configStore(remember))
    || readStoredConfig(configStore(!remember))
    || { ...DEFAULT_LLM_CONFIG };
};

const saveLlmConfig = (config, remember = loadRememberKey()) => {
  try { configStore(remember)?.setItem(LLM_CONFIG_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  try { configStore(!remember)?.removeItem(LLM_CONFIG_KEY); } catch { /* ignore */ }
};

const saveRememberKey = (remember, config) => {
  try { safeStorage('local')?.setItem(LLM_REMEMBER_KEY, remember ? 'true' : 'false'); } catch { /* ignore */ }
  saveLlmConfig(config, remember);
};

// The key crosses the network in cleartext on a plain-http remote endpoint.
// Local model servers over http are fine, and are the common case.
const isInsecureEndpoint = (baseUrl) => {
  const trimmed = (baseUrl || '').trim();
  if (!/^http:\/\//i.test(trimmed)) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
};

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};
const INITIAL_LAYOUT_OPTIONS = [
  {
    id: 'mobile',
    label: 'Mobile',
    icon: Smartphone
  },
  {
    id: 'desktop',
    label: 'Desktop',
    icon: Monitor
  },
  {
    id: 'both',
    label: 'Both',
    icon: Layout
  }
];

const sanitizeHtmlResponse = (text) => {
  const htmlBlockMatch = text.match(/```html\s*([\s\S]*?)\s*```/i);
  if (htmlBlockMatch) return htmlBlockMatch[1].trim();

  const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const htmlStartMatch = text.match(/(<!DOCTYPE html[\s\S]*)/i) || text.match(/(<html[\s\S]*)/i);
  if (htmlStartMatch) {
    const content = htmlStartMatch[0];
    const endTagMatch = content.match(/<\/html>/i);
    if (endTagMatch) {
      const lastIndex = content.toLowerCase().lastIndexOf('</html>');
      return content.substring(0, lastIndex + 7).trim();
    }
    return content.replace(/\n?```$/, '').trim();
  }

  return text.replace(/^```html\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
};

// Complementary to sanitizeHtmlResponse: returns the text BEFORE the HTML boundary
// (an optional short conversational reply) instead of the HTML itself.
const extractLeadingReply = (text) => {
  const htmlBlockMatch = text.match(/```html\s*[\s\S]*?\s*```/i);
  if (htmlBlockMatch) return text.slice(0, htmlBlockMatch.index).trim();

  const codeBlockMatch = text.match(/```\s*[\s\S]*?\s*```/i);
  if (codeBlockMatch) return text.slice(0, codeBlockMatch.index).trim();

  const htmlStartMatch = text.match(/<!DOCTYPE html[\s\S]*/i) || text.match(/<html[\s\S]*/i);
  if (htmlStartMatch) return text.slice(0, htmlStartMatch.index).trim();

  return '';
};

const normalizeLine = (line) => line.trim().replace(/\s+/g, ' ');

// Every line-window in codeLines that matches searchLines under whitespace-normalized comparison.
const findFuzzyMatches = (codeLines, searchLines) => {
  const normalizedSearchLines = searchLines.map(normalizeLine);
  const matches = [];
  for (let i = 0; i <= codeLines.length - searchLines.length; i++) {
    let isMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizeLine(codeLines[i + j]) !== normalizedSearchLines[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) matches.push(i);
  }
  return matches;
};

const countExactOccurrences = (haystack, needle) => {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
};

const replaceExactOccurrence = (haystack, needle, replacement, occurrence) => {
  let idx = -1;
  let from = 0;
  for (let n = 0; n < occurrence; n++) {
    idx = haystack.indexOf(needle, from);
    from = idx + needle.length;
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
};

const applySurgicalEdits = (currentCode, edits) => {
  if (!currentCode || !edits || !Array.isArray(edits)) return { success: false, error: 'Invalid edit format' };

  let newCode = currentCode;

  for (const block of edits) {
    const { search: searchStr, replace: replaceStr, occurrence, replace_all: replaceAll } = block;
    if (!searchStr) continue;

    const exactCount = countExactOccurrences(newCode, searchStr);

    if (exactCount > 0) {
      if (replaceAll) {
        newCode = newCode.split(searchStr).join(replaceStr);
      } else if (exactCount === 1) {
        newCode = newCode.replace(searchStr, replaceStr);
      } else if (occurrence && occurrence >= 1 && occurrence <= exactCount) {
        newCode = replaceExactOccurrence(newCode, searchStr, replaceStr, occurrence);
      } else {
        return {
          success: false,
          error: `Ambiguous: search block matches ${exactCount} locations. Set "occurrence" (1-${exactCount}) or "replace_all": true.`,
          ambiguous: true,
          matchCount: exactCount
        };
      }
      continue;
    }

    // Fuzzy fallback: whitespace-normalized line-window match, same occurrence/replace_all logic.
    const codeLines = newCode.split(/\r?\n/);
    const searchLines = searchStr.split(/\r?\n/);
    const matches = findFuzzyMatches(codeLines, searchLines);

    if (matches.length === 0) {
      return {
        success: false,
        error: `Search block not found: "${searchStr.substring(0, 100)}..."`,
        failedBlock: searchStr
      };
    } else if (matches.length === 1 || replaceAll) {
      const targets = replaceAll ? matches : [matches[0]];
      // Apply from the last match backwards so earlier indices stay valid.
      let lines = codeLines;
      for (let t = targets.length - 1; t >= 0; t--) {
        const matchIndex = targets[t];
        lines = [...lines.slice(0, matchIndex), replaceStr, ...lines.slice(matchIndex + searchLines.length)];
      }
      newCode = lines.join('\n');
    } else if (occurrence && occurrence >= 1 && occurrence <= matches.length) {
      const matchIndex = matches[occurrence - 1];
      newCode = [...codeLines.slice(0, matchIndex), replaceStr, ...codeLines.slice(matchIndex + searchLines.length)].join('\n');
    } else {
      return {
        success: false,
        error: `Ambiguous: search block matches ${matches.length} locations. Set "occurrence" (1-${matches.length}) or "replace_all": true.`,
        ambiguous: true,
        matchCount: matches.length
      };
    }
  }

  return { success: true, code: newCode };
};

const SECTION_LANDMARK_RE = /<!--\s*@section:\s*([^\s][^\n]*?)\s*-->/;

const listSections = (code) => {
  const lines = code.split(/\r?\n/);
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(SECTION_LANDMARK_RE);
    if (m) marks.push({ name: m[1].trim(), line: i + 1 });
  });
  return marks.map((m, i) => ({
    name: m.name,
    startLine: m.line,
    endLine: i + 1 < marks.length ? marks[i + 1].line - 1 : lines.length
  }));
};

const VIEW_CODE_MAX_LINES = 400;

const viewCode = (code, { section, start_line: startLine, end_line: endLine } = {}) => {
  const lines = code.split(/\r?\n/);
  let from, to;

  if (section) {
    const found = listSections(code).find((s) => s.name === section);
    if (!found) return { success: false, error: `No @section named "${section}" found. Call list_sections to see actual names.` };
    from = found.startLine;
    to = found.endLine;
  } else {
    from = Math.max(1, startLine || 1);
    to = Math.min(lines.length, endLine || from + 199);
  }

  if (to - from > VIEW_CODE_MAX_LINES) to = from + VIEW_CODE_MAX_LINES;

  const slice = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
  return { success: true, code: slice, startLine: from, endLine: to };
};

const buildInitialGenerationPrompt = (prompt, layoutTarget) => {
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

// --- API Helper with Exponential Backoff ---
const requestModelText = async ({
  messages,
  onChunk = null,
  tools = null,
  tool_choice = null,
  retryCount = 0,
  signal = null
}) => {
  const delays = [1000, 2000, 4000, 8000, 16000];

  const config = loadLlmConfig();
  const baseUrl = toChatCompletionsUrl(config.baseUrl);
  const apiKey = config.apiKey;
  const model = config.model;

  if (!baseUrl) throw new Error('Configure an API endpoint in Settings.');
  if (!apiKey) throw new Error('Configure an API key in Settings.');
  if (!model) throw new Error('Configure a model in Settings.');

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const bodyObj = {
      model,
      stream: !!onChunk,
      messages
    };

    bodyObj.temperature = 0.2;
    if (config.reasoning === false) bodyObj.reasoning_effort = 'none';
    if (tools) bodyObj.tools = tools;
    if (tool_choice) bodyObj.tool_choice = tool_choice;

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      signal
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message;
    }

    // Streaming implementation
    const STREAM_READ_TIMEOUT_MS = 180000;

    let text = '';
    let toolCallsBuffer = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readWithTimeout = async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stream stalled: no data received for ' + (STREAM_READ_TIMEOUT_MS / 1000) + 's')), STREAM_READ_TIMEOUT_MS)
      );
      return await Promise.race([readPromise, timeoutPromise]);
    };

    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta;
            
            if (delta?.content) {
              text += delta.content;
              onChunk(delta.content, 'content');
            }

            if (delta?.reasoning_content) {
              // Thinking tokens never become code. Reported only so the UI can
              // flip to a "thinking" indicator instead of looking frozen during
              // long reasoning -- the token text itself is discarded.
              onChunk(delta.reasoning_content, 'reasoning');
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? toolCallsBuffer.length;
                if (!toolCallsBuffer[idx]) toolCallsBuffer[idx] = { id: tc.id, type: 'function', function: { name: tc.function?.name, arguments: '' } };
                if (tc.function?.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    return { content: text, tool_calls: toolCallsBuffer.filter(Boolean) };
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (retryCount < delays.length && err.name !== 'AbortError') {
      await new Promise(r => setTimeout(r, delays[retryCount]));
      return requestModelText({
        messages, onChunk, tools, tool_choice, retryCount: retryCount + 1, signal
      });
    }
    throw new Error(err.message || 'Failed to generate app.');
  }
};

const MAX_REFINEMENT_TURNS = 8;

const describeToolCall = (toolCall) => {
  const name = toolCall.function?.name;
  let args = {};
  try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* ignore, use defaults below */ }

  if (name === 'list_sections') return 'Listing sections...';
  if (name === 'view_code') {
    return args.section ? `Inspecting section "${args.section}"...` : `Inspecting lines ${args.start_line ?? '?'}-${args.end_line ?? '?'}...`;
  }
  if (name === 'apply_surgical_edits') {
    const count = Array.isArray(args.edits) ? args.edits.length : 1;
    return `Applying ${count} edit${count === 1 ? '' : 's'}...`;
  }
  return `Calling ${name}...`;
};

// Executes one tool call against workingCode. Returns the (possibly updated) code plus
// the JSON-able result to report back to the model as a tool message.
const executeRefinementTool = (workingCode, toolCall) => {
  const name = toolCall.function?.name;
  let args;
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    return { code: workingCode, applied: false, result: { success: false, error: `Arguments were not valid JSON: ${e.message}` } };
  }

  if (name === 'list_sections') {
    return { code: workingCode, applied: false, result: { success: true, sections: listSections(workingCode) } };
  }
  if (name === 'view_code') {
    return { code: workingCode, applied: false, result: viewCode(workingCode, args) };
  }
  if (name === 'apply_surgical_edits') {
    const result = applySurgicalEdits(workingCode, args.edits);
    return { code: result.success ? result.code : workingCode, applied: result.success, result };
  }
  return { code: workingCode, applied: false, result: { success: false, error: `Unknown tool: ${name}` } };
};

const generateAppCode = async (
  prompt,
  currentCode = null,
  onChunk = null,
  layoutTarget = 'both',
  signal = null
) => {
  if (!currentCode) {
    const messages = [
      { role: 'system', content: HTML_SYSTEM_PROMPT },
      { role: 'user', content: buildInitialGenerationPrompt(prompt, layoutTarget) }
    ];
    const message = await requestModelText({ messages, onChunk, signal });
    const rawText = message.content || message;
    return {
      code: sanitizeHtmlResponse(rawText),
      editMode: 'full-generation',
      editSummary: 'Initial app generation.',
      reply: extractLeadingReply(rawText) || undefined
    };
  }

  // REFINEMENT MODE: multi-turn agentic tool-use loop. The model can inspect the code
  // (view_code / list_sections) and apply edits (apply_surgical_edits) across several
  // turns in one conversation, self-correcting from real tool-result errors instead of
  // blindly restarting from scratch each attempt.
  const messages = [
    { role: 'system', content: HTML_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current App Code:\n\`\`\`html\n${currentCode}\n\`\`\`\n\nTask: ${prompt}. Use apply_surgical_edits to update the app. If you're unsure a search string is unique, call list_sections or view_code first, or set occurrence/replace_all explicitly.`
    }
  ];

  let workingCode = currentCode;
  let editsApplied = false;
  let nudged = false;
  let replyParts = [];

  for (let turn = 1; turn <= MAX_REFINEMENT_TURNS; turn++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let message;
    try {
      message = await requestModelText({
        messages,
        onChunk,
        tools: REFINEMENT_TOOLS,
        tool_choice: turn === 1 ? 'required' : 'auto',
        signal
      });
    } catch (e) {
      if (turn !== 1 || signal?.aborted) throw e;
      // Some OpenAI-compatible backends don't support tool_choice: 'required' — fall back
      // to forcing the one edit tool by name, matching the old always-forced behavior.
      message = await requestModelText({
        messages,
        onChunk,
        tools: REFINEMENT_TOOLS,
        tool_choice: { type: 'function', function: { name: 'apply_surgical_edits' } },
        signal
      });
    }

    if (message.content && message.content.trim()) {
      replyParts.push(message.content.trim());
    }

    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls?.length ? message.tool_calls : undefined
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (editsApplied) return { code: workingCode, editMode: 'surgical', editSummary: prompt, reply: replyParts.join(' ').trim() || undefined };
      if (nudged) throw new Error('Model did not use any tool to make the requested edit.');
      nudged = true;
      messages.push({ role: 'user', content: 'You must call a tool (apply_surgical_edits, view_code, or list_sections) to make progress on the task.' });
      continue;
    }

    for (const toolCall of message.tool_calls) {
      if (onChunk) onChunk(describeToolCall(toolCall), 'status');
      const { code: nextCode, applied, result } = executeRefinementTool(workingCode, toolCall);
      workingCode = nextCode;
      if (applied) editsApplied = true;
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }
  }

  if (editsApplied) return { code: workingCode, editMode: 'surgical', editSummary: prompt, reply: replyParts.join(' ').trim() || undefined };
  throw new Error(`Failed to apply updates after ${MAX_REFINEMENT_TURNS} turns.`);
};

const SUGGESTIONS_CODE_CHAR_BUDGET = 12000;

const buildSuggestionsPrompt = (code, versions, projectName) => {
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
const generateContextualSuggestions = async ({ code, versions, projectName, signal }) => {
  try {
    const messages = [
      { role: 'system', content: SUGGESTIONS_SYSTEM_PROMPT },
      { role: 'user', content: buildSuggestionsPrompt(code, versions, projectName) }
    ];

    const message = await requestModelText({
      messages,
      tools: [SUGGEST_NEXT_STEPS_TOOL],
      tool_choice: { type: 'function', function: { name: 'return_suggestions' } },
      signal
    });

    const toolCall = message.tool_calls?.[0];
    if (!toolCall) return [];

    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return [];
    }

    if (!Array.isArray(args.suggestions)) return [];

    return args.suggestions
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 4);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[Orion] Failed to generate contextual suggestions:', err);
    return [];
  }
};

const generateNewStarterIdeas = async ({ signal }) => {
  const messages = [
    { role: 'system', content: STARTER_IDEAS_SYSTEM_PROMPT },
    { role: 'user', content: "Generate 8 new starter app ideas." }
  ];

  const message = await requestModelText({
    messages,
    tools: [GENERATE_STARTER_IDEAS_TOOL],
    tool_choice: { type: 'function', function: { name: 'return_starter_ideas' } },
    signal
  });

  const toolCall = message.tool_calls?.[0];
  if (!toolCall) return null;

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }

  if (!Array.isArray(args.ideas)) return null;
  return args.ideas;
};

const syntaxHighlightHtml = (code) => {
  if (!code) return "";

  const escape = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  let escaped = escape(code);

  // 1. Comments
  escaped = escaped.replace(/&lt;!--([\s\S]*?)--&gt;/g, '<span class="token-comment">&lt;!--$1--&gt;</span>');
  // 2. Doctype
  escaped = escaped.replace(/(&lt;!DOCTYPE[\s\S]*?&gt;)/gi, '<span class="token-doctype">$1</span>');
  // 3. Tags and Attributes
  escaped = escaped.replace(/(&lt;\/?)([\w-:]+)([\s\S]*?)(&gt;)/g, (match, prefix, tagName, attrs, suffix) => {
    const highlightedTag = `${prefix}<span class="token-tag-name">${tagName}</span>`;
    const highlightedAttrs = attrs.replace(/\s+([\w-:]+)(?:=(&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;|[\w:-]+))?/g, (m, attrName, attrValue) => {
      let res = ` <span class="token-attr-name">${attrName}</span>`;
      if (attrValue) res += `=<span class="token-string">${attrValue}</span>`;
      return res;
    });
    return highlightedTag + highlightedAttrs + suffix;
  });

  // Split into lines for numbering
  const lines = escaped.split('\n');
  const numberedLines = lines.map((line, i) => {
    return `<div class="code-line"><span class="line-number">${i + 1}</span><span class="line-content">${line || ' '}</span></div>`;
  }).join('');

  return numberedLines;
};

// Some backends emit chain-of-thought/preamble text through the regular content
// delta instead of (or in addition to) reasoning_content. Until this pattern shows
// up in the accumulated stream, sanitizeHtmlResponse has no real boundary to anchor
// on and falls back to returning the raw text -- which would flash that preamble
// into the live code panel. Gate the panel update on this instead.
const HTML_STREAM_START_RE = /```html|<!DOCTYPE html|<html[\s>]/i;

const PRESET_COLORS = [
  "text-amber-600 bg-amber-50",
  "text-sky-600 bg-sky-50",
  "text-emerald-600 bg-emerald-50",
  "text-indigo-600 bg-indigo-50",
  "text-violet-600 bg-violet-50",
  "text-rose-600 bg-rose-50",
  "text-blue-600 bg-blue-50",
  "text-teal-600 bg-teal-50"
];

const AVAILABLE_ICONS = {
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor
};

const STARTER_PRESETS = [
  {
    title: "Study Session Manager",
    prompt: "A focus timer with customizable work/break intervals, task tagging, and a visual session history.",
    category: "Productivity",
    icon: Timer,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Travel Dashboard",
    prompt: "A travel dashboard showing local weather forecasts, a packing checklist, and an interactive itinerary timeline.",
    category: "Travel",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Group Bill Splitter",
    prompt: "A dynamic bill splitter that lets you add friends, assign items to people, and calculates tax and tip automatically.",
    category: "Finance",
    icon: Receipt,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Mood & Habit Journal",
    prompt: "A daily journal combining a mood selector with quick toggles for habits, displaying a weekly overview chart.",
    category: "Wellness",
    icon: ListChecks,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Kanban Board",
    prompt: "A Kanban-style task board with columns for 'To Do', 'In Progress', and 'Done', featuring interactive cards.",
    category: "Project",
    icon: Layout,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Subscription Manager",
    prompt: "A recurring subscription tracker that estimates monthly costs, sorts by billing date, and categorizes spending.",
    category: "Finance",
    icon: Wallet,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Secure Vault UI",
    prompt: "A secure vault interface with a mock login screen, advanced password generator, and categorized credential cards.",
    category: "Security",
    icon: KeyRound,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Markdown Editor",
    prompt: "A dual-pane markdown editor with a live preview, word count, and a distraction-free reading mode.",
    category: "Utility",
    icon: Edit2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Recipe Scaler",
    prompt: "A recipe ingredient scaler that instantly adjusts measurements and units when you change the desired serving size.",
    category: "Tools",
    icon: Calculator,
    color: "text-teal-600 bg-teal-50"
  }
];

const DEFAULT_MARQUEE_MESSAGE = 'Initializing generation... Preparing code workspace... Analyzing requirements... Writing components...';
const MARQUEE_SEPARATOR = '  //  ';
const MARQUEE_MIN_LOOP_LENGTH = 220;
const MARQUEE_MAX_BUFFER_LENGTH = 4000;
const PREVIEW_MODES = {
  mobile: {
    label: 'Mobile',
    width: 399,
    height: 820
  },
  desktop: {
    label: 'Desktop',
    width: 1468,
    height: 1022
  }
};

const buildMarqueeLoop = (value) => {
  const normalized = (value || DEFAULT_MARQUEE_MESSAGE).replace(/\s+/g, ' ').trim();
  let loop = normalized;

  while (loop.length < MARQUEE_MIN_LOOP_LENGTH) {
    loop += `${MARQUEE_SEPARATOR}${normalized}`;
  }

  return loop;
};

// Handles both the legacy Firebase-style Date object and plain ISO strings that
// come back from Supabase's `updated_at`.
const formatModifiedTime = (value) => {
  if (!value) return 'Just now';
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? 'Just now' : d.toLocaleString();
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return isNaN(d.getTime()) ? 'Just now' : d.toLocaleString();
  }
  return 'Just now';
};

const isValidUuid = (value) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value || '');

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [initialLayoutTarget, setInitialLayoutTarget] = useState('both');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [contextualSuggestions, setContextualSuggestions] = useState([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [previewMode, setPreviewMode] = useState('mobile');
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(loadRememberKey);
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
  const resolvedTheme =
    themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;
  const [starterIdeas, setStarterIdeas] = useState(STARTER_PRESETS.slice(0, 8));
  const [isGeneratingStarters, setIsGeneratingStarters] = useState(false);

  const handleGenerateStarters = async () => {
    if (isGeneratingStarters) return;
    setIsGeneratingStarters(true);
    setError(null);
    try {
      const ideas = await generateNewStarterIdeas({ signal: null });
      if (ideas && ideas.length > 0) {
        const mappedIdeas = ideas.map(idea => {
          const IconComponent = AVAILABLE_ICONS[idea.iconName] || AVAILABLE_ICONS.Sparkles || Code2;
          const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
          return {
            ...idea,
            icon: IconComponent,
            color: randomColor
          };
        });
        setStarterIdeas(mappedIdeas);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err.message || 'Failed to generate starter ideas.');
      }
    } finally {
      setIsGeneratingStarters(false);
    }
  };
  const handleLlmConfigChange = useCallback((field, value) => {
    setLlmConfig((prev) => {
      const next = { ...prev, [field]: value };
      saveLlmConfig(next, rememberKey);
      return next;
    });
  }, [rememberKey]);
  const handleRememberKeyChange = useCallback((next) => {
    setRememberKey(next);
    saveRememberKey(next, llmConfig);
  }, [llmConfig]);
  const [streamingCode, setStreamingCode] = useState('');
  const [streamingGeneratedCode, setStreamingGeneratedCode] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [shouldGenerateAfterNaming, setShouldGenerateAfterNaming] = useState(false);
  const [projectName, setProjectName] = useState('Untitled App');
  const [myProjects, setMyProjects] = useState([]);
  const [isProjectsListOpen, setIsProjectsListOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deletingProjectId, setDeletingProjectId] = useState(null);
  const [isNewChatConfirmOpen, setIsNewChatConfirmOpen] = useState(false);
  const marqueeSegment = buildMarqueeLoop(streamingCode);
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [expandedVersionIndex, setExpandedVersionIndex] = useState(null);
  const [isAutoZoom, setIsAutoZoom] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('orion-history-open');
    return stored !== null ? stored === 'true' : true;
  });

  // --- Auth state (Supabase) ---
  const [session, setSession] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'signedOut' | 'signedIn'
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authInfo, setAuthInfo] = useState(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLocalCount, setImportLocalCount] = useState(0);
  const isSignedIn = authStatus === 'signedIn';
  const user = session?.user ?? null;
  const previousAuthStatusRef = useRef(null);
  const previewContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const streamingReplyRef = useRef('');
  const replyFrozenRef = useRef(false);
  const abortControllerRef = useRef(null);
  const suggestionsAbortControllerRef = useRef(null);
  const codePanelCode = isGenerating ? (streamingGeneratedCode || generatedCode) : generatedCode;
  // The preview bridge is spliced in at RENDER time only, so `generatedCode`
  // itself stays pristine: downloads, the code pane, the clipboard,
  // `orion-projects` and -- critically -- applySurgicalEdits never see it.
  const { srcDoc: previewSrcDoc, token: previewToken } = useMemo(
    () => (generatedCode ? injectPreviewBridge(generatedCode) : { srcDoc: '', token: '' }),
    [generatedCode]
  );
  const activePreviewPreset = PREVIEW_MODES[previewMode];
  const scaledPreviewWidth = activePreviewPreset.width * zoomLevel;
  const scaledPreviewHeight = activePreviewPreset.height * zoomLevel;

  useEffect(() => {
    localStorage.setItem('orion-history-open', isHistoryOpen);
  }, [isHistoryOpen]);

  // Stay subscribed even while an explicit light/dark preference is active, so
  // switching back to System applies the current OS setting immediately rather
  // than one render late.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const handleChange = (event) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_META_COLOR[resolvedTheme]);
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      safeStorage('local')?.setItem(THEME_KEY, themePreference);
    } catch {
      /* storage blocked -- the preference just will not persist */
    }
  }, [themePreference]);

  // --- Auth bootstrap: restore the session then keep it in sync ---
  useEffect(() => {
    let active = true;
    let unsubscribe = null;

    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!active) return;
        setSession(initialSession);
        setAuthStatus(initialSession ? 'signedIn' : 'signedOut');
      })
      .catch((err) => {
        console.error('[Orion] Failed to restore Supabase session:', err);
        if (active) {
          setSession(null);
          setAuthStatus('signedOut');
        }
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthStatus(nextSession ? 'signedIn' : 'signedOut');
    });

    unsubscribe = () => subscription.unsubscribe();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const clearStreamingState = () => {
    setStreamingCode('');
    setStreamingGeneratedCode('');
    setStreamingReply('');
    streamingBufferRef.current = '';
    streamingGeneratedCodeRef.current = '';
    streamingReplyRef.current = '';
    replyFrozenRef.current = false;
  };

  // --- Dynamic Zoom Logic ---
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const calculateZoom = () => {
      if (!isAutoZoom || !previewContainerRef.current || activeTab !== 'preview') return;
      
      const el = previewContainerRef.current;
      const horizontalPadding = previewMode === 'mobile' ? 32 : 72;
      const verticalPadding = previewMode === 'mobile' ? 32 : 54;
      const availableWidth = Math.max(100, el.clientWidth - horizontalPadding);
      const availableHeight = Math.max(100, el.clientHeight - verticalPadding);
      const preset = PREVIEW_MODES[previewMode];
      const baseHeight = preset.height;
      const baseWidth = preset.width;
      
      const scaleH = availableHeight / baseHeight;
      const scaleW = availableWidth / baseWidth;
      
      const newZoom = Math.min(scaleH, scaleW);
      // Fluid zoom ranging from 0.25x up to 2.5x to fill large 1440p / 4K / UHD screens
      const clampedZoom = Math.max(0.25, Math.min(newZoom, 2.5));
      setZoomLevel(Number(clampedZoom.toFixed(3)));
    };

    calculateZoom();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        calculateZoom();
      });
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', calculateZoom);
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', calculateZoom);
    };
  }, [isAutoZoom, activeTab, previewMode, isHistoryOpen]);

  // --- Preview bridge ---
  // The preview iframe is origin-isolated (no `allow-same-origin`), so the parent
  // can no longer touch its document. The mobile touch-scroll simulation now runs
  // inside the frame (src/previewBridge.js); this effect just drives it.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewSrcDoc) return;

    const send = (type, payload) => {
      try {
        // targetOrigin '*' is required -- the frame's origin is opaque, so it
        // cannot know ours and we cannot address it by origin. Acceptable only
        // because no message in this protocol carries a secret. Do not add one.
        iframe.contentWindow?.postMessage(
          { __orion: BRIDGE_CHANNEL, v: BRIDGE_PROTOCOL_VERSION, token: previewToken, type, payload },
          '*'
        );
      } catch { /* frame torn down mid-send */ }
    };

    const push = () => send('configure', { enabled: previewMode === 'mobile' });

    const onMessage = (event) => {
      // The frame's opaque origin makes event.origin the string "null", which is
      // worthless for authorization -- any sandboxed frame produces it.
      // WindowProxy identity is the actual boundary.
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      // The token only disambiguates a stale document from the current one. It is
      // NOT a secret: the generated app can read it out of its own DOM.
      if (!data || data.__orion !== BRIDGE_CHANNEL || data.token !== previewToken) return;
      if (data.type === 'ready') push();
      else if (data.type === 'error') console.warn('[preview bridge]', data.payload?.message);
    };

    window.addEventListener('message', onMessage);
    // Three-way handshake: answer `ready`, re-push on load, and push once eagerly
    // for an already-loaded frame. Any one is sufficient; together they close the
    // race from both directions.
    iframe.addEventListener('load', push);
    push();

    return () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', push);
      // Toggling previewMode does NOT reload the frame -- React reconciles the
      // iframe in place -- so this message is what actually tears down the
      // listeners, injected styles and cursor inside it.
      send('configure', { enabled: false });
    };
  }, [previewSrcDoc, previewToken, previewMode]);

  const handleManualZoom = (multiplier) => {
    setIsAutoZoom(false);
    setZoomLevel(prev => {
      const next = prev + multiplier;
      return Math.max(0.2, Math.min(next, 3));
    });
  };

  const resetZoom = () => {
    setIsAutoZoom(true);
  };

  // --- Data Persistence Helpers ---
  const readProjectRows = () => {
    try {
      return JSON.parse(localStorage.getItem('orion-projects') || '[]');
    } catch {
      return [];
    }
  };

  const writeProjectRows = (rows) => {
    localStorage.setItem('orion-projects', JSON.stringify(rows));
  };

  const localRowsToProjects = (rows) => rows
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(row => ({
      id: row.id,
      name: row.name,
      ...row.data,
      lastModified: row.updatedAt
    }));

  const cloudRowsToProjects = (rows) => (rows || []).map(row => ({
    id: row.id,
    name: row.name,
    versions: row.data?.versions || [],
    currentVersionIndex: row.data?.currentVersionIndex ?? -1,
    lastModified: row.updated_at
  }));

  const fetchCloudProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return cloudRowsToProjects(data);
  }, []);

  const loadUserProjects = useCallback(async () => {
    try {
      let projects;
      if (isSignedIn) {
        projects = await fetchCloudProjects();
      } else {
        projects = localRowsToProjects(readProjectRows());
      }
      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      // Fall back to the local list so a transient cloud failure doesn't blank the UI.
      const projects = localRowsToProjects(readProjectRows());
      setMyProjects(projects);
      return projects;
    }
  }, [isSignedIn, fetchCloudProjects]);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      let row;
      if (isSignedIn) {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          localStorage.removeItem('orion-current-project-id');
          return;
        }
        row = { id: data.id, name: data.name, data: data.data };
      } else {
        row = readProjectRows().find(r => r.id === projectId);
        if (!row) {
          localStorage.removeItem('orion-current-project-id');
          return;
        }
      }

      clearStreamingState();
      setProjectName(row.name || 'Untitled App');
      const projectData = row.data || {};
      setVersions(projectData.versions || []);
      setCurrentVersionIndex(projectData.currentVersionIndex ?? -1);
      if (projectData.versions && projectData.versions[projectData.currentVersionIndex]) {
        setGeneratedCode(projectData.versions[projectData.currentVersionIndex].code);
      }
      setCurrentProjectId(projectId);
      localStorage.setItem('orion-current-project-id', projectId);
    } catch (err) {
      console.error("Error loading project by ID:", err);
    }
  }, [isSignedIn]);

  const saveProject = useCallback(async (params = {}) => {
    const {
      versionsToSave = versions,
      indexToSave = currentVersionIndex,
      nameToSave = projectName,
      idToSave = currentProjectId
    } = params;

    if (!versionsToSave.length && !params.force) return;

    let projectId = idToSave || currentProjectId || (isSignedIn ? crypto.randomUUID() : Date.now().toString());

    try {
      const projectData = {
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
      };

      if (isSignedIn) {
        // Local ids (Date.now() strings) can't live in a uuid column. If a guest
        // project is being edited after sign-in, re-key it once on upload.
        let cloudId = projectId;
        if (!isValidUuid(cloudId)) {
          cloudId = crypto.randomUUID();
          projectId = cloudId;
        }

        const { error } = await supabase.from('projects').upsert({
          id: cloudId,
          user_id: user.id,
          name: nameToSave,
          data: projectData,
          updated_at: new Date().toISOString()
        });
        if (error) throw error;
      } else {
        const rows = readProjectRows();
        const existingIndex = rows.findIndex(r => r.id === projectId);
        const row = {
          id: projectId,
          name: nameToSave,
          data: projectData,
          updatedAt: new Date().toISOString()
        };

        if (existingIndex >= 0) {
          rows[existingIndex] = row;
        } else {
          rows.push(row);
        }
        writeProjectRows(rows);
      }

      if (!currentProjectId || currentProjectId !== projectId) {
        setCurrentProjectId(projectId);
        localStorage.setItem('orion-current-project-id', projectId);
      }
      loadUserProjects();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, isSignedIn, user?.id, loadUserProjects]);

  // --- Auto-save Name Changes ---
  useEffect(() => {
    if (!currentProjectId) return;
    
    const timeoutId = setTimeout(() => {
      // Only save if name actually changed from what we have in the list
      const currentProjData = myProjects.find(p => p.id === currentProjectId);
      if (currentProjData && currentProjData.name === projectName) return;
      
      saveProject({ nameToSave: projectName });
    }, 2000);
    
    return () => clearTimeout(timeoutId);
  }, [projectName, currentProjectId, myProjects, saveProject]);

  // --- Data Persistence (resume last project) ---
  // Waits for auth to settle, then reloads the correct project store. Runs on
  // mount and again whenever the signed-in state actually flips (e.g. user signs
  // in/out), so the list always reflects the active store. Respects any
  // currently-open project by only auto-resuming when nothing is open.
  useEffect(() => {
    if (authStatus === 'loading') return;

    const previous = previousAuthStatusRef.current;
    previousAuthStatusRef.current = authStatus;

    const fetchAndResume = async () => {
      const projects = await loadUserProjects();

      if (previous === 'signedIn' && authStatus === 'signedOut') {
        // Just signed out: swap in the local list but keep whatever is open.
        return;
      }

      if (!currentProjectId) {
        const lastProjectId = localStorage.getItem('orion-current-project-id');
        const idToLoad = (lastProjectId && projects.some((p) => p.id === lastProjectId))
          ? lastProjectId
          : (projects.length > 0 ? projects[0].id : null);
        if (idToLoad) await loadProjectById(idToLoad);
      }
    };

    fetchAndResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Close the auth modal the moment a session lands; offer a one-time local
  // project import right after signing in.
  useEffect(() => {
    if (authStatus === 'signedIn') {
      setIsAuthModalOpen(false);
      maybeOfferImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // --- Contextual suggestions: refresh whenever the active version's code changes.
  // Covers generation, refinement, undo/redo, and project load/switch from one place,
  // since they all ultimately set `generatedCode`.
  useEffect(() => {
    if (!generatedCode) {
      setContextualSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    suggestionsAbortControllerRef.current = controller;

    // Debounced so a burst of rapid undo/redo clicks only fires one request --
    // the cleanup below cancels the pending timer/fetch on every re-run.
    const debounceId = setTimeout(() => {
      setIsSuggestionsLoading(true);
      generateContextualSuggestions({
        code: generatedCode,
        versions,
        projectName,
        signal: controller.signal
      })
        .then((result) => {
          if (!controller.signal.aborted) setContextualSuggestions(result);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setIsSuggestionsLoading(false);
        });
    }, 500);

    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
    // versions always updates alongside generatedCode at every mutation site (handleGenerate,
    // loadProjectById, loadProject, switchVersion), so the closure is never stale. projectName
    // is intentionally excluded so renaming mid-typing doesn't retrigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedCode]);

  // Manual re-roll of the contextual suggestions (also called by the auto-refresh effect above).
  const handleRefreshSuggestions = () => {
    if (!generatedCode || isGenerating) return;
    suggestionsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortControllerRef.current = controller;
    setIsSuggestionsLoading(true);
    generateContextualSuggestions({
      code: generatedCode,
      versions,
      projectName,
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setContextualSuggestions(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setIsSuggestionsLoading(false);
      });
  };

  const loadProject = (project) => {
    clearStreamingState();
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    setVersions(project.versions);
    setCurrentVersionIndex(project.currentVersionIndex);
    if (project.versions && project.versions[project.currentVersionIndex]) {
      setGeneratedCode(project.versions[project.currentVersionIndex].code);
    }
    setIsProjectsListOpen(false);
    localStorage.setItem('orion-current-project-id', project.id);
  };


  const handleSaveSettings = () => {
    saveLlmConfig(llmConfig, rememberKey);
    setIsSettingsOpen(false);
  };

  // --- Auth (Supabase) handlers ---
  const openAuthModal = (mode = 'signin') => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthInfo(null);
    setAuthPassword('');
    setIsAuthModalOpen(true);
  };

  const handleAuthModeSwitch = (mode) => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthInfo(null);
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthError('Enter your email and password.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password: authPassword });
        if (error) throw error;
        if (!data?.session) {
          // Email confirmation required. Stay on the modal with instructions; the
          // session will land once they confirm and sign in.
          setAuthInfo('We sent a confirmation link to your email. Confirm your account, then sign in.');
        }
        // If a session was returned (confirmation disabled), onAuthStateChange
        // closes the modal.
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
        if (error) throw error;
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      setAuthError(err?.message || 'Authentication failed.');
      setAuthInfo(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  // --- One-time local → cloud project import (offered after first sign-in) ---
  const importFlagKey = (userId) => `orion-imported-${userId}`;

  const maybeOfferImport = useCallback(() => {
    if (!user?.id) return;
    try {
      if (localStorage.getItem(importFlagKey(user.id))) return;
    } catch { /* storage unavailable */ }
    const localRows = readProjectRows();
    if (!localRows.length) return;
    setImportLocalCount(localRows.length);
    setIsImportModalOpen(true);
  }, [user?.id]);

  const handleImportProjects = async () => {
    if (!user?.id) return;
    setAuthLoading(true);
    try {
      const localRows = readProjectRows();
      const rows = localRows.map((r) => ({
        id: crypto.randomUUID(),
        user_id: user.id,
        name: r.name || 'Untitled App',
        data: r.data || { versions: [], currentVersionIndex: -1 },
        updated_at: r.updatedAt || new Date().toISOString()
      }));
      if (rows.length) {
        const { error } = await supabase.from('projects').insert(rows);
        if (error) throw error;
      }
      localStorage.setItem(importFlagKey(user.id), '1');
      setIsImportModalOpen(false);
      setImportLocalCount(0);
      await loadUserProjects();
    } catch (err) {
      console.error('Error importing projects:', err);
      setAuthError('Could not import your projects. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSkipImport = () => {
    if (user?.id) {
      try { localStorage.setItem(importFlagKey(user.id), '1'); } catch { /* ignore */ }
    }
    setIsImportModalOpen(false);
    setImportLocalCount(0);
  };

  const handleGenerate = async (e) => {
    e?.preventDefault();
    if (!prompt.trim()) return;

    // Require naming for transition from Untitled or New App
    if ((projectName === 'Untitled App' || !projectName.trim()) && !currentProjectId) {
      setTempProjectName('');
      setShouldGenerateAfterNaming(true);
      setIsNamingModalOpen(true);
      return;
    }

    setIsGenerating(true);
    clearStreamingState();
    setError(null);
    abortControllerRef.current = new AbortController();
    
    const currentPrompt = prompt;
    setPrompt(''); // Clear input so user can easily type their next refinement
    setPendingPrompt(currentPrompt);

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, (chunk, kind = 'content') => {
        if (kind === 'reasoning') {
          return;
        }
        if (kind === 'status') {
          streamingBufferRef.current = '';
          setStreamingCode(chunk);
          return;
        }
        streamingBufferRef.current = `${streamingBufferRef.current}${chunk.replace(/\s+/g, ' ')}`.slice(-MARQUEE_MAX_BUFFER_LENGTH);
        setStreamingCode(streamingBufferRef.current.trim());
        streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
        if (HTML_STREAM_START_RE.test(streamingGeneratedCodeRef.current)) {
          setStreamingGeneratedCode(sanitizeHtmlResponse(streamingGeneratedCodeRef.current));
        }
        if (!replyFrozenRef.current) {
          const boundaryMatch = streamingGeneratedCodeRef.current.match(HTML_STREAM_START_RE);
          if (boundaryMatch) {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.slice(0, boundaryMatch.index).trim();
            replyFrozenRef.current = true;
          } else {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.trim();
          }
          setStreamingReply(streamingReplyRef.current);
        }
      }, initialLayoutTarget, abortControllerRef.current.signal);
      setGeneratedCode(generationResult.code);
      
      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        code: generationResult.code,
        timestamp: new Date().toLocaleTimeString(),
        editMode: generationResult.editMode,
        editSummary: generationResult.editSummary,
        reply: generationResult.reply || null
      };
      
      // If user goes back in time and generates, truncate the future versions (standard undo behavior)
      const updatedVersions = versions.slice(0, currentVersionIndex + 1);
      const finalVersions = [...updatedVersions, newVersion];
      setVersions(finalVersions);
      setCurrentVersionIndex(updatedVersions.length);
      
      // Auto-save
      saveProject({
        versionsToSave: finalVersions,
        indexToSave: updatedVersions.length
      });
      
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
      setPrompt(currentPrompt); // Restore prompt text on error
    } finally {
      setIsGenerating(false);
      setPendingPrompt('');
      clearStreamingState();
    }
  };

  handleGenerateRef.current = handleGenerate;

  const handleDownload = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miniapp-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleNewApp = () => {
    if (generatedCode || versions.length > 0 || isGenerating) {
      setIsNewChatConfirmOpen(true);
    } else {
      resetCurrentWorkspace();
    }
  };

  const handleConfirmNewChat = () => {
    resetCurrentWorkspace();
    setIsNewChatConfirmOpen(false);
  };

  const handleConfirmNaming = (e) => {
    e?.preventDefault();
    const trimmedName = tempProjectName.trim();
    if (!trimmedName) return;

    // If we are confirming a name for a new project triggered by a prompt,
    // or if we explicitly clicked "New App", clear the workspace.
    if (!shouldGenerateAfterNaming || (!currentProjectId && projectName === 'Untitled App')) {
      setGeneratedCode('');
      setPrompt(shouldGenerateAfterNaming ? prompt : ''); // Keep prompt if we're about to generate
      setInitialLayoutTarget('both');
      setError(null);
      setVersions([]);
      setCurrentVersionIndex(-1);
    }

    setProjectName(trimmedName);
    setTempProjectName('');
    setCurrentProjectId(null);
    localStorage.removeItem('orion-current-project-id');
    setIsNamingModalOpen(false);
  };

  useEffect(() => {
    if (!shouldGenerateAfterNaming || isNamingModalOpen) return;

    if ((projectName === 'Untitled App' || !projectName.trim()) || !prompt.trim()) {
      setShouldGenerateAfterNaming(false);
      return;
    }

    setShouldGenerateAfterNaming(false);
    handleGenerateRef.current?.();
  }, [shouldGenerateAfterNaming, isNamingModalOpen, projectName, prompt]);

  const switchVersion = (index) => {
    if (index >= 0 && index < versions.length) {
      clearStreamingState();
      setCurrentVersionIndex(index);
      setGeneratedCode(versions[index].code);
      if (currentProjectId) {
        saveProject({ indexToSave: index });
      }
    }
  };

  const handleUndo = () => {
    if (currentVersionIndex > 0) {
      switchVersion(currentVersionIndex - 1);
    }
  };

  const handleRedo = () => {
    if (currentVersionIndex < versions.length - 1) {
      switchVersion(currentVersionIndex + 1);
    }
  };

  const handleCopyCode = async () => {
    if (!codePanelCode) return;
    try {
      await navigator.clipboard.writeText(codePanelCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const copyVersionCode = async (ver) => {
    if (!ver || !ver.code) return;
    try {
      await navigator.clipboard.writeText(ver.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy version code:', err);
    }
  };

  const downloadVersion = (ver) => {
    if (!ver || !ver.code) return;
    const blob = new Blob([ver.code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miniapp-v${ver.id || Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleExpandVersion = (idx) => {
    setExpandedVersionIndex(prev => prev === idx ? null : idx);
  };

  const resetCurrentWorkspace = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    clearStreamingState();
    setGeneratedCode('');
    setPrompt('');
    setInitialLayoutTarget('both');
    setError(null);
    setVersions([]);
    setCurrentVersionIndex(-1);
    setCurrentProjectId(null);
    setTempProjectName('');
    setShouldGenerateAfterNaming(false);
    setIsNamingModalOpen(false);
    setProjectName('Untitled App');
    localStorage.removeItem('orion-current-project-id');
  };

  const startProjectRename = (project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name || 'Untitled App');
    setProjectToDelete(null);
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setRenamingProjectId(null);
  };

  const handleProjectRename = async (project) => {
    const trimmedName = editingProjectName.trim();
    if (!trimmedName) return;

    if (trimmedName === (project.name || 'Untitled App')) {
      cancelProjectRename();
      return;
    }

    setRenamingProjectId(project.id);
    try {
      if (isSignedIn) {
        const { error } = await supabase
          .from('projects')
          .update({ name: trimmedName, updated_at: new Date().toISOString() })
          .eq('id', project.id);
        if (error) throw error;
      } else {
        const rows = readProjectRows();
        const idx = rows.findIndex(r => r.id === project.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], name: trimmedName, updatedAt: new Date().toISOString() };
          writeProjectRows(rows);
        }
      }

      setMyProjects(prev => prev.map((p) => (
        p.id === project.id
          ? { ...p, name: trimmedName }
          : p
      )));

      if (currentProjectId === project.id) {
        setProjectName(trimmedName);
      }

      cancelProjectRename();
      loadUserProjects();
    } catch (err) {
      console.error('Error renaming project:', err);
      setRenamingProjectId(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    const projectId = projectToDelete.id;
    setDeletingProjectId(projectId);
    try {
      if (isSignedIn) {
        const { error } = await supabase.from('projects').delete().eq('id', projectId);
        if (error) throw error;
      } else {
        writeProjectRows(readProjectRows().filter(r => r.id !== projectId));
      }

      setMyProjects(prev => prev.filter((project) => project.id !== projectId));

      if (editingProjectId === projectId) {
        cancelProjectRename();
      }

      if (currentProjectId === projectId) {
        resetCurrentWorkspace();
      }

      setProjectToDelete(null);
      setDeletingProjectId(null);
      loadUserProjects();
    } catch (err) {
      console.error('Error deleting project:', err);
      setDeletingProjectId(null);
    }
  };

  return (
    <div className="min-h-screen h-dvh overflow-hidden bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200/80 header-shadow px-4 sm:px-6 2xl:px-8 py-2.5 2xl:py-3 flex items-center justify-between sticky top-0 z-40">
        {/* Left: Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 2xl:w-9 2xl:h-9 rounded-xl brand-gradient text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20">
            <Sparkles size={17} className="text-white drop-shadow-xs" />
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base 2xl:text-lg font-bold text-slate-900 tracking-tight font-sans">Orion</h1>
            {projectName && projectName !== 'Untitled App' && (
              <div 
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 2xl:px-3 2xl:py-1 rounded-full bg-slate-100/90 border border-slate-200/70 text-xs 2xl:text-sm font-semibold text-slate-700 max-w-[200px] xl:max-w-[300px] 2xl:max-w-[400px] truncate"
                title={`Current App: ${projectName}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span className="truncate">{projectName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions and Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Primary Action: New App */}
          <button
            onClick={handleNewApp}
            className="nav-btn nav-btn-primary group"
            title="Start a new app"
          >
            <Plus size={15} strokeWidth={2.4} className="group-hover:rotate-90 transition-transform duration-200" />
            <span className="hidden sm:inline">New App</span>
            <span className="sm:hidden">New</span>
          </button>

          {/* Apps Modal Trigger */}
          <button
            onClick={() => {
              setProjectSearchQuery('');
              setIsProjectsListOpen(true);
            }}
            className="nav-btn nav-btn-secondary group"
            title="My Saved Apps"
          >
            <FolderOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
            <span className="hidden sm:inline">Apps</span>
            {myProjects.length > 0 && (
              <span className="hidden md:inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                {myProjects.length}
              </span>
            )}
          </button>

          {/* History Panel Toggle */}
          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className={`nav-btn ${isHistoryOpen ? 'nav-btn-secondary-active' : 'nav-btn-secondary'} group`}
            title={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
          >
            {isHistoryOpen ? (
              <PanelLeftClose size={15} className="text-indigo-600" />
            ) : (
              <PanelLeftOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
            )}
            <span className="hidden sm:inline">History</span>
            {versions.length > 0 && (
              <span className={`w-1.5 h-1.5 rounded-full transition-colors ${isHistoryOpen ? 'bg-indigo-600' : 'bg-slate-400 group-hover:bg-indigo-500'}`} />
            )}
          </button>

          {/* Theme Toggle -- the icon names the destination, not the current state */}
          <button
            onClick={() => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="nav-btn nav-btn-secondary nav-segmented-btn-icon group"
            title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {resolvedTheme === 'dark' ? (
              <Sun size={15} className="text-slate-500 group-hover:text-indigo-600 group-hover:rotate-45 transition-all duration-300" />
            ) : (
              <Moon size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
            )}
          </button>

          {/* Settings Modal Trigger */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="nav-btn nav-btn-secondary group"
            title="Settings (API Endpoint & Key)"
          >
            <Settings size={15} className="text-slate-500 group-hover:text-indigo-600 group-hover:rotate-45 transition-all duration-300" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {/* Auth Section */}
          {isSignedIn ? (
            <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-slate-200/80">
              <button
                onClick={() => setIsAccountSettingsOpen(true)}
                className="hidden md:inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-slate-100/90 hover:bg-slate-200/90 border border-slate-200/70 hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                title={user?.email || 'Signed in'}
              >
                <span className="h-5 w-5 rounded-full brand-gradient text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
                  {(user?.email?.[0] || '?').toUpperCase()}
                </span>
                <span className="max-w-[10rem] truncate">{user?.email}</span>
              </button>
              <button
                onClick={handleSignOut}
                className="nav-btn bg-surface hover:bg-rose-50/80 text-slate-500 hover:text-rose-600 border border-slate-200/80 hover:border-rose-200/80 text-xs group"
                title="Sign out"
              >
                <LogOut size={14} className="text-slate-400 group-hover:text-rose-500 transition-colors" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : authStatus !== 'loading' ? (
            <div className="flex items-center ml-1 pl-2 border-l border-slate-200/80">
              <button
                onClick={() => openAuthModal('signin')}
                className="nav-btn nav-btn-secondary group hover:text-indigo-600 hover:border-indigo-200"
                title="Sign in to your account"
              >
                <LogIn size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* Streaming Marquee - Only visible when generating */}
      {isGenerating && (
        <div className="marquee-container" id="marquee-container" aria-live="polite">
          <div className="marquee-track">
            <span className="marquee-segment">{marqueeSegment}</span>
            <span className="marquee-segment" aria-hidden="true">{marqueeSegment}</span>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[60] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg xl:max-w-xl 2xl:max-w-2xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-3">
                <label className="text-base font-bold text-slate-900 uppercase tracking-wider">Appearance</label>
                <p className="text-slate-900 text-sm lg:text-base leading-relaxed">
                  Choose how Orion looks on this device.
                </p>
                <div className="nav-segmented-group" role="group" aria-label="Theme">
                  {[
                    { value: 'light', label: 'Light', Icon: Sun },
                    { value: 'dark', label: 'Dark', Icon: Moon },
                    { value: 'system', label: 'System', Icon: Monitor }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={themePreference === option.value}
                      onClick={() => setThemePreference(option.value)}
                      className={`nav-segmented-btn ${themePreference === option.value ? 'nav-segmented-btn-active' : ''}`}
                    >
                      <option.Icon size={14} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-slate-500 text-xs lg:text-sm leading-snug">
                  {themePreference === 'system'
                    ? `Following your system setting \u2014 currently ${resolvedTheme}.`
                    : `Always ${themePreference}. Your system setting is ignored.`}
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-base font-bold text-slate-900 uppercase tracking-wider">API Endpoint</label>
                <p className="text-slate-900 text-sm lg:text-base leading-relaxed">
                  Connect any OpenAI-compatible API. Enter the endpoint URL, key and model — changes save automatically.
                </p>
                <div>
                  <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Base URL</span>
                  <input
                    type="text"
                    value={llmConfig.baseUrl}
                    onChange={(e) => handleLlmConfigChange('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                  {isInsecureEndpoint(llmConfig.baseUrl) && (
                    <p className="mt-2 flex items-start gap-2 text-sm lg:text-base font-semibold text-amber-700">
                      <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                      <span>This endpoint is plain http, so your API key will cross the network unencrypted. Use https for anything outside your own machine.</span>
                    </p>
                  )}
                </div>
                <div>
                  <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">API Key</span>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={llmConfig.apiKey}
                      onChange={(e) => handleLlmConfigChange('apiKey', e.target.value)}
                      placeholder="sk-..."
                      autoComplete="off"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 pr-10 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-600 hover:text-slate-900 transition-colors"
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-sm lg:text-base font-semibold text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberKey}
                      onChange={(e) => handleRememberKeyChange(e.target.checked)}
                      className="w-4 h-4 accent-brand"
                    />
                    <span>Remember on this device</span>
                  </label>
                  <p className="text-slate-500 text-xs lg:text-sm leading-snug">
                    {rememberKey
                      ? 'Stored in this browser until you clear it.'
                      : 'Kept for this tab only — you will re-enter it next time.'}
                  </p>
                </div>
                <div>
                  <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Model</span>
                  <input
                    type="text"
                    value={llmConfig.model}
                    onChange={(e) => handleLlmConfigChange('model', e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Reasoning / Thinking</span>
                      <p className="text-slate-600 text-xs lg:text-sm leading-snug">
                        Let the model think before answering. Disable for faster, lower-latency responses.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={llmConfig.reasoning !== false}
                      onClick={() => handleLlmConfigChange('reasoning', llmConfig.reasoning === false)}
                      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                        llmConfig.reasoning !== false ? 'bg-brand' : 'bg-slate-300'
                      }`}
                      title="Toggle reasoning"
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          llmConfig.reasoning !== false ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-8 py-5 flex justify-end gap-3">
              <button
                onClick={handleSaveSettings}
                className="rounded-lg px-6 py-2.5 bg-brand text-white font-semibold text-base hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}


      {isProjectsListOpen && (
        <div className="fixed inset-0 z-[60] bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in">
          <div 
            className="w-full max-w-4xl bg-surface rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[88vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header Bar */}
            <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/60 sticky top-0 z-20 backdrop-blur-md">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 brand-gradient rounded-2xl flex items-center justify-center text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20">
                  <FolderOpen size={20} className="drop-shadow-xs" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Your Saved Apps</h2>
                    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                      {myProjects.length}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Pick up where you left off or manage your applications</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Search Bar */}
                {myProjects.length > 0 && (
                  <div className="relative flex-1 sm:w-60">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={projectSearchQuery}
                      onChange={(e) => setProjectSearchQuery(e.target.value)}
                      placeholder="Search apps..."
                      className="w-full pl-9 pr-7 py-2 text-xs sm:text-sm rounded-xl bg-surface border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs transition-all"
                    />
                    {projectSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setProjectSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}

                {/* Close X button */}
                <button
                  onClick={() => setIsProjectsListOpen(false)}
                  className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-200/70 transition-colors shrink-0"
                  title="Close modal"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body / Apps List */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar bg-slate-50/40">
              {myProjects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-16 h-16 rounded-3xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-500 shadow-premium-sm">
                    <FolderOpen size={28} />
                  </div>
                  <h3 className="text-slate-900 font-bold text-base sm:text-lg">No saved apps yet</h3>
                  <p className="text-slate-500 mt-1.5 text-xs sm:text-sm max-w-sm mx-auto leading-relaxed">
                    Build your first application in the workspace and it will be saved automatically to this list.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectsListOpen(false);
                      document.getElementById('prompt')?.focus();
                    }}
                    className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl brand-gradient text-white font-semibold text-xs sm:text-sm shadow-premium-md hover:shadow-premium-lg transition-all"
                  >
                    <Plus size={15} strokeWidth={2.4} />
                    <span>Create an App</span>
                  </button>
                </div>
              ) : myProjects.filter((p) => !projectSearchQuery.trim() || (p.name || '').toLowerCase().includes(projectSearchQuery.toLowerCase().trim())).length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <Search size={22} />
                  </div>
                  <h3 className="text-slate-800 font-bold text-base">No matching apps</h3>
                  <p className="text-slate-500 mt-1 text-xs sm:text-sm">
                    No applications match &ldquo;{projectSearchQuery}&rdquo;
                  </p>
                  <button
                    type="button"
                    onClick={() => setProjectSearchQuery('')}
                    className="mt-4 px-4 py-1.5 rounded-lg bg-surface border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 shadow-2xs transition-colors"
                  >
                    Clear Search
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myProjects
                    .filter((p) => !projectSearchQuery.trim() || (p.name || '').toLowerCase().includes(projectSearchQuery.toLowerCase().trim()))
                    .map((project) => {
                      const isCurrent = currentProjectId === project.id;
                      const initialLetter = (project.name || 'U').trim()[0]?.toUpperCase() || 'A';
                      const versionCount = project.versions?.length || 1;

                      return (
                        <div
                          key={project.id}
                          className={`rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden relative group bg-surface shadow-2xs hover:shadow-premium-md ${
                            isCurrent
                              ? 'border-indigo-300 ring-2 ring-indigo-500/20 bg-indigo-50/10'
                              : 'border-slate-200/90 hover:border-indigo-300'
                          }`}
                        >
                          {/* Card Header & Content */}
                          <div className="p-5 pb-4">
                            {editingProjectId === project.id ? (
                              /* In-place Rename */
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    Rename Application
                                  </label>
                                  <span className="text-[11px] text-slate-400">Press Enter to save</span>
                                </div>
                                <input
                                  autoFocus
                                  type="text"
                                  value={editingProjectName}
                                  onChange={(e) => setEditingProjectName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleProjectRename(project);
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      cancelProjectRename();
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                  placeholder="App name"
                                />
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleProjectRename(project)}
                                    disabled={!editingProjectName.trim() || renamingProjectId === project.id}
                                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                                      !editingProjectName.trim() || renamingProjectId === project.id
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        : 'bg-brand text-white hover:bg-brand-hover shadow-2xs'
                                    }`}
                                  >
                                    <Check size={13} />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelProjectRename}
                                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors"
                                  >
                                    <X size={13} />
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Standard Card Info */
                              <div>
                                <div className="flex items-start justify-between gap-3 mb-2.5">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    {/* App Icon Avatar */}
                                    <div className="w-10 h-10 rounded-xl brand-gradient text-white font-bold text-sm flex items-center justify-center shadow-2xs shrink-0 ring-1 ring-black/5 dark:ring-white/10">
                                      {initialLetter}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 
                                          onClick={() => loadProject(project)}
                                          className="font-bold text-slate-900 text-base leading-snug truncate cursor-pointer hover:text-indigo-600 transition-colors"
                                          title={project.name}
                                        >
                                          {project.name}
                                        </h4>
                                        {isCurrent && (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full shrink-0">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                                            Active
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                                        <span className="flex items-center gap-1">
                                          <Clock size={11} className="text-slate-400" />
                                          {formatModifiedTime(project.lastModified)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Top Right Actions (Rename & Delete) */}
                                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                                    <button
                                      type="button"
                                      onClick={() => startProjectRename(project)}
                                      aria-label="Rename app"
                                      title="Rename app"
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setProjectToDelete(project)}
                                      aria-label="Delete app"
                                      title="Delete app"
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-100"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Card Bottom / Footer Row */}
                          {editingProjectId !== project.id && (
                            <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-slate-200/80 text-xs font-semibold text-slate-600 shadow-2xs">
                                  <Layers size={12} className="text-indigo-500" />
                                  {versionCount} version{versionCount !== 1 ? 's' : ''}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => loadProject(project)}
                                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-semibold text-xs transition-all shadow-2xs ${
                                  isCurrent
                                    ? 'bg-brand text-white hover:bg-brand-hover shadow-indigo-500/20'
                                    : 'bg-surface hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200'
                                }`}
                              >
                                <span>{isCurrent ? 'Open in Editor' : 'Open App'}</span>
                                <ExternalLink size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Modal Bottom Bar */}
            <div className="bg-slate-50/90 border-t border-slate-200/80 px-6 sm:px-8 py-4 flex items-center justify-between text-xs text-slate-500">
              <div className="font-medium">
                {myProjects.length > 0 && (
                  <span>
                    Showing <span className="font-bold text-slate-700">
                      {myProjects.filter((p) => !projectSearchQuery.trim() || (p.name || '').toLowerCase().includes(projectSearchQuery.toLowerCase().trim())).length}
                    </span> of <span className="font-bold text-slate-700">{myProjects.length}</span> apps
                  </span>
                )}
              </div>
              <button 
                onClick={() => setIsProjectsListOpen(false)}
                className="nav-btn bg-surface hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold px-4 py-1.5 rounded-xl border border-slate-200 shadow-2xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-[70] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">Delete App</h2>
                <p className="text-sm text-slate-400 mt-0.5">This cannot be undone.</p>
              </div>
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed">
                Delete <span className="font-bold text-slate-900">{projectToDelete.name || 'Untitled App'}</span> from your saved applications?
              </div>
              {currentProjectId === projectToDelete.id && (
                <p className="text-xs font-medium text-slate-500">
                  This app is currently open. Deleting it will clear the current workspace.
                </p>
              )}
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProject}
                disabled={deletingProjectId === projectToDelete.id}
                className={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold transition-all ${
                  deletingProjectId === projectToDelete.id
                    ? 'bg-red-200 text-white cursor-not-allowed'
                    : 'bg-danger text-white hover:bg-danger-hover'
                }`}
              >
                <Trash2 size={14} />
                {deletingProjectId === projectToDelete.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isNewChatConfirmOpen && (
        <div className="fixed inset-0 z-[70] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">Start a new app?</h2>
                <p className="text-sm text-slate-400 mt-0.5">This will clear your current workspace.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewChatConfirmOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
                <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <span>
                  You have unsaved changes. Starting a new app will discard your current work including any generated code and version history.
                </span>
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsNewChatConfirmOpen(false)}
                className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmNewChat}
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
              >
                Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {isNamingModalOpen && (
        <div className="fixed inset-0 z-[65] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">Name Your App</h2>
              <button
                onClick={() => {
                  setShouldGenerateAfterNaming(false);
                  setTempProjectName('');
                  setIsNamingModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleConfirmNaming} className="p-6 space-y-5">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">App Name</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
                    <Edit2 size={16} />
                  </div>
                  <input
                    autoFocus
                    type="text"
                    value={tempProjectName}
                    onChange={(e) => setTempProjectName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="e.g. Recipe Assistant, Task Manager..."
                  />
                </div>
                <p className="text-xs text-slate-400">Helps you find this app later.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShouldGenerateAfterNaming(false);
                    setTempProjectName('');
                    setIsNamingModalOpen(false);
                  }}
                  className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!tempProjectName.trim()}
                  className={`rounded-lg px-5 py-2 font-semibold transition-colors active:scale-[0.98] ${
                    !tempProjectName.trim() 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                    : 'bg-brand text-white hover:bg-brand-hover shadow-sm'
                  }`}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAccountSettingsOpen && isSignedIn && (
        <AccountSettingsModal 
          user={user} 
          onClose={() => setIsAccountSettingsOpen(false)} 
          onSignOut={handleSignOut} 
        />
      )}

      {isAuthModalOpen && (
        <div className="fixed inset-0 z-[80] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                  <User size={18} />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
                </h2>
              </div>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="p-6 space-y-5">
              {authInfo && (
                <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 leading-relaxed flex items-start gap-3">
                  <Mail size={18} className="text-green-500 shrink-0 mt-0.5" />
                  <span>{authInfo}</span>
                </div>
              )}
              {authError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 leading-relaxed">
                  {authError}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Email</label>
                  <input
                    autoFocus
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showAuthPassword ? 'text' : 'password'}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 pr-10 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-800 transition-colors"
                      aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                    >
                      {showAuthPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              {authMode === 'signup' ? (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your generated apps and version history sync to your account and are only visible to you.
                </p>
              ) : (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Sign in to sync your apps across devices. Guests can keep working locally without an account.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={authLoading}
                  className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors active:scale-[0.98] ${
                    authLoading
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-brand text-white hover:bg-brand-hover shadow-sm'
                  }`}
                >
                  {authLoading && <Loader2 className="animate-spin" size={15} />}
                  {authMode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </div>
            </form>

            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 text-center text-sm">
              {authMode === 'signup' ? (
                <>Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => handleAuthModeSwitch('signin')}
                    className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>New to Orion?{' '}
                  <button
                    type="button"
                    onClick={() => handleAuthModeSwitch('signup')}
                    className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Create an account
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <div className="fixed inset-0 z-[80] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                  <CloudUpload size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Bring your apps to the cloud?</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Found {importLocalCount} saved in this browser.</p>
                </div>
              </div>
              <button
                onClick={handleSkipImport}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-600 leading-relaxed">
                Import your existing {importLocalCount} app{importLocalCount !== 1 ? 's' : ''} into your account so they sync across devices? This happens once and won't be offered again.
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleSkipImport}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleImportProjects}
                disabled={authLoading}
                className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors active:scale-[0.98] ${
                  authLoading
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-brand text-white hover:bg-brand-hover shadow-sm'
                }`}
              >
                {authLoading && <Loader2 className="animate-spin" size={15} />}
                {authLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Collapse toggle tab — visible only when sidebar is closed */}
        {!isHistoryOpen && (
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="hidden md:flex items-center justify-center w-7 2xl:w-8 bg-surface border-y border-r border-slate-300 rounded-r-lg shadow-sm hover:bg-slate-50 hover:text-indigo-600 transition-all duration-200 z-20 flex-shrink-0 -ml-px group"
            title="Show history panel"
          >
            <PanelLeftOpen size={16} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          </button>
        )}
        {/* History Sidebar */}
        <aside className={`hidden md:flex flex-col z-10 transition-all duration-300 ease-out relative history-bg noise-texture border-r border-slate-300/80 panel-edge-right ${
          isHistoryOpen ? 'w-80 lg:w-[340px] xl:w-[380px] 2xl:w-[420px]' : 'w-0 min-w-0 border-r-0 overflow-hidden opacity-0'
        }`}>
          {/* Header */}
          <div className="shrink-0 px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between history-header-bg border-b border-slate-200/90 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-surface p-1.5 rounded-lg border border-transparent hover:border-slate-200 transition-all duration-200 flex-shrink-0"
                title="Hide history panel"
              >
                <PanelLeftClose size={16} />
              </button>
              <div className="h-7 w-7 2xl:h-8 2xl:w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-200/80 shadow-2xs">
                <History size={15} />
              </div>
              <h2 className="text-sm 2xl:text-base font-bold text-slate-900 whitespace-nowrap tracking-tight">
                History
              </h2>
            </div>
            {versions.length > 0 && (
              <span className="text-[11px] 2xl:text-xs font-bold text-slate-700 bg-surface px-2.5 py-0.5 rounded-full border border-slate-300/80 shadow-2xs">
                {versions.length} version{versions.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Version List */}
          <div className="flex-1 overflow-y-auto px-3.5 py-3.5 space-y-0 chat-scrollbar relative z-[1]">
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="relative mb-4">
                  <div className="w-16 h-16 2xl:w-20 2xl:h-20 rounded-2xl bg-surface flex items-center justify-center border border-slate-200/90 shadow-sm">
                    <div className="w-9 h-9 2xl:w-11 2xl:h-11 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                      <Clock size={20} />
                    </div>
                  </div>
                  <div className="absolute inset-0 rounded-2xl animate-pulse pulse-ring" />
                </div>
                <h3 className="text-slate-800 font-bold text-sm 2xl:text-base mb-1">No versions yet</h3>
                <p className="text-slate-500 text-xs 2xl:text-sm leading-relaxed max-w-[15rem]">
                  Each build creates a version snapshot you can inspect or restore anytime.
                </p>
              </div>
            ) : (
              <div className="relative pl-6">
                {/* Timeline line */}
                <div className="absolute left-[14px] top-2 bottom-2 w-[2px] bg-slate-300/90 rounded-full" />
                {[...versions].reverse().map((ver, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isActive = currentVersionIndex === idx;
                const isExpanded = expandedVersionIndex === idx;
                return (
                  <div key={ver.id} className="relative mb-2 animate-fade-in" style={{ animationDelay: `${reversedIdx * 40}ms` }}>
                    {/* Timeline dot */}
                    <div className={`absolute z-[2] transition-all duration-300 ${
                      isActive
                        ? '-left-[20px] top-[13px] w-[12px] h-[12px] rounded-full bg-indigo-600 border-2 border-surface ring-4 ring-indigo-200/70 shadow-sm'
                        : '-left-[19px] top-[14px] w-[10px] h-[10px] rounded-full bg-slate-300 border-2 border-surface ring-1 ring-slate-400/40'
                    }`} />

                    {/* Version card */}
                    <div
                      onClick={() => toggleExpandVersion(idx)}
                      className={`relative cursor-pointer rounded-xl transition-all duration-200 overflow-hidden ${
                        isActive
                          ? 'bg-surface border-2 border-indigo-600 active-version-glow shadow-sm'
                          : 'bg-surface border border-slate-200/90 hover:border-slate-300 hover:shadow-sm shadow-2xs group'
                      }`}
                    >
                      <div className="px-3.5 py-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Version badge */}
                          <div className={`shrink-0 h-[22px] min-w-[38px] px-2 rounded-md flex items-center justify-center text-[10px] font-bold tracking-wide transition-all duration-200 ${
                            isActive
                              ? 'bg-brand text-white shadow-xs shadow-indigo-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200 group-hover:bg-slate-200'
                          }`}>
                            v{idx + 1}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span className={`block text-[13px] 2xl:text-[14px] leading-[1.35] transition-colors truncate ${
                                isActive ? 'text-slate-900 font-bold' : 'text-slate-800 font-medium group-hover:text-slate-900'
                              }`}>
                                {ver.prompt}
                              </span>
                              {idx === 0 && (
                                <span className="shrink-0 text-[8px] 2xl:text-[9px] font-bold px-1.5 py-[2px] rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider mt-0.5">
                                  Initial
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] 2xl:text-[11px] font-medium">
                              <span className={isActive ? 'text-indigo-600 font-semibold' : 'text-slate-500'}>
                                {ver.timestamp}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 px-1.5 py-[2px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] 2xl:text-[10px] font-bold uppercase tracking-wider">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                                  Active
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight
                            size={14}
                            className={`shrink-0 mt-1 transition-all duration-200 ${
                              isExpanded ? 'rotate-90 text-indigo-600' : isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="mt-2 ml-2 mr-0 mb-2 version-expand-enter">
                        <div className="bg-surface border border-slate-200/90 rounded-xl p-4 shadow-premium-md">
                          <div className="space-y-4">
                            {/* Prompt */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-1.5 h-3 rounded-full bg-indigo-500" />
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">Prompt</span>
                              </div>
                              <div className="text-[13px] 2xl:text-[14px] text-slate-800 font-medium leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                                {ver.prompt}
                              </div>
                            </div>

                            {/* Metadata */}
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-slate-200">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.10em]">Modified</span>
                                <span className="text-xs text-slate-700 font-semibold mt-0.5">{ver.timestamp}</span>
                              </div>
                              {ver.editSummary && (
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.10em]">Summary</span>
                                  <span className="text-xs text-slate-700 font-semibold mt-0.5 truncate">{ver.editSummary}</span>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); switchVersion(idx); }}
                                className="btn-premium btn-premium-primary py-2 text-xs font-semibold"
                              >
                                <Play size={13} />
                                Restore
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); copyVersionCode(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs font-semibold hover:border-slate-300"
                              >
                                <Copy size={13} />
                                Copy
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); downloadVersion(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs font-semibold hover:border-slate-300"
                              >
                                <Download size={13} />
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          
          {/* Prompt/Chat Sidebar (Left) - Build Panel */}
          <div className="w-full md:w-[400px] lg:w-[460px] xl:w-[520px] 2xl:w-[600px] 3xl:w-[680px] min-h-0 overflow-hidden flex flex-col bg-surface border-r border-slate-300/80 z-20 flex-shrink-0 panel-edge-right relative">
            {/* Subtle atmospheric gradient */}
            <div className="absolute inset-0 pointer-events-none z-0 prompt-atmosphere" />

            <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 xl:px-10 2xl:px-12 pt-5 lg:pt-6 2xl:pt-8 pb-3 flex flex-col justify-start relative z-[1] chat-scrollbar">
              <div className="max-w-2xl w-full mx-auto space-y-4 xl:space-y-5 2xl:space-y-6 animate-fade-in">

                {/* Header Section */}
                <div className={generatedCode ? 'refine-card' : 'relative'}>
                  {!generatedCode && (
                    <div className="pointer-events-none absolute -top-8 left-0 right-0 h-44 hero-atmosphere" aria-hidden="true" />
                  )}
                  <div className="space-y-2.5 sm:space-y-3 relative">
                    {generatedCode ? (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-[0.14em] bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                          Editing Mode
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5 pt-0.5">
                        <span className="orion-belt" aria-hidden="true">
                          <span className="orion-dot" />
                          <span className="orion-dot orion-dot-mid" />
                          <span className="orion-dot" />
                        </span>
                      </div>
                    )}
                    <h2 className="text-3xl sm:text-4xl lg:text-[2.5rem] xl:text-[2.85rem] 2xl:text-[3.3rem] font-bold tracking-tight text-slate-900 leading-[1.08]">
                      {generatedCode ? (
                        <>Refine <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">your app</span></>
                      ) : (
                        <>What do you want to <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">build?</span></>
                      )}
                    </h2>
                    <p className="text-slate-600 text-sm sm:text-base xl:text-lg 2xl:text-xl leading-relaxed max-w-[36ch]">
                      {generatedCode
                        ? "Describe what to change, add, or fix."
                        : "Describe an idea in plain words and Orion turns it into a complete, working app."}
                    </p>
                  </div>
                </div>

                {/* Starter Prompts */}
                {!generatedCode && (
                  <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-3.5 w-1 rounded-full bg-indigo-500" aria-hidden="true" />
                        <h3 className="text-xs 2xl:text-sm font-bold text-slate-500 uppercase tracking-[0.2em]">
                          Starter Ideas
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateStarters}
                        disabled={isGeneratingStarters}
                        className="group inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs 2xl:text-sm font-semibold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Generate new starter ideas"
                      >
                        <RefreshCw size={13} className={`transition-transform duration-500 text-slate-400 group-hover:text-indigo-600 ${isGeneratingStarters ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
                        <span>{isGeneratingStarters ? 'Generating...' : 'Refresh'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 xl:gap-3 2xl:gap-3.5">
                      {starterIdeas.map((starter) => {
                        const IconComponent = starter.icon;
                        return (
                          <button
                            key={starter.title}
                            onClick={() => setPrompt(starter.prompt)}
                            className="group flex flex-col justify-between text-left p-3 xl:p-3.5 2xl:p-4 bg-slate-50/80 hover:bg-surface border border-slate-200/90 hover:border-indigo-300 rounded-xl xl:rounded-2xl transition-all hover:shadow-premium-md suggestion-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          >
                            <div className="flex items-center justify-between w-full mb-2">
                              <div className={`w-7 h-7 2xl:w-8 2xl:h-8 rounded-lg 2xl:rounded-xl flex items-center justify-center ${starter.color} border border-black/5 dark:border-white/10 shadow-2xs`}>
                                <IconComponent size={15} />
                              </div>
                              <span className="text-[10px] 2xl:text-xs font-bold text-slate-500 uppercase tracking-wider bg-surface px-1.5 py-0.5 rounded-md border border-slate-200/80">
                                {starter.category}
                              </span>
                            </div>
                            <div className="text-sm sm:text-base font-bold text-slate-800 group-hover:text-indigo-600 transition-colors mb-0.5">
                              {starter.title}
                            </div>
                            <p className="text-xs sm:text-sm text-slate-500 leading-snug">
                              {starter.prompt}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(versions.length > 0 || pendingPrompt) && (
                  <div className="space-y-4">
                    {versions.slice(0, currentVersionIndex + 1).map((ver) => (
                      <div key={ver.id} className="space-y-2">
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium shadow-sm">
                            {ver.prompt}
                          </div>
                        </div>
                        {ver.reply && (
                          <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-800 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                              {ver.reply}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {isGenerating && pendingPrompt && (
                      <div className="space-y-2">
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium shadow-sm">
                            {pendingPrompt}
                          </div>
                        </div>
                        {streamingReply && (
                          <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-800 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap animate-fade-in">
                              {streamingReply}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl backdrop-blur-sm animate-fade-in">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 bg-rose-100 rounded-lg text-rose-600 flex-shrink-0">
                        <RefreshCw size={15} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-0.5">Error</p>
                        <p className="text-[13px] text-rose-800 font-medium leading-snug">
                          {error}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Bottom Input Area */}
            <div className="shrink-0 p-3.5 sm:p-4 2xl:p-5 pt-2.5 border-t border-slate-200/80 bg-surface/95 backdrop-blur-md relative z-[1]">
              {generatedCode && !isGenerating && (isSuggestionsLoading || contextualSuggestions.length > 0) && (
                <div className="mb-2.5 animate-fade-in">
                  <div className="flex items-center justify-between px-0.5 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="suggestion-spark" aria-hidden="true">
                        <Sparkles size={13} />
                      </span>
                      <span className="text-xs 2xl:text-sm font-bold text-slate-500 uppercase tracking-[0.16em]">Suggestions</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshSuggestions}
                      disabled={isSuggestionsLoading}
                      aria-label="Regenerate suggestions"
                      className="group/refresh inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs 2xl:text-sm font-semibold text-slate-400 hover:text-indigo-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw size={12} className={isSuggestionsLoading ? 'animate-spin' : 'transition-transform duration-500 group-hover/refresh:rotate-180'} />
                      <span>New</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {contextualSuggestions.length > 0 ? (
                      contextualSuggestions.map((suggestion, idx) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setPrompt(suggestion)}
                          className={`suggestion-chip group inline-flex items-center gap-2 text-left pl-2 pr-3.5 py-1.5 text-xs sm:text-sm leading-snug font-medium rounded-xl border border-slate-200 bg-surface text-slate-800 shadow-2xs transition-all hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-800 animate-stagger-${Math.min(idx + 1, 5)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
                        >
                          <span className="suggestion-chip-icon shrink-0" aria-hidden="true">
                            <Plus size={13} strokeWidth={2.5} />
                          </span>
                          <span>{suggestion}</span>
                        </button>
                      ))
                    ) : (
                      [0, 1, 2, 3].map((idx) => (
                        <span key={idx} className="suggestion-skeleton h-8 rounded-xl w-[46%]" aria-hidden="true" />
                      ))
                    )}
                  </div>
                </div>
              )}
              <div className="bg-surface rounded-2xl shadow-sm border border-slate-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100/60 overflow-hidden transition-all input-glow">
                <textarea
                  id="prompt"
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isGenerating && prompt.trim()) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  placeholder={generatedCode ? "e.g. Make the background dark, add a reset button..." : "e.g. A minimalist task manager with categories..."}
                  className="w-full h-20 sm:h-24 xl:h-28 2xl:h-36 px-4 2xl:px-5 pt-3 2xl:pt-4 pb-2 outline-none resize-none text-slate-900 placeholder:text-slate-400 text-sm sm:text-base xl:text-lg 2xl:text-xl leading-relaxed bg-transparent"
                  disabled={isGenerating}
                />
                {!generatedCode && versions.length === 0 && (
                  <div className="px-3 sm:px-3.5 pb-2">
                    <div className="flex items-center justify-between py-1.5 px-2.5 sm:px-3 rounded-lg bg-slate-50 border border-slate-200/80">
                      <span className="text-[11px] 2xl:text-xs font-bold text-slate-500 uppercase tracking-wider">Optimize for</span>
                      <div className="flex items-center gap-1 sm:gap-1.5">
                        {INITIAL_LAYOUT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = initialLayoutTarget === option.id;

                          return (
                            <label
                              key={option.id}
                              className={`flex cursor-pointer items-center gap-1 sm:gap-1.5 rounded-md px-2 py-0.5 text-xs xl:text-sm font-semibold transition-all ${
                                isSelected
                                  ? 'bg-surface text-indigo-700 shadow-2xs border border-slate-200/80'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              <input
                                type="radio"
                                name="initialLayoutTarget"
                                value={option.id}
                                checked={isSelected}
                                onChange={() => setInitialLayoutTarget(option.id)}
                                className="sr-only"
                                disabled={isGenerating}
                              />
                              <Icon size={13} className={isSelected ? 'text-indigo-600' : 'text-slate-400'} />
                              <span>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-3.5 sm:px-4 py-2 sm:py-2.5">
                  <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 select-none">
                    <kbd className="px-2 py-0.5 rounded border border-slate-300 bg-surface font-sans text-xs 2xl:text-sm leading-none text-slate-600 font-semibold shadow-2xs">⌘ ↵</kbd>
                    <span className="hidden sm:inline">to build</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isGenerating && (
                      <button
                        onClick={() => {
                          if (abortControllerRef.current) {
                            abortControllerRef.current.abort();
                            abortControllerRef.current = null;
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors"
                      >
                        <X size={14} />
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt.trim()}
                      className={`inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 text-sm sm:text-base font-bold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        isGenerating || !prompt.trim()
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                          : 'brand-gradient text-white shadow-premium-md hover:shadow-premium-lg hover:brightness-105 active:scale-[0.99]'
                      }`}
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          <span>{generatedCode ? "Updating..." : "Building..."}</span>
                        </>
                      ) : (
                        <>
                          {generatedCode ? <Edit2 size={16} /> : <Wand2 size={16} />}
                          <span>{generatedCode ? "Update App" : "Build App"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview/Device Area (Right) */}
          <div className="flex-1 min-h-0 flex flex-col relative z-0 inset-shadow-preview noise-texture">
            
            {/* Canvas Studio Header Bar */}
            <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 2xl:px-8 py-2.5 sm:py-3 2xl:py-3.5 border-b border-slate-200/90 bg-surface/95 backdrop-blur-md z-10">
              {/* Left: View Tabs */}
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="nav-segmented-group">
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                      activeTab === 'preview' ? 'nav-segmented-btn-active' : ''
                    }`}
                  >
                    <Play size={14} />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                      activeTab === 'code' ? 'nav-segmented-btn-active' : ''
                    }`}
                  >
                    <TerminalSquare size={14} />
                    <span>Code</span>
                  </button>
                </div>

                {/* Version indicator pill */}
                {versions.length > 0 && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs sm:text-sm font-bold border border-slate-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    v{currentVersionIndex + 1}
                  </span>
                )}
              </div>

              {/* Center: Device Presets (when in preview tab) */}
              {activeTab === 'preview' && (
                <div className="nav-segmented-group" title="Device Viewport Preset">
                  <button
                    onClick={() => setPreviewMode('mobile')}
                    className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'mobile' ? 'nav-segmented-btn-active' : ''}`}
                    title="Mobile View (399 × 820)"
                  >
                    <Smartphone size={14} />
                    <span className="hidden sm:inline">Mobile</span>
                  </button>
                  <button
                    onClick={() => setPreviewMode('desktop')}
                    className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'desktop' ? 'nav-segmented-btn-active' : ''}`}
                    title="Desktop View (1468 × 1022)"
                  >
                    <Monitor size={14} />
                    <span className="hidden sm:inline">Desktop</span>
                  </button>
                </div>
              )}

              {/* Right: Studio Actions (Zoom, Undo/Redo, Pop-out, Export) */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Undo/Redo when versions > 1 */}
                {versions.length > 1 && (
                  <div className="hidden md:flex nav-segmented-group" title="Undo / Redo Version">
                    <button
                      onClick={handleUndo}
                      disabled={currentVersionIndex <= 0}
                      className="nav-segmented-btn nav-segmented-btn-icon"
                      title="Previous Version"
                    >
                      <Undo2 size={14} />
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={currentVersionIndex >= versions.length - 1}
                      className="nav-segmented-btn nav-segmented-btn-icon"
                      title="Next Version"
                    >
                      <Redo2 size={14} />
                    </button>
                  </div>
                )}

                {/* Zoom Controls (when in preview tab) */}
                {activeTab === 'preview' && (
                  <div className="hidden sm:flex nav-segmented-group" title="Zoom Controls">
                    <button
                      onClick={() => handleManualZoom(-0.1)}
                      disabled={zoomLevel <= 0.2}
                      className="nav-segmented-btn nav-segmented-btn-icon"
                      title="Zoom Out (-10%)"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <button
                      onClick={resetZoom}
                      className={`nav-segmented-btn text-xs sm:text-sm font-semibold px-2.5 ${isAutoZoom ? 'nav-segmented-btn-active' : ''}`}
                      title={isAutoZoom ? "Auto-Zoom active (click to reset)" : "Reset to Auto-Zoom"}
                    >
                      {isAutoZoom ? 'Auto' : `${Math.round(zoomLevel * 100)}%`}
                    </button>
                    <button
                      onClick={() => handleManualZoom(0.1)}
                      disabled={zoomLevel >= 3}
                      className="nav-segmented-btn nav-segmented-btn-icon"
                      title="Zoom In (+10%)"
                    >
                      <ZoomIn size={14} />
                    </button>
                  </div>
                )}

                {/* Open in new tab (when code generated) */}
                {generatedCode && (
                  <button
                    onClick={handleOpenInNewTab}
                    className="nav-btn bg-surface hover:bg-slate-50 text-slate-700 hover:text-indigo-600 border border-slate-200/90 shadow-2xs font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group"
                    title="Open preview in new browser tab"
                  >
                    <ExternalLink size={14} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
                    <span className="hidden lg:inline">Open</span>
                  </button>
                )}

                {/* Export HTML */}
                {generatedCode && (
                  <button
                    onClick={handleDownload}
                    className="nav-btn bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 hover:text-indigo-800 border border-indigo-200/90 shadow-2xs font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group"
                    title="Export and Download HTML file"
                  >
                    <Download size={14} className="text-indigo-600 transition-colors" />
                    <span className="hidden md:inline">Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Container for Device or Code */}
            <div 
              ref={previewContainerRef}
              className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-auto relative custom-scrollbar"
            >
              
              {/* Subtle workspace grid */}
              <div className="absolute inset-0 opacity-50 pointer-events-none workspace-grid"></div>

              {activeTab === 'preview' ? (
                /* Device Mockup */
                <div
                  className="palette-stock relative shrink-0 flex items-center justify-center"
                  style={{
                    width: scaledPreviewWidth,
                    height: scaledPreviewHeight
                  }}
                >
                  <div
                    className={previewMode === 'mobile' ? 'device-smartphone' : 'device-desktop'}
                    style={{
                      transform: `scale(${zoomLevel})`,
                      transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                  >
                  {previewMode === 'desktop' && (
                    <div className="device-desktop-toolbar">
                      <div className="device-desktop-lights">
                        <span className="device-desktop-light device-desktop-light-red"></span>
                        <span className="device-desktop-light device-desktop-light-amber"></span>
                        <span className="device-desktop-light device-desktop-light-green"></span>
                      </div>
                      <div className="device-desktop-addressbar">
                        <span className="device-desktop-address-pill"></span>
                        <span className="device-desktop-address-text">app-preview.local</span>
                      </div>
                    </div>
                  )}
                   
                  {/* Screen */}
                  <div className={previewMode === 'mobile' ? 'device-screen device-screen-mobile' : 'device-screen'}>
                    <div className={previewMode === 'mobile' ? 'device-preview-surface device-preview-surface-mobile' : 'device-preview-surface'}>
                      {generatedCode ? (
                        <iframe
                          ref={iframeRef}
                          title="Generated App Preview"
                          srcDoc={previewSrcDoc}
                          className="w-full h-full border-none"
                          sandbox="allow-scripts allow-forms allow-popups"
                          referrerPolicy="no-referrer"
                          allow=""
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100/70 p-6 sm:p-8 text-center select-none relative overflow-hidden">
                          {/* Ambient glow */}
                          <div className="absolute w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

                          <div className="relative mb-5">
                            <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-white flex items-center justify-center shadow-premium-md border border-slate-200/80">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center text-indigo-600">
                                <Sparkles size={24} className="animate-pulse" />
                              </div>
                            </div>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight mb-1.5">
                            Live Sandbox Preview
                          </h4>
                          <p className="text-xs sm:text-sm text-slate-500 max-w-[17rem] leading-relaxed mb-6">
                            Enter a prompt to generate and interact with your app in real-time.
                          </p>

                          <div className="flex flex-col gap-2 w-full max-w-[260px] sm:max-w-[280px]">
                            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                              <Zap size={14} className="text-amber-500 shrink-0" />
                              <span>Instant live rendering</span>
                            </div>
                            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                              <ShieldAlert size={14} className="text-emerald-500 shrink-0" />
                              <span>Sandboxed origin security</span>
                            </div>
                            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                              <Layers size={14} className="text-indigo-500 shrink-0" />
                              <span>Tailwind CSS & JS built-in</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {isGenerating && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10 p-6 text-center">
                        <div className="relative w-16 h-16 mb-6">
                          <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto text-blue-500" size={22} />
                        </div>
                        <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-1">Building...</h3>
                        <p className="text-xs sm:text-sm text-slate-500 animate-pulse">Generating HTML, CSS & JavaScript</p>
                      </div>
                    )}
                  </div>

                  {previewMode === 'mobile' ? (
                    <>
                      {/* Side Buttons Visuals */}
                      <div className="absolute -left-1 top-24 w-1 h-12 bg-slate-700 rounded-r-sm shadow-sm"></div>
                      <div className="absolute -left-1 top-40 w-1 h-20 bg-slate-700 rounded-r-sm shadow-sm"></div>
                      <div className="absolute -right-1 top-36 w-1 h-20 bg-slate-700 rounded-l-sm shadow-sm"></div>

                      {/* Home Indicator */}
                      <div className="absolute bottom-3 inset-x-0 flex justify-center z-20">
                        <div className="w-32 h-1.5 rounded-full bg-slate-200/70"></div>
                      </div>
                    </>
                  ) : (
                    <div className="device-desktop-stand"></div>
                  )}
                  </div>
                </div>

              ) : (
                /* Code View */
                <div className="palette-stock w-full h-full bg-[#1a1b26] rounded-lg overflow-hidden shadow-lg border border-slate-800/50 flex flex-col">
                  <div className="bg-[#24253a] px-4 py-2 flex items-center border-b border-black/30">
                    <div className="flex space-x-1.5 mr-4">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">index.html</span>
                    <div className="flex-1"></div>
                    {codePanelCode && (
                      <button
                        onClick={handleCopyCode}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                          copied 
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                            : 'text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                        title="Copy to clipboard"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copied ? 'Copied!' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto bg-[#1a1b26] custom-scrollbar">
                    {codePanelCode ? (
                      <>
                        {isGenerating && (
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-blue-500/10 bg-[#1a1b26]/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-blue-300 backdrop-blur-sm">
                            <Loader2 className="animate-spin" size={12} />
                            <span>Streaming</span>
                          </div>
                        )}
                        <div 
                          className="py-4 font-mono text-[13px] leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(codePanelCode) }}
                        />
                      </>
                    ) : isGenerating ? (
                       <div className="flex items-center justify-center h-full space-x-2.5 text-blue-400/50 font-mono text-sm">
                         <Loader2 className="animate-spin" size={16} />
                         <span>Generating...</span>
                        </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-600 font-mono text-sm opacity-40">
                        <Code2 size={36} className="mb-3 text-slate-700" />
                        <span>// No code yet</span>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
