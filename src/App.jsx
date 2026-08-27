import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge, BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from './previewBridge';
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
  PanelLeftOpen,
  PanelLeftClose,
  TriangleAlert,
  Eye,
  EyeOff
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

const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a complete, self-contained HTML file (with inline CSS and JS) that implements the user's requested app.

CRITICAL RULES:
1. Output ONLY valid, raw HTML code or use the provided tools for edits.
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

Do not include any explanations, markdown markers, or text outside of these formats.`;

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
  reasoning: true
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
        reasoning: parsed.reasoning !== false
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
    const STREAM_READ_TIMEOUT_MS = 60000;

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
              // Thinking tokens never become code, but reported so the UI can
              // show progress instead of looking frozen during long reasoning.
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
    return {
      code: sanitizeHtmlResponse(message.content || message),
      editMode: 'full-generation',
      editSummary: 'Initial app generation.'
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

    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls?.length ? message.tool_calls : undefined
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (editsApplied) return { code: workingCode, editMode: 'surgical', editSummary: prompt };
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

  if (editsApplied) return { code: workingCode, editMode: 'surgical', editSummary: prompt };
  throw new Error(`Failed to apply updates after ${MAX_REFINEMENT_TURNS} turns.`);
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

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [initialLayoutTarget, setInitialLayoutTarget] = useState('both');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [previewMode, setPreviewMode] = useState('mobile');
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(loadRememberKey);
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [shouldGenerateAfterNaming, setShouldGenerateAfterNaming] = useState(false);
  const [projectName, setProjectName] = useState('Untitled App');
  const [myProjects, setMyProjects] = useState([]);
  const [isProjectsListOpen, setIsProjectsListOpen] = useState(false);
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
  const previewContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const abortControllerRef = useRef(null);
  // Resume-last-project must only happen on initial mount. If it re-runs whenever
  // currentProjectId flips to null (e.g. after clicking "+ New" / deleting the
  // open app), it would fall back to projects[0] and resurrect the previous
  // session's code into the preview.
  const hasResumedRef = useRef(false);
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

  const clearStreamingState = () => {
    setStreamingCode('');
    setStreamingGeneratedCode('');
    streamingBufferRef.current = '';
    streamingGeneratedCodeRef.current = '';
  };

  // --- Dynamic Zoom Logic ---
  useEffect(() => {
    const calculateZoom = () => {
      if (!isAutoZoom || !previewContainerRef.current || activeTab !== 'preview') return;
      
      const container = previewContainerRef.current;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const containerRect = container.getBoundingClientRect();
      const verticalPadding = previewMode === 'mobile' ? 16 : 32;
      const horizontalPadding = 32;
      const visibleHeight = Math.min(container.clientHeight, Math.max(0, viewportHeight - containerRect.top - 24));
      const visibleWidth = Math.min(container.clientWidth, Math.max(0, viewportWidth - containerRect.left - 24));
      const availableHeight = Math.max(0, visibleHeight - verticalPadding);
      const availableWidth = Math.max(0, visibleWidth - horizontalPadding);
      const preset = PREVIEW_MODES[previewMode];
      const baseHeight = preset.height;
      const baseWidth = preset.width;
      
      const scaleH = availableHeight / baseHeight;
      const scaleW = availableWidth / baseWidth;
      
      const newZoom = Math.min(scaleH, scaleW);
      // We don't want it to get TOO small or TOO large automatically
      const clampedZoom = Math.max(0.2, Math.min(newZoom, 2));
      setZoomLevel(clampedZoom);
    };

    calculateZoom();
    window.addEventListener('resize', calculateZoom);
    return () => window.removeEventListener('resize', calculateZoom);
  }, [isAutoZoom, activeTab, previewMode]);

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

  const loadUserProjects = useCallback(() => {
    try {
      const rows = readProjectRows()
        .slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      const projects = rows.map(row => ({
        id: row.id,
        name: row.name,
        ...row.data,
        lastModified: row.updatedAt
      }));

      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      return [];
    }
  }, []);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      const row = readProjectRows().find(r => r.id === projectId);

      if (!row) {
        localStorage.removeItem('orion-current-project-id');
        return;
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
  }, []);

  const saveProject = useCallback((params = {}) => {
    const {
      versionsToSave = versions,
      indexToSave = currentVersionIndex,
      nameToSave = projectName,
      idToSave = currentProjectId
    } = params;

    if (!versionsToSave.length && !params.force) return;

    const projectId = idToSave || currentProjectId || Date.now().toString();

    try {
      const projectData = {
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
      };

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

      if (!currentProjectId || currentProjectId !== projectId) {
        setCurrentProjectId(projectId);
        localStorage.setItem('orion-current-project-id', projectId);
      }
      loadUserProjects();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, loadUserProjects]);

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

  // --- Data Persistence (resume last project, once, on mount) ---
  useEffect(() => {
    if (hasResumedRef.current) return;
    hasResumedRef.current = true;

    const fetchAndResume = async () => {
      const projects = await loadUserProjects();
      const lastProjectId = localStorage.getItem('orion-current-project-id');

      if (!currentProjectId) {
        const idToLoad = lastProjectId || (projects.length > 0 ? projects[0].id : null);
        if (idToLoad) {
          await loadProjectById(idToLoad);
        }
      }
    };

    fetchAndResume();
  }, [loadUserProjects, loadProjectById, currentProjectId]);

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

  const suggestedPrompts = [
    "A sleek Pomodoro timer with start, pause, and reset buttons.",
    "A minimal weather app UI showing current temp and a 3-day forecast.",
    "A tip calculator with sliders for bill amount and tip percentage.",
    "A daily habit tracker with checkboxes for 5 custom habits.",
    "A to-do list where you add, complete, and delete tasks.",
    "A budget tracker for monthly income and expenses."
  ];

  const starterIcons = [Timer, CloudSun, Receipt, ListChecks, ListTodo, Wallet];

  const handleSaveSettings = () => {
    saveLlmConfig(llmConfig, rememberKey);
    setIsSettingsOpen(false);
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

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, (chunk, kind = 'content') => {
        streamingBufferRef.current = `${streamingBufferRef.current}${chunk.replace(/\s+/g, ' ')}`.slice(-MARQUEE_MAX_BUFFER_LENGTH);
        setStreamingCode(streamingBufferRef.current.trim());
        if (kind === 'content') {
          streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
          setStreamingGeneratedCode(sanitizeHtmlResponse(streamingGeneratedCodeRef.current));
        }
      }, initialLayoutTarget, abortControllerRef.current.signal);
      setGeneratedCode(generationResult.code);
      
      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        code: generationResult.code,
        timestamp: new Date().toLocaleTimeString(),
        editMode: generationResult.editMode,
        editSummary: generationResult.editSummary
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
      const rows = readProjectRows();
      const idx = rows.findIndex(r => r.id === project.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], name: trimmedName, updatedAt: new Date().toISOString() };
        writeProjectRows(rows);
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
      writeProjectRows(readProjectRows().filter(r => r.id !== projectId));

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
      <header className="shrink-0 bg-white border-b border-slate-200/80 header-shadow px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600 p-2 rounded-xl text-white shadow-sm shadow-blue-200">
            <Sparkles size={22} />
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Orion</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleNewApp}
            className="flex items-center gap-1.5 text-slate-800 hover:text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50/60 transition-colors text-sm"
            title="Start a new app"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New</span>
          </button>

          <button
            onClick={() => setIsProjectsListOpen(true)}
            className="flex items-center gap-1.5 text-slate-800 hover:text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50/60 transition-colors text-sm"
          >
            <FolderOpen size={16} />
            <span className="hidden sm:inline">Apps</span>
          </button>

          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="flex items-center gap-1.5 text-slate-800 hover:text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50/60 transition-colors text-sm"
            title={isHistoryOpen ? "Hide history panel" : "Show history panel"}
          >
            {isHistoryOpen ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="hidden sm:inline">History</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 text-slate-800 hover:text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50/60 transition-colors text-sm"
            title="Settings"
          >
            <Settings size={16} />
            <span className="hidden sm:inline">Settings</span>
           </button>

           <div className="hidden sm:flex items-center space-x-2 ml-2 pl-2 border-l border-slate-200">
            {activeTab === 'preview' && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={() => setPreviewMode('mobile')}
                  className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    previewMode === 'mobile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Preview as mobile"
                >
                  <Smartphone size={14} className="mr-1.5" /> Mobile
                </button>
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    previewMode === 'desktop' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:text-slate-900'
                  }`}
                  title="Preview as desktop"
                >
                  <Monitor size={14} className="mr-1.5" /> Desktop
                </button>
              </div>
            )}

             <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
               <button
                 onClick={() => handleManualZoom(-0.1)}
                 disabled={zoomLevel <= 0.2}
                 className={`p-1.5 rounded-md transition-all ${
                   zoomLevel <= 0.2 
                     ? 'text-slate-300 cursor-not-allowed' 
                     : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
                 }`}
                 title="Zoom Out"
               >
                 <ZoomOut size={14} />
               </button>
               <button
                 onClick={resetZoom}
                 className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isAutoZoom ? 'text-blue-600 bg-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
                 }`}
                 title={isAutoZoom ? "Auto-Zoom active" : "Reset to Auto-Zoom"}
               >
                 {isAutoZoom ? 'Auto' : `${Math.round(zoomLevel * 100)}%`}
               </button>
               <button
                 onClick={() => handleManualZoom(0.1)}
                 disabled={zoomLevel >= 3}
                 className={`p-1.5 rounded-md transition-all ${
                   zoomLevel >= 3 
                     ? 'text-slate-300 cursor-not-allowed' 
                     : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
                 }`}
                 title="Zoom In"
               >
                 <ZoomIn size={14} />
               </button>
             </div>

             {versions.length > 1 && (
               <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={handleUndo}
                  disabled={currentVersionIndex <= 0}
                  className={`p-1.5 rounded-md transition-all ${
                    currentVersionIndex <= 0 
                      ? 'text-slate-300 cursor-not-allowed' 
                      : 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-sm'
                  }`}
                  title="Previous Version"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={currentVersionIndex >= versions.length - 1}
                  className={`p-1.5 rounded-md transition-all ${
                    currentVersionIndex >= versions.length - 1 
                      ? 'text-slate-300 cursor-not-allowed' 
                      : 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-sm'
                  }`}
                  title="Next Version"
                >
                  <Redo2 size={14} />
                </button>
              </div>
             )}

             {generatedCode && (
               <button 
                 onClick={handleDownload}
                 className="text-slate-700 hover:text-slate-900 bg-white p-2 rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all active:scale-[0.97]"
                 title="Download HTML"
               >
                 <Download size={16} />
               </button>
             )}
           </div>
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
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-black">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-3">
                <label className="text-base font-bold text-black uppercase tracking-wider">API Endpoint</label>
                <p className="text-black text-lg leading-relaxed">
                  Connect any OpenAI-compatible API. Enter the endpoint URL, key and model — changes save automatically.
                </p>
                <div>
                  <span className="block text-base font-bold text-black mb-1">Base URL</span>
                  <input
                    type="text"
                    value={llmConfig.baseUrl}
                    onChange={(e) => handleLlmConfigChange('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-lg font-semibold text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                  {isInsecureEndpoint(llmConfig.baseUrl) && (
                    <p className="mt-2 flex items-start gap-2 text-base font-semibold text-amber-700">
                      <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                      <span>This endpoint is plain http, so your API key will cross the network unencrypted. Use https for anything outside your own machine.</span>
                    </p>
                  )}
                </div>
                <div>
                  <span className="block text-base font-bold text-black mb-1">API Key</span>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={llmConfig.apiKey}
                      onChange={(e) => handleLlmConfigChange('apiKey', e.target.value)}
                      placeholder="sk-..."
                      autoComplete="off"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 pr-10 text-lg font-semibold text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-600 hover:text-black transition-colors"
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showApiKey ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-base font-semibold text-black cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberKey}
                      onChange={(e) => handleRememberKeyChange(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span>Remember on this device</span>
                  </label>
                  <p className="text-slate-600 text-base leading-snug">
                    {rememberKey
                      ? 'Stored in this browser until you clear it.'
                      : 'Kept for this tab only — you will re-enter it next time.'}
                  </p>
                </div>
                <div>
                  <span className="block text-base font-bold text-black mb-1">Model</span>
                  <input
                    type="text"
                    value={llmConfig.model}
                    onChange={(e) => handleLlmConfigChange('model', e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-lg font-semibold text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <span className="block text-base font-bold text-black mb-1">Reasoning / Thinking</span>
                      <p className="text-slate-600 text-base leading-snug">
                        Let the model think before answering. Disable for faster, lower-latency responses.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={llmConfig.reasoning !== false}
                      onClick={() => handleLlmConfigChange('reasoning', llmConfig.reasoning === false)}
                      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                        llmConfig.reasoning !== false ? 'bg-blue-600' : 'bg-slate-300'
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
                className="rounded-lg px-6 py-3 bg-blue-600 text-white font-semibold text-lg hover:bg-blue-700 shadow-sm transition-colors active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}


      {isProjectsListOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                   <FolderOpen size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Your Apps</h2>
                  <p className="text-slate-400 text-sm">Pick up where you left off</p>
                </div>
              </div>
              <button
                onClick={() => setIsProjectsListOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
              {myProjects.length === 0 ? (
                <div className="text-center py-16">
                  <div className="bg-slate-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <FolderOpen size={28} className="text-slate-300" />
                  </div>
                  <h3 className="text-slate-900 font-semibold text-base">No apps yet</h3>
                  <p className="text-slate-500 mt-1 text-sm max-w-xs mx-auto">Create your first app to see it here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myProjects.map((project) => (
                    <div
                          key={project.id}
                          className="text-left p-5 pr-16 rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all group relative overflow-hidden bg-white hover:-translate-y-0.5 active:scale-[0.99] min-h-[100px]"
                        >
                          <div className="flex items-start">
                            <div className="flex-1 pr-6">
                              {editingProjectId === project.id ? (
                        <div className="space-y-3">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Rename App</label>
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
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="App name"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleProjectRename(project)}
                              disabled={!editingProjectName.trim() || renamingProjectId === project.id}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                                !editingProjectName.trim() || renamingProjectId === project.id
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              <Check size={14} />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelProjectRename}
                              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 bg-slate-100"
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          </div>
                        </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => loadProject(project)}
                              className="w-full text-left"
                            >
                              <h4 className="font-semibold text-slate-900 mb-1.5 text-base truncate group-hover:text-blue-600 transition-colors">{project.name}</h4>
                              <p className="text-xs text-slate-400 font-medium mb-3 flex items-center">
                                <Clock size={12} className="mr-1.5 text-slate-300" />
                                {project.lastModified?.toDate?.() ? project.lastModified.toDate().toLocaleString() : 'Just now'}
                              </p>
                              <div className="flex items-center mt-2">
                                <div className="flex -space-x-1.5 overflow-hidden mr-3">
                                   {[...Array(Math.min(3, project.versions?.length || 0))].map((_, i) => (
                                     <div key={i} className="inline-block h-6 w-6 rounded-lg ring-2 ring-white bg-blue-100 border border-blue-200 flex items-center justify-center">
                                       <span className="text-[10px] font-bold text-blue-600">v{i+1}</span>
                                     </div>
                                   ))}
                                </div>
                                <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                  {project.versions?.length || 1} version{(project.versions?.length || 1) !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </button>
                          )}
                        </div>

                        <div className="flex-shrink-0 ml-4 flex items-start gap-2 flex-wrap">
                          {editingProjectId !== project.id && (
                            <>
                              <button
                                type="button"
                                onClick={() => startProjectRename(project)}
                                aria-label="Rename app"
                                title="Rename app"
                                className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:border-blue-200 hover:text-blue-600"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setProjectToDelete(project)}
                                aria-label="Delete app"
                                title="Delete app"
                                className="h-9 w-9 flex items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500 shadow-sm transition-all hover:border-red-200 hover:bg-red-100 hover:text-red-600"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                          {editingProjectId !== project.id && (
                            <div className="transition-all">
                              <ChevronRight className="text-blue-600" size={24} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-slate-50 border-t border-slate-100 p-5 flex justify-center">
               <button 
                  onClick={() => setIsProjectsListOpen(false)}
                  className="text-slate-400 hover:text-slate-600 font-medium text-sm transition-colors"
               >
                 Close
               </button>
            </div>
          </div>
        </div>
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Delete App</h2>
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
                    : 'bg-red-600 text-white hover:bg-red-700'
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
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Start a new app?</h2>
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
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {isNamingModalOpen && (
        <div className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Name Your App</h2>
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
                      : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                  }`}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Collapse toggle tab — visible only when sidebar is closed */}
        {!isHistoryOpen && (
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="hidden md:flex items-center justify-center w-7 bg-white border border-slate-200 rounded-r-lg shadow-premium-sm hover:bg-slate-50 transition-all duration-200 z-20 flex-shrink-0 -ml-px group"
            title="Show history panel"
          >
            <PanelLeftOpen size={14} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
          </button>
        )}
        {/* History Sidebar */}
        <aside className={`hidden md:flex flex-col z-10 transition-all duration-300 ease-out relative history-bg noise-texture border-r border-slate-200 ${
          isHistoryOpen ? 'w-80' : 'w-0 min-w-0 border-r-0 overflow-hidden opacity-0'
        }`}>
          {/* Header */}
          <div className="shrink-0 px-5 py-4 flex items-center justify-between history-header-bg border-b border-slate-200/60">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="text-slate-400 hover:text-slate-600 hover:bg-white p-1.5 rounded-lg transition-all duration-200 flex-shrink-0"
                title="Hide history panel"
              >
                <PanelLeftClose size={15} />
              </button>
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center text-blue-500 flex-shrink-0 border border-blue-100">
                <History size={13} />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 whitespace-nowrap tracking-tight">
                History
              </h2>
            </div>
            {versions.length > 0 && (
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100/80 px-2 py-0.5 rounded-full border border-slate-200/60">
                {versions.length} version{versions.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Version List */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0 chat-scrollbar relative z-[1]">
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4">
                <div className="relative mb-6">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center border border-slate-200 shadow-premium-sm">
                    <Clock size={28} className="text-slate-300" />
                  </div>
                  <div className="absolute inset-0 rounded-2xl animate-pulse" style={{ boxShadow: '0 0 0 4px rgba(148, 163, 184, 0.08)' }} />
                </div>
                <h3 className="text-slate-700 font-semibold text-sm mb-1.5">No versions yet</h3>
                <p className="text-slate-400 text-xs leading-relaxed text-center max-w-[14rem]">
                  Each generation creates a version snapshot you can revisit anytime.
                </p>
              </div>
            ) : (
              <div className="relative pl-6">
                {/* Timeline line */}
                <div className="absolute left-[14px] top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent" />
                {[...versions].reverse().map((ver, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isActive = currentVersionIndex === idx;
                const isExpanded = expandedVersionIndex === idx;
                return (
                  <div key={ver.id} className="relative mb-0.5 animate-fade-in" style={{ animationDelay: `${reversedIdx * 40}ms` }}>
                    {/* Timeline dot */}
                    <div className={`absolute left-[-18px] top-[14px] w-[9px] h-[9px] rounded-full border-2 z-[2] transition-all duration-300 ${
                      isActive
                        ? 'border-blue-500 bg-blue-100 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]'
                        : 'border-slate-300 bg-white'
                    }`} />

                    {/* Version card */}
                    <div
                      onClick={() => toggleExpandVersion(idx)}
                      className={`relative cursor-pointer rounded-xl border transition-all duration-200 overflow-hidden ${
                        isActive
                          ? 'bg-white border-blue-200/60 active-version-glow'
                          : 'bg-white/80 border-transparent hover:border-slate-200 hover:bg-white hover:shadow-premium-sm'
                      }`}
                    >
                      <div className="px-3.5 py-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Version badge */}
                          <div className={`shrink-0 h-[22px] min-w-[38px] px-2 rounded-md flex items-center justify-center text-[10px] font-bold tracking-wide transition-all duration-200 ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                              : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                          }`}>
                            v{idx + 1}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span className={`block text-[13px] leading-[1.35] transition-colors truncate ${
                                isActive ? 'text-slate-900 font-semibold' : 'text-slate-600'
                              }`}>
                                {ver.prompt}
                              </span>
                              {idx === 0 && (
                                <span className="shrink-0 text-[8px] font-bold px-1.5 py-[2px] rounded-full bg-slate-100 text-slate-400 border border-slate-200 uppercase tracking-wider mt-0.5">
                                  Initial
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] font-medium">
                              <span className={isActive ? 'text-blue-500' : 'text-slate-400'}>
                                {ver.timestamp}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 px-1.5 py-[2px] rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[9px] font-bold uppercase tracking-wider">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                  Active
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight
                            size={14}
                            className={`shrink-0 mt-1 transition-all duration-200 ${
                              isExpanded ? 'rotate-90 text-blue-500' : isActive ? 'text-blue-400' : 'text-slate-300'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="mt-2 ml-2 mr-0 mb-2 version-expand-enter">
                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-premium-md">
                          <div className="space-y-4">
                            {/* Prompt */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-1 h-3 rounded-full bg-blue-400" />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">Prompt</span>
                              </div>
                              <div className="text-[13px] text-slate-700 font-medium leading-relaxed bg-slate-50/80 p-3 rounded-lg border border-slate-100">
                                {ver.prompt}
                              </div>
                            </div>

                            {/* Metadata */}
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 border-t border-slate-100">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.10em]">Modified</span>
                                <span className="text-xs text-slate-600 font-medium mt-0.5">{ver.timestamp}</span>
                              </div>
                              {ver.editSummary && (
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.10em]">Summary</span>
                                  <span className="text-xs text-slate-600 font-medium mt-0.5 truncate">{ver.editSummary}</span>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); switchVersion(idx); }}
                                className="btn-premium btn-premium-primary py-2 text-xs"
                              >
                                <Play size={13} />
                                Restore
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); copyVersionCode(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs"
                              >
                                <Copy size={13} />
                                Copy
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); downloadVersion(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs"
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
          
          {/* Prompt/Chat Sidebar (Left) */}
          <div className="w-full md:w-[360px] lg:w-[420px] min-h-0 overflow-hidden flex flex-col bg-white border-r border-slate-200/60 z-20 flex-shrink-0 shadow-premium-lg relative">
            {/* Subtle atmospheric gradient */}
            <div className="absolute inset-0 pointer-events-none z-0 prompt-atmosphere" />

            <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 pt-8 lg:pt-10 pb-4 flex flex-col justify-start relative z-[1] chat-scrollbar">
              <div className="max-w-2xl w-full mx-auto space-y-6 animate-fade-in">

                {/* Header Section */}
                <div className={generatedCode ? 'refine-card' : 'relative'}>
                  {!generatedCode && (
                    <div className="pointer-events-none absolute -top-8 left-0 right-0 h-44 hero-atmosphere" aria-hidden="true" />
                  )}
                  <div className="space-y-4 relative">
                    {generatedCode ? (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        <span className="text-[13px] font-bold text-blue-600 uppercase tracking-[0.14em]">Editing</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5 pt-0.5">
                        <span className="orion-belt" aria-hidden="true">
                          <span className="orion-dot" />
                          <span className="orion-dot orion-dot-mid" />
                          <span className="orion-dot" />
                        </span>
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.18em]">From idea to running app</span>
                      </div>
                    )}
                    <h2 className="text-[2.15rem] lg:text-[2.55rem] font-bold tracking-[-0.035em] leading-[1.05] text-slate-900">
                      {generatedCode ? (
                        <>Refine <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">your app</span></>
                      ) : (
                        <>What do you want to <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">build?</span></>
                      )}
                    </h2>
                    <p className="text-slate-700 text-[16px] leading-relaxed max-w-[34ch]">
                      {generatedCode
                        ? "Describe what to change, add, or fix."
                        : "Describe an idea in plain words and Orion turns it into a complete, working app."}
                    </p>
                  </div>
                </div>

                {/* Suggestions - Only show when no app is generated */}
                {!generatedCode && (
                  <div className="space-y-4 animate-fade-in" style={{ animationDelay: '0.08s' }}>
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-0.5 rounded-full bg-slate-300" aria-hidden="true" />
                      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.18em]">
                        Try a starter
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {suggestedPrompts.map((suggestion, idx) => {
                        const StarterIcon = starterIcons[idx];
                        return (
                          <button
                            key={idx}
                            onClick={() => setPrompt(suggestion)}
                            className={`group flex items-center justify-between gap-3 text-left px-4 py-3.5 bg-white/70 border border-slate-200/90 rounded-xl transition-all hover:border-blue-300 hover:bg-white hover:shadow-premium-md suggestion-card animate-stagger-${idx + 1} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-blue-50 flex items-center justify-center text-slate-500 group-hover:text-blue-600 transition-colors">
                                <StarterIcon size={18} />
                              </span>
                              <span className="text-[15px] text-slate-800 group-hover:text-slate-900 font-medium leading-snug transition-colors">{suggestion}</span>
                            </div>
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors duration-200 flex-shrink-0 group-hover:translate-x-0.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50/80 border border-red-100 p-4 rounded-xl backdrop-blur-sm animate-fade-in">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 bg-red-100 rounded-lg text-red-500 flex-shrink-0">
                        <RefreshCw size={15} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-0.5">Error</p>
                        <p className="text-[13px] text-red-800 font-medium leading-snug">
                          {error}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Bottom Input Area */}
            <div className="shrink-0 p-4 pt-3 border-t border-slate-200/60 bg-white/80 backdrop-blur-md relative z-[1]">
              <div className="bg-white rounded-2xl shadow-premium-lg border border-slate-200 overflow-hidden transition-all input-glow">
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
                  className="w-full h-32 px-4 pt-4 pb-3 outline-none resize-none text-slate-800 placeholder:text-slate-400 text-[14px] leading-6 bg-transparent"
                  disabled={isGenerating}
                />
                {!generatedCode && versions.length === 0 && (
                  <div className="px-4 pb-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="h-3 w-0.5 rounded-full bg-slate-300" aria-hidden="true" />
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.18em]">
                          Optimize for
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {INITIAL_LAYOUT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = initialLayoutTarget === option.id;

                          return (
                            <label
                              key={option.id}
                              className={`layout-selector flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 transition-all ${
                                isSelected
                                  ? 'layout-selector-selected'
                                  : 'border-slate-200 bg-white/80 hover:border-slate-300'
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
                              <Icon size={13} className={isSelected ? 'text-blue-600' : 'text-slate-400'} />
                              <span className={`text-xs font-semibold ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3">
                  {!isGenerating && prompt.trim() && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] select-none whitespace-nowrap">
                      <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 font-sans text-[9px] leading-none text-slate-500">⌘ ↵</kbd>
                      to build
                    </span>
                  )}
                  {isGenerating && (
                    <button
                      onClick={() => {
                        if (abortControllerRef.current) {
                          abortControllerRef.current.abort();
                          abortControllerRef.current = null;
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      isGenerating
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                        : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-premium-md hover:shadow-premium-lg hover:brightness-105 active:scale-[0.99]'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        {generatedCode ? "Updating..." : "Building..."}
                      </>
                    ) : (
                      <>
                        {generatedCode ? <Edit2 size={16} /> : <Wand2 size={16} />}
                        {generatedCode ? "Update" : "Build"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview/Device Area (Right) */}
          <div className="flex-1 min-h-0 bg-slate-200/60 flex flex-col relative z-0 inset-shadow-preview">
            
            {/* View Toggles */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-200/80 bg-white">
              <div className="flex bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Play size={14} className="mr-1.5" /> Preview
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'code' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <TerminalSquare size={14} className="mr-1.5" /> Code
                </button>
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
                  className="relative shrink-0 flex items-center justify-center"
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
                  {previewMode === 'mobile' ? (
                    <>
                      {/* Notch */}
                      <div className="absolute top-0 inset-x-0 flex justify-center z-20 pt-2">
                        <div className="w-28 h-7 bg-[#0f172a] rounded-2xl flex items-center justify-center">
                           <div className="w-10 h-1 bg-slate-800 rounded-full"></div>
                           <div className="w-1.5 h-1.5 bg-slate-800 rounded-full ml-2"></div>
                        </div>
                      </div>
                    </>
                  ) : (
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
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
                          <div className="w-14 h-14 rounded-xl bg-white shadow-sm border border-slate-200 flex items-center justify-center mb-4">
                             {previewMode === 'mobile' ? (
                               <Smartphone size={24} className="text-slate-300" />
                             ) : (
                               <Monitor size={24} className="text-slate-300" />
                             )}
                           </div>
                          <h4 className="font-semibold text-slate-700 text-sm mb-1">
                            {previewMode === 'mobile' ? 'Mobile Preview' : 'Desktop Preview'}
                          </h4>
                          <p className="text-xs text-slate-400 max-w-[14rem] leading-relaxed">
                            Your app will appear here after building.
                          </p>
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
                        <h3 className="text-sm font-semibold text-slate-900 mb-1">Building...</h3>
                        <p className="text-xs text-slate-500 animate-pulse">Generating HTML, CSS & JavaScript</p>
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
                <div className="w-full h-full bg-[#1a1b26] rounded-lg overflow-hidden shadow-lg border border-slate-800/50 flex flex-col">
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
