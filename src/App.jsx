import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { 
  Wand2, 
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
  Plus,
  Edit2,
  Clock,
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
  LogOut
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { useAuth } from './components/AuthContext';
// --- Constants ---
const SURGICAL_EDIT_TOOL = {
  type: 'function',
  function: {
    name: 'apply_surgical_edits',
    description: 'Applies precise search-and-replace edits to the current code.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'The exact code snippet to find.' },
              replace: { type: 'string', description: 'The new code to replace it with.' }
            },
            required: ['search', 'replace']
          }
        }
      },
      required: ['edits']
    }
  }
};

const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a complete, self-contained HTML file (with inline CSS and JS) that implements the user's requested app.

CRITICAL RULES:
1. Output ONLY valid, raw HTML code or use the provided tools for edits.
2. DO NOT wrap the output in markdown formatting (e.g., no \`\`\`html or \`\`\` blocks).
3. Follow the platform-targeting instructions in the user request exactly.
4. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for styling.
5. Include modern UI elements, rounded corners, good typography, and smooth interactions.
6. Ensure any JavaScript is fully functional and self-contained within a <script> tag.
7. For any mobile or responsive app, account for phone safe areas (viewport-fit=cover and safe-area-inset padding).

STABILITY TIPS:
- When using tools, include enough context in SEARCH blocks to ensure a unique match.
- For complex apps, use "Landmark Comments" (e.g., <!-- @section: logic -->) as anchors for reliable surgical edits.

Do not include any explanations, markdown markers, or text outside of these formats.`;

const getSafeAreaInstruction = (layoutTarget) => {
  if (layoutTarget === 'desktop') return '';

  return ' Respect modern phone safe areas: include a viewport meta tag with viewport-fit=cover and pad edge-aligned headers, footers, and fixed controls with env(safe-area-inset-top/right/bottom/left) so nothing is hidden by a notch or home indicator.';
};

const PROVIDER_OPTIONS = [
  {
    id: 'zai',
    label: 'Orion AI',
    description: 'High-performance generation',
    icon: Code2
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Universal model access',
    icon: Sparkles
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'OpenAI-compatible endpoint',
    icon: TerminalSquare
  }
];

const DEFAULT_PROVIDER = PROVIDER_OPTIONS[0].id;
const PROVIDER_OPTION_MAP = Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option]));
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

const applySurgicalEdits = (currentCode, edits) => {
  if (!currentCode || !edits || !Array.isArray(edits)) return { success: false, error: 'Invalid edit format' };

  const normalizeLine = (line) => line.trim().replace(/\s+/g, ' ');
  let newCode = currentCode;
  const appliedSearchStrings = new Set();

  for (const block of edits) {
    const { search: searchStr, replace: replaceStr } = block;
    if (!searchStr) continue;

    // 1. Try exact match first
    if (newCode.includes(searchStr)) {
      newCode = newCode.split(searchStr).join(replaceStr);
      appliedSearchStrings.add(searchStr);
      continue;
    }

    // 2. Deduplicate / Already applied check
    if (appliedSearchStrings.has(searchStr)) continue;

    // 3. Fuzzy line-by-line match
    const codeLines = newCode.split(/\r?\n/);
    const searchLines = searchStr.split(/\r?\n/);
    const normalizedSearchLines = searchLines.map(normalizeLine);
    
    let matchIndex = -1;
    for (let i = 0; i <= codeLines.length - searchLines.length; i++) {
      let isMatch = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (normalizeLine(codeLines[i + j]) !== normalizedSearchLines[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex !== -1) {
      const beforeLines = codeLines.slice(0, matchIndex);
      const afterLines = codeLines.slice(matchIndex + searchLines.length);
      newCode = [...beforeLines, replaceStr, ...afterLines].join('\n');
      appliedSearchStrings.add(searchStr);
    } else {
      return { 
        success: false, 
        error: `Search block not found: "${searchStr.substring(0, 100)}..."`,
        failedBlock: searchStr 
      };
    }
  }

  return { success: true, code: newCode };
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
  provider = 'zai',
  systemPrompt,
  userText,
  onChunk = null,
  temperature = 0.7,
  tools = null,
  tool_choice = null,
  retryCount = 0
}) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  
  let apiKey, model, baseUrl;
  
  if (provider === 'openrouter') {
    apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    model = import.meta.env.VITE_OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
    baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
  } else if (provider === 'custom') {
    apiKey = import.meta.env.VITE_CUSTOM_API_KEY;
    model = import.meta.env.VITE_CUSTOM_MODEL || 'gpt-4o';
    baseUrl = import.meta.env.VITE_CUSTOM_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  } else {
    apiKey = import.meta.env.VITE_ZAI_API_KEY;
    model = import.meta.env.VITE_ZAI_MODEL || 'glm-4-plus';
    baseUrl = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
  }

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'Orion';
    }

    const bodyObj = {
      model,
      stream: !!onChunk,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      temperature
    };
    if (tools) bodyObj.tools = tools;
    if (tool_choice) bodyObj.tool_choice = tool_choice;

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj)
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message;
    }

    // Streaming implementation
    let text = '';
    let toolCallsBuffer = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
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
              onChunk(delta.content);
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0;
                if (!toolCallsBuffer[idx]) toolCallsBuffer[idx] = { id: tc.id, function: { name: tc.function?.name, arguments: '' } };
                if (tc.function?.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    return { content: text, tool_calls: toolCallsBuffer.filter(Boolean) };
  } catch (err) {
    if (retryCount < delays.length) {
      await new Promise(r => setTimeout(r, delays[retryCount]));
      return requestModelText({
        provider, systemPrompt, userText, onChunk, temperature, tools, tool_choice, retryCount: retryCount + 1
      });
    }
    throw new Error(err.message || 'Failed to generate app.');
  }
};

const generateAppCode = async (
  prompt,
  currentCode = null,
  provider = 'zai',
  onChunk = null,
  layoutTarget = 'both'
) => {
  if (!currentCode) {
    const userText = buildInitialGenerationPrompt(prompt, layoutTarget);
    const message = await requestModelText({ provider, systemPrompt: HTML_SYSTEM_PROMPT, userText, onChunk, temperature: 0.7 });
    return {
      code: sanitizeHtmlResponse(message.content || message),
      editMode: 'full-generation',
      editSummary: 'Initial app generation.'
    };
  }

  // REFINEMENT MODE: Self-healing surgical loop
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const userMessage = lastError 
        ? `Surgical edit failed: ${lastError}. Please try again with a more precise SEARCH block that exists EXACTLY in the current code.`
        : `Current App Code:\n\`\`\`html\n${currentCode}\n\`\`\`\n\nTask: ${prompt}. Use apply_surgical_edits to update the app.`;

      const message = await requestModelText({
        provider,
        systemPrompt: HTML_SYSTEM_PROMPT,
        userText: userMessage,
        onChunk,
        temperature: 0.1,
        tools: [SURGICAL_EDIT_TOOL],
        tool_choice: { type: 'function', function: { name: 'apply_surgical_edits' } }
      });

      const toolCall = message.tool_calls?.[0];
      if (!toolCall) throw new Error("AI did not use the surgical edit tool.");

      const { edits } = JSON.parse(toolCall.function.arguments);
      const result = applySurgicalEdits(currentCode, edits);

      if (result.success) {
        return { code: result.code, editMode: 'surgical', editSummary: prompt };
      } else {
        console.warn(`Surgical attempt ${attempt} failed:`, result.error);
        lastError = result.error;
      }
    } catch (e) {
      console.error(`Attempt ${attempt} error:`, e);
      lastError = e.message;
    }
  }

  throw new Error(`Failed to apply updates after 3 attempts. Last error: ${lastError}`);
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
  const [apiProvider, setApiProvider] = useState(() => {
    const storedProvider = localStorage.getItem('orion-api-provider');
    return PROVIDER_OPTION_MAP[storedProvider] ? storedProvider : DEFAULT_PROVIDER;
  });
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
  const { user, signOut } = useAuth();
  const previewContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const codePanelCode = isGenerating ? (streamingGeneratedCode || generatedCode) : generatedCode;
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

  // --- Mobile Touch Scroll Simulation ---
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || previewMode !== 'mobile' || !generatedCode) return;

    let cleanupFn = null;

    const setupTouchSimulation = () => {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) return;

      let isDragging = false;
      let hasMoved = false;
      let startX = 0;
      let startY = 0;
      let lastX = 0;
      let lastY = 0;
      let velocityX = 0;
      let velocityY = 0;
      let momentumId = null;
      let suppressClick = false;

      const scrollbarStyle = doc.createElement('style');
      scrollbarStyle.textContent = `
        * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        *::-webkit-scrollbar {
          display: none !important;
        }
      `;
      doc.head.appendChild(scrollbarStyle);

      const findMainScrollElement = () => {
        const candidates = [
          doc.scrollingElement,
          doc.documentElement,
          doc.body,
        ];
        for (const el of candidates) {
          if (el && el.scrollHeight > el.clientHeight + 1) return el;
        }
        for (const child of doc.body.children) {
          const style = win.getComputedStyle(child);
          const overflow = (style.overflowY || '') + (style.overflow || '');
          if (/(auto|scroll)/.test(overflow) && child.scrollHeight > child.clientHeight + 1) {
            return child;
          }
        }
        return doc.scrollingElement || doc.documentElement || doc.body;
      };

      const mainScrollEl = findMainScrollElement();

      const isFormControl = (el) => {
        const tag = el.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return true;
        if (el.isContentEditable) return true;
        return false;
      };

      const touchStyle = doc.createElement('style');
      touchStyle.textContent = `
        html, body {
          touch-action: none !important;
          overscroll-behavior: none !important;
        }
      `;
      doc.head.appendChild(touchStyle);

      let pointerCaptureTarget = null;

      const onPointerDown = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (isFormControl(e.target)) return;

        isDragging = true;
        hasMoved = false;
        suppressClick = false;
        startX = e.clientX;
        startY = e.clientY;
        lastX = e.clientX;
        lastY = e.clientY;
        velocityX = 0;
        velocityY = 0;

        try {
          e.target.setPointerCapture(e.pointerId);
          pointerCaptureTarget = e.target;
        } catch (err) { void err; }

        doc.body.style.userSelect = 'none';
        doc.body.style.webkitUserSelect = 'none';
        doc.body.style.MozUserSelect = 'none';

        if (momentumId) {
          cancelAnimationFrame(momentumId);
          momentumId = null;
        }

        e.preventDefault();
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!hasMoved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          hasMoved = true;
          suppressClick = true;
          if (e.pointerType === 'mouse') {
            doc.documentElement.style.cursor = 'grabbing';
          }
        }

        if (!hasMoved) return;

        const moveX = e.clientX - lastX;
        const moveY = e.clientY - lastY;

        velocityX = velocityX * 0.6 + moveX * 0.4;
        velocityY = velocityY * 0.6 + moveY * 0.4;

        mainScrollEl.scrollTop -= moveY;
        mainScrollEl.scrollLeft -= moveX;

        lastX = e.clientX;
        lastY = e.clientY;

        e.preventDefault();
      };

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;

        try {
          if (pointerCaptureTarget) {
            pointerCaptureTarget.releasePointerCapture(e.pointerId);
            pointerCaptureTarget = null;
          }
        } catch (err) { void err; }

        doc.documentElement.style.cursor = '';
        doc.body.style.userSelect = '';
        doc.body.style.webkitUserSelect = '';
        doc.body.style.MozUserSelect = '';

        if (!hasMoved) return;

        e.preventDefault();
        e.stopPropagation();

        const applyMomentum = () => {
          if (Math.abs(velocityX) < 0.3 && Math.abs(velocityY) < 0.3) {
            momentumId = null;
            return;
          }

          velocityX *= 0.975;
          velocityY *= 0.975;

          mainScrollEl.scrollTop -= velocityY;
          mainScrollEl.scrollLeft -= velocityX;

          momentumId = requestAnimationFrame(applyMomentum);
        };

        momentumId = requestAnimationFrame(applyMomentum);
      };

      const onClick = (e) => {
        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick = false;
        }
      };

      const listenerOptions = { capture: true, passive: false };

      doc.addEventListener('pointerdown', onPointerDown, listenerOptions);
      doc.addEventListener('pointermove', onPointerMove, listenerOptions);
      doc.addEventListener('pointerup', onPointerUp, listenerOptions);
      doc.addEventListener('pointercancel', onPointerUp, listenerOptions);
      doc.addEventListener('click', onClick, true);

      doc.documentElement.style.cursor = 'grab';

      cleanupFn = () => {
        doc.removeEventListener('pointerdown', onPointerDown, listenerOptions);
        doc.removeEventListener('pointermove', onPointerMove, listenerOptions);
        doc.removeEventListener('pointerup', onPointerUp, listenerOptions);
        doc.removeEventListener('pointercancel', onPointerUp, listenerOptions);
        doc.removeEventListener('click', onClick, true);
        if (momentumId) cancelAnimationFrame(momentumId);
        if (scrollbarStyle.parentNode) scrollbarStyle.parentNode.removeChild(scrollbarStyle);
        if (touchStyle.parentNode) touchStyle.parentNode.removeChild(touchStyle);
        try {
          doc.documentElement.style.cursor = '';
          doc.body.style.userSelect = '';
          doc.body.style.webkitUserSelect = '';
          doc.body.style.MozUserSelect = '';
        } catch (err) { void err; }
      };
    };

    const onLoad = () => {
      if (cleanupFn) cleanupFn();
      cleanupFn = null;
      setupTouchSimulation();
    };

    iframe.addEventListener('load', onLoad);
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        setupTouchSimulation();
      }
    } catch (err) { void err; }

    return () => {
      iframe.removeEventListener('load', onLoad);
      if (cleanupFn) cleanupFn();
    };
  }, [generatedCode, previewMode]);

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
  const loadUserProjects = useCallback(async () => {
    try {
      if (!user) return [];
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const projects = data.map(row => ({
        id: row.id,
        name: row.name,
        ...row.data,
        lastModified: row.updated_at
      }));

      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      return [];
    }
  }, [user]);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (error || !data) {
        localStorage.removeItem('orion-current-project-id');
        return;
      }

      clearStreamingState();
      setProjectName(data.name || 'Untitled App');
      const projectData = data.data || {};
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

  const saveProject = useCallback(async (params = {}) => {
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

      await supabase
        .from('projects')
        .upsert({
          id: projectId,
          user_id: user.id,
          name: nameToSave,
          data: projectData,
          updated_at: new Date().toISOString()
        });

      if (!currentProjectId || currentProjectId !== projectId) {
        setCurrentProjectId(projectId);
        localStorage.setItem('orion-current-project-id', projectId);
      }
      loadUserProjects();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, user, loadUserProjects]);

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

  // --- Data Persistence ---
  useEffect(() => {
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
    "A daily habit tracker with checkboxes for 5 custom habits."
  ];

  const handleSaveSettings = () => {
    localStorage.setItem('orion-api-provider', apiProvider);
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
    
    const currentPrompt = prompt;
    setPrompt(''); // Clear input so user can easily type their next refinement

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, apiProvider, (chunk) => {
        streamingBufferRef.current = `${streamingBufferRef.current}${chunk.replace(/\s+/g, ' ')}`.slice(-MARQUEE_MAX_BUFFER_LENGTH);
        setStreamingCode(streamingBufferRef.current.trim());
        streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
        setStreamingGeneratedCode(sanitizeHtmlResponse(streamingGeneratedCodeRef.current));
      }, initialLayoutTarget);
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
      await supabase
        .from('projects')
        .update({ name: trimmedName, updated_at: new Date().toISOString() })
        .eq('id', project.id);

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
      await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

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
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-sm shadow-indigo-200">
            <Sparkles size={22} />
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Orion</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleNewApp}
            className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-medium px-3 py-2 rounded-lg hover:bg-indigo-50/60 transition-colors text-sm"
            title="Start a new app"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New</span>
          </button>

          <button
            onClick={() => setIsProjectsListOpen(true)}
            className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-medium px-3 py-2 rounded-lg hover:bg-indigo-50/60 transition-colors text-sm"
          >
            <FolderOpen size={16} />
            <span className="hidden sm:inline">Apps</span>
          </button>

          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-medium px-3 py-2 rounded-lg hover:bg-indigo-50/60 transition-colors text-sm"
            title={isHistoryOpen ? "Hide history panel" : "Show history panel"}
          >
            {isHistoryOpen ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="hidden sm:inline">History</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-medium px-3 py-2 rounded-lg hover:bg-indigo-50/60 transition-colors text-sm"
            title="Settings"
          >
            <Settings size={16} />
            <span className="hidden sm:inline">Settings</span>
           </button>

           <button
             onClick={signOut}
             className="flex items-center gap-1.5 text-slate-400 hover:text-red-500 font-medium px-3 py-2 rounded-lg hover:bg-red-50/60 transition-colors text-sm"
             title="Sign out"
           >
             <LogOut size={16} />
             <span className="hidden sm:inline">{user?.email?.split('@')[0]}</span>
           </button>


           <div className="hidden sm:flex items-center space-x-2 ml-2 pl-2 border-l border-slate-200">
            {activeTab === 'preview' && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
                <button
                  onClick={() => setPreviewMode('mobile')}
                  className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    previewMode === 'mobile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title="Preview as mobile"
                >
                  <Smartphone size={14} className="mr-1.5" /> Mobile
                </button>
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                    previewMode === 'desktop' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
                   isAutoZoom ? 'text-indigo-600 bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
                      : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
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
                      : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
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
                 className="text-slate-500 hover:text-slate-700 bg-white p-2 rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all active:scale-[0.97]"
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
              <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">AI Provider</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PROVIDER_OPTIONS.map((providerOption) => {
                    const Icon = providerOption.icon;
                    return (
                      <button
                        key={providerOption.id}
                        onClick={() => setApiProvider(providerOption.id)}
                        className={`flex flex-col items-start p-4 rounded-2xl border-2 transition-all ${
                          apiProvider === providerOption.id
                            ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                            : 'border-slate-100 hover:border-slate-200 bg-white'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-xl mb-3 flex items-center justify-center ${
                          apiProvider === providerOption.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}>
                          <Icon size={18} />
                        </div>
                        <span className={`text-sm font-semibold ${apiProvider === providerOption.id ? 'text-indigo-900' : 'text-slate-700'}`}>
                          {providerOption.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {providerOption.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-8 py-5 flex justify-end gap-3">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="rounded-lg px-5 py-2 bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-sm transition-colors active:scale-[0.98]"
              >
                Save
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
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
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
                          className="text-left p-5 pr-16 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group relative overflow-hidden bg-white hover:-translate-y-0.5 active:scale-[0.99] min-h-[100px]"
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
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
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
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
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
                              <h4 className="font-semibold text-slate-900 mb-1.5 text-base truncate group-hover:text-indigo-600 transition-colors">{project.name}</h4>
                              <p className="text-xs text-slate-400 font-medium mb-3 flex items-center">
                                <Clock size={12} className="mr-1.5 text-slate-300" />
                                {project.lastModified?.toDate?.() ? project.lastModified.toDate().toLocaleString() : 'Just now'}
                              </p>
                              <div className="flex items-center mt-2">
                                <div className="flex -space-x-1.5 overflow-hidden mr-3">
                                   {[...Array(Math.min(3, project.versions?.length || 0))].map((_, i) => (
                                     <div key={i} className="inline-block h-6 w-6 rounded-lg ring-2 ring-white bg-indigo-100 border border-indigo-200 flex items-center justify-center">
                                       <span className="text-[10px] font-bold text-indigo-600">v{i+1}</span>
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
                                className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-600"
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
                              <ChevronRight className="text-indigo-600" size={24} />
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
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
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
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Edit2 size={16} />
                  </div>
                  <input
                    autoFocus
                    type="text"
                    value={tempProjectName}
                    onChange={(e) => setTempProjectName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
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
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
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
            <PanelLeftOpen size={14} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
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
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center text-indigo-500 flex-shrink-0 border border-indigo-100">
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
                        ? 'border-indigo-500 bg-indigo-100 shadow-[0_0_0_4px_rgba(99,102,241,0.12)]'
                        : 'border-slate-300 bg-white'
                    }`} />

                    {/* Version card */}
                    <div
                      onClick={() => toggleExpandVersion(idx)}
                      className={`relative cursor-pointer rounded-xl border transition-all duration-200 overflow-hidden ${
                        isActive
                          ? 'bg-white border-indigo-200/60 active-version-glow'
                          : 'bg-white/80 border-transparent hover:border-slate-200 hover:bg-white hover:shadow-premium-sm'
                      }`}
                    >
                      <div className="px-3.5 py-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Version badge */}
                          <div className={`shrink-0 h-[22px] min-w-[38px] px-2 rounded-md flex items-center justify-center text-[10px] font-bold tracking-wide transition-all duration-200 ${
                            isActive
                              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
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
                              <span className={isActive ? 'text-indigo-500' : 'text-slate-400'}>
                                {ver.timestamp}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 px-1.5 py-[2px] rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 text-[9px] font-bold uppercase tracking-wider">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                  Active
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight
                            size={14}
                            className={`shrink-0 mt-1 transition-all duration-200 ${
                              isExpanded ? 'rotate-90 text-indigo-500' : isActive ? 'text-indigo-400' : 'text-slate-300'
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
                                <div className="w-1 h-3 rounded-full bg-indigo-400" />
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
              <div className="max-w-2xl w-full mx-auto space-y-8 animate-fade-in">

                {/* Header Section */}
                <div className={generatedCode ? 'refine-card' : ''}>
                  <div className="space-y-3">
                    {generatedCode && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        <span className="text-[11px] font-bold text-indigo-500 uppercase tracking-[0.12em]">Editing</span>
                      </div>
                    )}
                    <h2 className="text-[1.65rem] lg:text-[1.8rem] font-bold text-slate-900 tracking-tight leading-[1.2]">
                      {generatedCode ? "Refine your app" : "What do you want to build?"}
                    </h2>
                    <p className="text-slate-500 text-[14px] leading-relaxed">
                      {generatedCode
                        ? "Describe what to change, add, or fix."
                        : "Describe your app in natural language and Orion will generate a complete, working application."}
                    </p>
                  </div>
                </div>

                {/* Suggestions - Only show when no app is generated */}
                {!generatedCode && (
                  <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-[2px] rounded-full bg-slate-300" />
                      <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.12em]">
                        Try a starter
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {suggestedPrompts.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setPrompt(suggestion)}
                          className={`text-left px-4 py-3 bg-white/90 border border-slate-200 rounded-xl transition-all group flex items-center justify-between suggestion-card animate-stagger-${idx + 1}`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-[13px] text-slate-600 group-hover:text-slate-900 leading-snug transition-colors truncate">{suggestion}</span>
                          </div>
                          <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400 transition-all duration-200 flex-shrink-0 ml-3 group-hover:translate-x-0.5" />
                        </button>
                      ))}
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
            <div className="shrink-0 p-4 border-t border-slate-200/60 bg-white/80 backdrop-blur-md relative z-[1]">
              <div className="bg-white rounded-2xl shadow-premium-md border border-slate-200 overflow-hidden transition-all input-glow">
                <textarea
                  id="prompt"
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={generatedCode ? "e.g. Make the background dark, add a reset button..." : "e.g. A minimalist task manager with categories..."}
                  className="w-full h-28 px-4 pt-4 pb-3 outline-none resize-none text-slate-800 placeholder:text-slate-400 text-[14px] leading-6 bg-transparent"
                  disabled={isGenerating}
                />
                {!generatedCode && versions.length === 0 && (
                  <div className="px-4 pb-3.5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.10em] mb-2.5">
                        Optimize for
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {INITIAL_LAYOUT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = initialLayoutTarget === option.id;

                          return (
                            <label
                              key={option.id}
                              className={`layout-selector flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-all ${
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
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.2)]' : 'bg-slate-300'}`} />
                              <Icon size={13} className={isSelected ? 'text-indigo-600' : 'text-slate-400'} />
                              <span className={`text-xs font-semibold ${isSelected ? 'text-indigo-700' : 'text-slate-600'}`}>{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3 flex justify-between items-center">
                  <div className="flex space-x-2" />
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`btn-premium py-2 px-5 text-[13px] ${
                      isGenerating
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                        : 'btn-premium-primary'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="animate-spin" size={15} />
                        {generatedCode ? "Updating..." : "Building..."}
                      </>
                    ) : (
                      <>
                        {generatedCode ? <Edit2 size={15} /> : <Wand2 size={15} />}
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
                          srcDoc={generatedCode}
                          className="w-full h-full border-none"
                          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
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
                          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto text-indigo-500" size={22} />
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
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-indigo-500/10 bg-[#1a1b26]/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-indigo-300 backdrop-blur-sm">
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
                       <div className="flex items-center justify-center h-full space-x-2.5 text-indigo-400/50 font-mono text-sm">
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
