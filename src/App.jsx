import React, { useState, useRef, useEffect, Suspense } from 'react';
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
  LogOut,
  User,
  FolderOpen,
  X,
  Copy,
  Check,
  Trash2,
  ZoomIn,
  ZoomOut,
  Monitor
} from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { 
  doc, 
  deleteDoc,
  setDoc,
  getDoc,
  collection, 
  query, 
  getDocs, 
  orderBy,
  serverTimestamp 
} from 'firebase/firestore';
const AuthModal = React.lazy(() => import('./components/AuthModal'));

// --- Constants ---
const HTML_SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a complete, self-contained HTML file (with inline CSS and JS) that implements the user's requested app.

CRITICAL RULES:
1. Output ONLY valid, raw HTML code.
2. DO NOT wrap the output in markdown formatting (e.g., no \`\`\`html or \`\`\` blocks).
3. The app MUST be fully responsive across mobile, tablet, and desktop breakpoints. It should work beautifully on a 375px mobile screen and also expand into a proper desktop layout at larger widths instead of staying in a phone-width column.
4. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for styling.
5. Include modern UI elements, rounded corners, good typography (import Google fonts if needed), and smooth interactions.
6. Ensure any JavaScript is fully functional and self-contained within a <script> tag.
7. Use responsive layout techniques such as breakpoint-based grids, multi-column desktop sections, adaptive spacing, and container widths that grow appropriately on larger screens.`;

const PROVIDER_OPTIONS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Multi-model API',
    icon: Layout
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Google Gemini Flash',
    icon: Sparkles
  },
  {
    id: 'chutes',
    label: 'Chutes',
    description: 'Chutes.ai LLM API',
    icon: TerminalSquare
  }
];

const DEFAULT_PROVIDER = PROVIDER_OPTIONS[0].id;
const PROVIDER_OPTION_MAP = Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option]));

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

// --- API Helper with Exponential Backoff ---
const requestModelText = async ({
  provider = 'openrouter',
  systemPrompt,
  userText,
  onChunk = null,
  temperature = 0.7,
  retryCount = 0
}) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  const openrouterKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const chutesKey = import.meta.env.VITE_CHUTES_API_KEY;
  const openrouterModel = import.meta.env.VITE_OPENROUTER_MODEL || 'openrouter/free';
  const geminiModel = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';
  const chutesModel = import.meta.env.VITE_CHUTES_MODEL || 'deepseek-ai/DeepSeek-V3-0324';

  try {
    let endpoint;
    let headers;
    let body;

    if (provider === 'gemini') {
      if (!geminiKey) throw new Error('Gemini API key is missing.');
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:${onChunk ? 'streamGenerateContent' : 'generateContent'}?key=${encodeURIComponent(geminiKey)}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({
        contents: [{ parts: [{ text: userText }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature }
      });
    } else if (provider === 'chutes') {
      if (!chutesKey) throw new Error('Chutes API key is missing.');
      endpoint = 'https://llm.chutes.ai/v1/chat/completions';
      headers = {
        'Authorization': `Bearer ${chutesKey}`,
        'Content-Type': 'application/json'
      };
      body = JSON.stringify({
        model: chutesModel,
        stream: !!onChunk,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
        temperature
      });
    } else {
      if (!openrouterKey) throw new Error('OpenRouter API key is missing.');
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      headers = {
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Orion App Generator',
        'Content-Type': 'application/json'
      };
      body = JSON.stringify({
        model: openrouterModel,
        stream: !!onChunk,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
        temperature
      });
    }

    const response = await fetch(endpoint, { method: 'POST', headers, body });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    let text = '';
    if (onChunk && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        if (provider === 'gemini') {
          // Gemini returns a JSON array: [ {object1}, {object2} ]
          // We parse individual objects from the stream.
          let startIdx;
          while ((startIdx = buffer.indexOf('{')) !== -1) {
            let depth = 0;
            let endIdx = -1;
            let inString = false;
            for (let i = startIdx; i < buffer.length; i++) {
              if (buffer[i] === '"' && buffer[i-1] !== '\\') inString = !inString;
              if (!inString) {
                if (buffer[i] === '{') depth++;
                else if (buffer[i] === '}') depth--;
                if (depth === 0) {
                  endIdx = i;
                  break;
                }
              }
            }
            
            if (endIdx !== -1) {
              const objStr = buffer.substring(startIdx, endIdx + 1);
              try {
                const json = JSON.parse(objStr);
                const textChunk = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (textChunk) {
                  text += textChunk;
                  onChunk(textChunk);
                }
              } catch {
                // Likely a partial object or not the format we expect
              }
              buffer = buffer.substring(endIdx + 1);
            } else {
              break; // Need more data for current object
            }
          }
        } else {
          // OpenRouter (SSE format)
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep last incomplete line
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6);
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const textChunk = json.choices[0]?.delta?.content || '';
                if (textChunk) {
                  text += textChunk;
                  onChunk(textChunk);
                }
              } catch {
                // Ignore incomplete SSE payloads between chunks.
              }
            }
          }
        }
      }
    } else {
      const result = await response.json();
      text = provider === 'gemini'
        ? result?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        : result.choices?.[0]?.message?.content || '';
    }
    return text;

  } catch (err) {
    if (retryCount < 5) {
      await new Promise(r => setTimeout(r, delays[retryCount]));
      return requestModelText({
        provider,
        systemPrompt,
        userText,
        onChunk,
        temperature,
        retryCount: retryCount + 1
      });
    }
    throw new Error(err.message || 'Failed to generate app.');
  }
};

const generateAppCode = async (
  prompt,
  currentCode = null,
  provider = 'openrouter',
  onChunk = null
) => {
  const userText = currentCode
    ? `Update the existing responsive web app based on this new request: "${prompt}". Return the FULL updated HTML document.

Preservation requirements:
- Start from the current HTML and keep unrelated markup, CSS, JS, attributes, text, ordering, and structure unchanged.
- Only modify the smallest necessary fragments to satisfy the request.
- Any non-requested difference is a bug.
- Do not rename ids/classes or restyle unrelated elements unless the request requires it.

Current complete HTML:
\`\`\`html
${currentCode}
\`\`\``
    : `Create a responsive web app based on this request: ${prompt}. It must look polished on mobile and also present a true desktop layout on larger screens.`;

  try {
    const rawHtml = await requestModelText({
      provider,
      systemPrompt: HTML_SYSTEM_PROMPT,
      userText,
      onChunk,
      temperature: currentCode ? 0.5 : 0.7
    });

    return {
      code: sanitizeHtmlResponse(rawHtml),
      editMode: currentCode ? 'full-rewrite' : 'full-generation',
      editSummary: currentCode ? 'Full rewrite from the current version.' : 'Initial app generation.'
    };
  } catch (error) {
    const generationReason = error instanceof Error ? error.message : 'Unknown generation failure.';
    throw new Error(`Unable to generate the updated app: ${generationReason}`);
  }
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
const MARQUEE_VISIBLE_WINDOW = 180;
const MARQUEE_TICK_MS = 80;
const MARQUEE_CHARS_PER_TICK = 6;
const PREVIEW_MODES = {
  mobile: {
    label: 'Mobile',
    width: 379,
    height: 800
  },
  desktop: {
    label: 'Desktop',
    width: 1440,
    height: 960
  }
};

const buildMarqueeLoop = (value) => {
  const normalized = (value || DEFAULT_MARQUEE_MESSAGE).replace(/\s+/g, ' ').trim();
  const windowed = normalized.length > MARQUEE_VISIBLE_WINDOW
    ? normalized.slice(-MARQUEE_VISIBLE_WINDOW)
    : normalized;
  let loop = windowed;

  while (loop.length < MARQUEE_MIN_LOOP_LENGTH) {
    loop += `${MARQUEE_SEPARATOR}${windowed}`;
  }

  return loop;
};

export default function App() {
  const [prompt, setPrompt] = useState('');
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
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
  const marqueeSegment = buildMarqueeLoop(streamingCode);
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isAutoZoom, setIsAutoZoom] = useState(true);
  const previewContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingQueueRef = useRef('');
  const marqueeBufferRef = useRef('');

  // --- Dynamic Zoom Logic ---
  useEffect(() => {
    if (!isGenerating) {
      streamingQueueRef.current = '';
      marqueeBufferRef.current = '';
      setStreamingCode('');
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!streamingQueueRef.current) return;

      const nextChunk = streamingQueueRef.current.slice(0, MARQUEE_CHARS_PER_TICK);
      streamingQueueRef.current = streamingQueueRef.current.slice(MARQUEE_CHARS_PER_TICK);
      marqueeBufferRef.current = (marqueeBufferRef.current + nextChunk).slice(-MARQUEE_VISIBLE_WINDOW);
      setStreamingCode(marqueeBufferRef.current);
    }, MARQUEE_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [isGenerating]);

  useEffect(() => {
    const calculateZoom = () => {
      if (!isAutoZoom || !previewContainerRef.current || activeTab !== 'preview') return;
      
      const container = previewContainerRef.current;
      const padding = 64; // Slightly more than p-6 (48px) for safety
      const availableHeight = container.clientHeight - padding;
      const availableWidth = container.clientWidth - padding;
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

  // --- Auto-save Name Changes ---
  useEffect(() => {
    if (!user || !currentProjectId) return;
    
    const timeoutId = setTimeout(() => {
      // Only save if name actually changed from what we have in the list
      const currentProjData = myProjects.find(p => p.id === currentProjectId);
      if (currentProjData && currentProjData.name === projectName) return;
      
      saveProject({ nameToSave: projectName });
    }, 2000);
    
    return () => clearTimeout(timeoutId);
  }, [projectName, user, currentProjectId, myProjects]);

  // --- Auth & Data Effects ---
  // --- Auth & Data Effects ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchAndResume = async () => {
      if (user) {
        const projects = await loadUserProjects(user.uid);
        const lastProjectId = localStorage.getItem('orion-current-project-id');
        
        // Migration: local progress -> account
        if (versions.length > 0 && !currentProjectId) {
          const projectId = Date.now().toString();
          const projectData = {
            name: projectName,
            versions: versions,
            currentVersionIndex: currentVersionIndex,
            lastModified: serverTimestamp()
          };
          try {
            await setDoc(doc(db, 'users', user.uid, 'projects', projectId), projectData);
            setCurrentProjectId(projectId);
            localStorage.setItem('orion-current-project-id', projectId);
            loadUserProjects(user.uid);
          } catch (err) {
            console.error("Error migrating anonymous project:", err);
          }
        } 
        // Resume: If no project is open, load from localStorage OR the most recent project
        else if (!currentProjectId) {
          const idToLoad = lastProjectId || (projects.length > 0 ? projects[0].id : null);
          if (idToLoad) {
            loadProjectById(user.uid, idToLoad);
          }
        }
      } else {
        setMyProjects([]);
        setCurrentProjectId(null);
      }
    };
    
    fetchAndResume();
  }, [user]);

  const loadProjectById = async (uid, projectId) => {
    try {
      const docRef = doc(db, 'users', uid, 'projects', projectId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setProjectName(data.name || 'Untitled App');
        setVersions(data.versions || []);
        setCurrentVersionIndex(data.currentVersionIndex ?? -1);
        if (data.versions && data.versions[data.currentVersionIndex]) {
          setGeneratedCode(data.versions[data.currentVersionIndex].code);
        }
        setCurrentProjectId(projectId);
        localStorage.setItem('orion-current-project-id', projectId);
      } else {
        localStorage.removeItem('orion-current-project-id');
      }
    } catch (err) {
      console.error("Error loading project by ID:", err);
    }
  };

  const loadUserProjects = async (uid) => {
    try {
      const q = query(
        collection(db, 'users', uid, 'projects'),
        orderBy('lastModified', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const projects = [];
      querySnapshot.forEach((doc) => {
        projects.push({ id: doc.id, ...doc.data() });
      });
      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      return [];
    }
  };

  const saveProject = async (params = {}) => {
    if (!user) return;
    
    // Allow overriding state values for immediate updates
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
        name: nameToSave,
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
        lastModified: serverTimestamp()
      };

      await setDoc(doc(db, 'users', user.uid, 'projects', projectId), projectData);
      
      if (!currentProjectId || currentProjectId !== projectId) {
        setCurrentProjectId(projectId);
        localStorage.setItem('orion-current-project-id', projectId);
      }
      loadUserProjects(user.uid);
    } catch (err) {
      console.error("Error saving project:", err);
    }
  };

  const loadProject = (project) => {
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    setVersions(project.versions);
    setCurrentVersionIndex(project.currentVersionIndex);
    setGeneratedCode(project.versions[project.currentVersionIndex].code);
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

    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    // Require naming for transition from Untitled or New App
    if ((projectName === 'Untitled App' || !projectName.trim()) && !currentProjectId) {
      setTempProjectName('');
      setShouldGenerateAfterNaming(true);
      setIsNamingModalOpen(true);
      return;
    }

    setIsGenerating(true);
    setStreamingCode('');
    streamingQueueRef.current = '';
    marqueeBufferRef.current = '';
    setError(null);
    setActiveTab('preview');
    
    const currentPrompt = prompt;
    setPrompt(''); // Clear input so user can easily type their next refinement

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, apiProvider, (chunk) => {
        streamingQueueRef.current = (streamingQueueRef.current + chunk.replace(/\s+/g, ' ')).slice(-4000);
      });
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
      
      // Auto-save if logged in
      if (user) {
        // We pass versions directly because state hasn't updated yet
        saveProject({
          versionsToSave: finalVersions,
          indexToSave: updatedVersions.length
        });
      }
      
    } catch (err) {
      setError(err.message);
      setPrompt(currentPrompt); // Restore prompt text on error
    } finally {
      setIsGenerating(false);
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
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    setShouldGenerateAfterNaming(false);
    setTempProjectName('');
    setIsNamingModalOpen(true);
  };

  const handleConfirmNaming = (e) => {
    e?.preventDefault();
    const trimmedName = tempProjectName.trim();
    if (!trimmedName) return;

    if (!shouldGenerateAfterNaming) {
      setGeneratedCode('');
      setPrompt('');
      setError(null);
      setVersions([]);
      setCurrentVersionIndex(-1);
      setCurrentProjectId(null);
      localStorage.removeItem('orion-current-project-id');
    }

    setProjectName(trimmedName);
    setTempProjectName('');
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
      setCurrentVersionIndex(index);
      setGeneratedCode(versions[index].code);
      if (user && currentProjectId) {
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
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const resetCurrentWorkspace = () => {
    setGeneratedCode('');
    setPrompt('');
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
    if (!user) return;

    const trimmedName = editingProjectName.trim();
    if (!trimmedName) return;

    if (trimmedName === (project.name || 'Untitled App')) {
      cancelProjectRename();
      return;
    }

    setRenamingProjectId(project.id);
    try {
      await setDoc(
        doc(db, 'users', user.uid, 'projects', project.id),
        {
          name: trimmedName,
          lastModified: serverTimestamp()
        },
        { merge: true }
      );

      setMyProjects(prev => prev.map((p) => (
        p.id === project.id
          ? { ...p, name: trimmedName }
          : p
      )));

      if (currentProjectId === project.id) {
        setProjectName(trimmedName);
      }

      cancelProjectRename();
      loadUserProjects(user.uid);
    } catch (err) {
      console.error('Error renaming project:', err);
      setRenamingProjectId(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!user || !projectToDelete) return;

    const projectId = projectToDelete.id;
    setDeletingProjectId(projectId);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'projects', projectId));

      setMyProjects(prev => prev.filter((project) => project.id !== projectId));

      if (editingProjectId === projectId) {
        cancelProjectRename();
      }

      if (currentProjectId === projectId) {
        resetCurrentWorkspace();
      }

      setProjectToDelete(null);
      setDeletingProjectId(null);
      loadUserProjects(user.uid);
    } catch (err) {
      console.error('Error deleting project:', err);
      setDeletingProjectId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-inner text-white">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Orion</h1>
            <p className="text-sm text-slate-600 font-semibold">AI-Powered Micro App Builder</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleNewApp}
            className="flex items-center gap-2 text-slate-600 hover:text-indigo-600 font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-all border border-transparent hover:border-indigo-100"
            title="Start a new app"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">New App</span>
          </button>

          {user && (
            <button
              onClick={() => setIsProjectsListOpen(true)}
              className="flex items-center gap-2 text-slate-600 hover:text-indigo-600 font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-all border border-transparent hover:border-indigo-100"
            >
              <FolderOpen size={18} />
              <span className="hidden sm:inline">My Apps</span>
            </button>
          )}
          
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="text-slate-400 hover:text-indigo-600 transition-all p-2 rounded-xl hover:bg-indigo-50 border border-transparent hover:border-indigo-100"
            title="Settings"
          >
            <Settings size={20} />
          </button>


          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
               <div className="h-9 w-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold border-2 border-white shadow-sm ring-1 ring-indigo-100">
                {user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors"
                title="Sign Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-md shadow-indigo-100"
            >
              <User size={18} />
              <span>Login</span>
            </button>
          )}

          <span className="hidden sm:inline px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-600 border border-slate-200">
            {PROVIDER_OPTION_MAP[apiProvider]?.label || PROVIDER_OPTION_MAP[DEFAULT_PROVIDER].label}
            </span>
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
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-fade-in">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">App Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-2 bg-slate-50 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Select AI Engine</label>
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
                        <span className={`text-sm font-bold ${apiProvider === providerOption.id ? 'text-indigo-900' : 'text-slate-700'}`}>
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
            <div className="bg-slate-50 px-8 py-6 flex justify-end gap-3">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="rounded-xl px-6 py-2.5 bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all active:scale-95"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}


      {isProjectsListOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-fade-in">
            <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                   <FolderOpen size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Saved Applications</h2>
                  <p className="text-slate-400 text-sm font-medium">Continue where you left off</p>
                </div>
              </div>
              <button
                onClick={() => setIsProjectsListOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-2.5 bg-slate-50 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-10 py-8 custom-scrollbar bg-slate-50/30">
              {myProjects.length === 0 ? (
                <div className="text-center py-20">
                  <div className="bg-slate-100 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border-2 border-dashed border-slate-200">
                    <History size={40} className="text-slate-300" />
                  </div>
                  <h3 className="text-slate-900 font-extrabold text-xl">Empty Canvas</h3>
                  <p className="text-slate-500 mt-2 max-w-xs mx-auto">You haven't built anything yet. Start your first app with Orion!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {myProjects.map((project) => (
                    <div
                          key={project.id}
                          className="text-left p-6 pr-20 rounded-3xl border border-slate-200 hover:border-indigo-500 hover:shadow-xl transition-all group relative overflow-hidden bg-white hover:-translate-y-1 active:scale-[0.98] min-h-[120px]"
                        >
                          <div className="flex items-start">
                            <div className="flex-1 pr-6">
                              {editingProjectId === project.id ? (
                        <div className="space-y-4">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rename App</label>
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
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                            placeholder="App name"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleProjectRename(project)}
                              disabled={!editingProjectName.trim() || renamingProjectId === project.id}
                              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
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
                              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 bg-slate-100"
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
                              <h4 className="font-extrabold text-slate-900 mb-2 text-lg truncate group-hover:text-indigo-600 transition-colors">{project.name}</h4>
                              <p className="text-xs text-slate-400 font-bold mb-4 flex items-center tracking-wider uppercase">
                                <Clock size={14} className="mr-2 text-indigo-400" />
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
                                <span className="text-[11px] font-extrabold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 uppercase tracking-tighter">
                                  {project.versions?.length || 1} versions
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
            <div className="bg-slate-50 border-t border-slate-100 p-8 flex justify-center">
               <button 
                  onClick={() => setIsProjectsListOpen(false)}
                  className="text-slate-400 hover:text-indigo-600 font-bold uppercase tracking-widest text-[11px]"
               >
                 Close Library
               </button>
            </div>
          </div>
        </div>
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-fade-in">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Delete Saved App</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">This action cannot be undone.</p>
              </div>
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-2 bg-slate-50 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-8 space-y-5">
              <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-slate-600 leading-relaxed">
                Delete <span className="font-bold text-slate-900">{projectToDelete.name || 'Untitled App'}</span> from your saved applications?
              </div>
              {currentProjectId === projectToDelete.id && (
                <p className="text-xs font-medium text-slate-500">
                  This app is currently open. Deleting it will clear the current workspace.
                </p>
              )}
            </div>
            <div className="bg-slate-50 px-8 py-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProject}
                disabled={deletingProjectId === projectToDelete.id}
                className={`inline-flex items-center gap-2 rounded-xl px-6 py-2.5 font-bold transition-all ${
                  deletingProjectId === projectToDelete.id
                    ? 'bg-red-200 text-white cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                <Trash2 size={16} />
                {deletingProjectId === projectToDelete.id ? 'Deleting...' : 'Delete App'}
              </button>
            </div>
          </div>
        </div>
      )}


      {isNamingModalOpen && (
        <div className="fixed inset-0 z-[65] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-fade-in">
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Name Your New App</h2>
              <button
                onClick={() => {
                  setShouldGenerateAfterNaming(false);
                  setTempProjectName('');
                  setIsNamingModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold p-2 bg-slate-50 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleConfirmNaming} className="p-8 space-y-6">
              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">App Title</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Edit2 size={18} />
                  </div>
                  <input
                    autoFocus
                    type="text"
                    value={tempProjectName}
                    onChange={(e) => setTempProjectName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-lg font-extrabold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="E.g., Recipe Assistant, Task Master..."
                  />
                </div>
                <p className="text-xs text-slate-500 font-medium">This name will help you find your app in the library later.</p>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShouldGenerateAfterNaming(false);
                    setTempProjectName('');
                    setIsNamingModalOpen(false);
                  }}
                  className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!tempProjectName.trim()}
                  className={`rounded-xl px-8 py-2.5 font-bold shadow-md transition-all active:scale-95 ${
                    !tempProjectName.trim() 
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'
                  }`}
                >
                  Create App
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      <Suspense fallback={
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-4 shadow-xl">Loading authentication...</div>
        </div>
      }>
        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={() => setIsAuthModalOpen(false)} 
        />
      </Suspense>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 hidden md:flex flex-col">
          <div className="px-6 py-7 border-b border-slate-100 flex items-center bg-white/80 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100/50 flex-shrink-0">
                <History size={16} />
              </div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
                Version History
              </h2>
            </div>

          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {versions.length === 0 ? (
              <div className="text-center py-20 px-6 flex flex-col items-center">
                <div className="w-16 h-16 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-6 border border-slate-100 shadow-inner group">
                  <Clock size={28} className="text-slate-300 group-hover:text-indigo-400 transition-colors" />
                </div>
                <h3 className="text-slate-900 font-bold text-base mb-2">No versions yet</h3>
                <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-[16rem]">Your app development journey will be documented here step by step.</p>
              </div>
            ) : (

              [...versions].reverse().map((ver, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isActive = currentVersionIndex === idx;
                return (
                  <button
                    key={ver.id}
                    onClick={() => switchVersion(idx)}
                    className={`w-full text-left p-4 rounded-3xl border transition-all duration-300 group flex flex-col version-item relative overflow-hidden ${
                      isActive 
                        ? 'bg-indigo-50/40 border-indigo-200 shadow-sm ring-1 ring-indigo-500/10' 
                        : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`h-8 px-3 rounded-lg flex items-center text-sm font-black transition-colors ${
                          isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                        }`}>
                          V{idx + 1}
                        </div>
                        {idx === 0 && (
                          <span className="text-sm font-bold text-indigo-500 uppercase tracking-widest">Initial</span>
                        )}
                        {ver.editMode === 'full-rewrite' && (
                          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                            Rewrite
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-slate-500 font-semibold">
                        {ver.timestamp}
                      </span>
                    </div>
                    
                    <span className={`text-base leading-relaxed transition-colors ${
                      isActive ? 'text-indigo-950 font-extrabold' : 'text-slate-600 group-hover:text-slate-900 font-medium'
                    }`}>
                      {ver.prompt}
                    </span>

                    {ver.editSummary && (
                      <span className="mt-3 text-sm text-slate-500 leading-relaxed">
                        {ver.editSummary}
                      </span>
                    )}

                    {isActive && (
                      <div className="mt-4 flex items-center justify-between pt-3 border-t border-indigo-100/50">
                        <div className="flex items-center text-sm font-bold text-indigo-700 pl-1">
                          <div className="w-2 h-2 rounded-full bg-indigo-500 mr-2 animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
                          Live Version
                        </div>
                        <ChevronRight size={14} className="text-indigo-400" />
                      </div>
                    )}
                  </button>

                );
              })
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* Prompt/Chat Sidebar (Left) */}
          <div className="w-full md:w-[380px] lg:w-[450px] flex flex-col bg-white border-r border-slate-200 z-10 flex-shrink-0">
            
            <div className={`flex-1 overflow-y-auto p-6 lg:p-10 flex flex-col ${generatedCode ? 'justify-end' : 'justify-center'}`}>
              <div className="max-w-2xl w-full mx-auto space-y-10 animate-fade-in">
                
                {/* Header Section */}
                <div className={`space-y-6 ${generatedCode ? 'refine-card mb-4' : ''}`}>
                  {user && (
                    <div className="flex flex-col gap-2.5 max-w-sm mb-4">
                      <label htmlFor="projectName" className="text-sm font-semibold text-slate-600 ml-1">Project Name</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                           <Edit2 size={16} />
                        </div>
                        <input
                          id="projectName"
                          name="projectName"
                          type="text"
                          value={projectName}
                          onChange={(e) => setProjectName(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-base font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm group-hover:border-slate-300"
                          placeholder="My Awesome App"
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-4">
                    <h2 className="text-3xl lg:text-4xl font-[900] text-slate-900 tracking-tight leading-[1.1]">
                      {generatedCode ? "Refine your app" : "What do you want to build?"}
                    </h2>
                    <p className="text-slate-600 text-lg max-w-lg leading-relaxed font-medium">
                      {generatedCode 
                        ? "Describe exactly what you want to change, add, or fix in your current application."
                        : "Describe your mini-app in natural language, and Orion will generate the production-ready code in seconds."}
                    </p>
                    
                    {!user && (
                      <div className="flex items-center gap-3 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl animate-fade-in">
                        <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
                          <User size={16} />
                        </div>
                        <p className="text-sm font-bold text-indigo-900">Sign in to generate and save your apps</p>
                      </div>
                    )}
                  </div>

                </div>

                {/* Suggestions - Only show when no app is generated */}
                {!generatedCode && (
                  <div className="animate-fade-in space-y-4" style={{ animationDelay: '0.1s' }}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-600 flex items-center">
                        <Sparkles size={12} className="mr-2 text-amber-500" /> Suggested Starters
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {suggestedPrompts.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setPrompt(suggestion)}
                          className="text-left p-4 bg-slate-50/50 border border-slate-100 rounded-2xl hover:border-indigo-200 hover:bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all group flex items-center justify-between shadow-sm relative overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500/0 group-hover:bg-indigo-500 transition-all"></div>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 group-hover:border-indigo-100 transition-all shadow-sm shrink-0">
                               <Plus size={18} />
                            </div>
                            <span className="text-base text-slate-700 group-hover:text-slate-900 font-semibold leading-snug transition-colors">{suggestion}</span>
                          </div>
                          <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-400 transition-all opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0" />
                        </button>
                      ))}
                    </div>

                  </div>
                )}
                
                {error && (
                  <div className="bg-red-50 border border-red-100 p-5 rounded-3xl shadow-sm animate-shake">
                    <div className="flex items-center">
                      <div className="p-2 bg-red-100 rounded-xl mr-4 text-red-600">
                        <RefreshCw size={20} />
                      </div>
                      <p className="text-sm text-red-800 font-bold leading-snug">
                        {error}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Bottom Input Area */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all">
                <textarea
                  id="prompt"
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={generatedCode ? "E.g., Make the background dark blue, add a reset button..." : "E.g., A minimalist task manager..."}
                  className="w-full h-32 p-5 outline-none resize-none text-slate-800 placeholder:text-slate-400 text-[15px] leading-7 bg-transparent"
                  disabled={isGenerating}
                />
                <div className="bg-slate-50 border-t border-slate-100 p-3 flex justify-between items-center">
                  <div className="flex space-x-2">
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || (user && !prompt.trim())}
                    className={`flex items-center px-5 py-2.5 rounded-xl text-base font-semibold text-white transition-all transform active:scale-95 ${
                      isGenerating || (user && !prompt.trim()) 
                        ? 'bg-slate-300 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-lg'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="animate-spin mr-2" size={18} />
                        {generatedCode ? "Updating..." : "Generating..."}
                      </>
                    ) : (
                      <>
                        {!user ? <User className="mr-2" size={18} /> : (generatedCode ? <Edit2 className="mr-2" size={18} /> : <Wand2 className="mr-2" size={18} />)}
                        {!user ? "Login to Build" : (generatedCode ? "Update" : "Build")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Preview/Device Area (Right) */}
          <div className="flex-1 bg-slate-100 flex flex-col relative z-0">
            
            {/* View Toggles */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white/50 backdrop-blur-sm">
              <div className="flex bg-slate-200/50 p-1 rounded-xl">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'preview' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Play size={16} className="mr-2" /> Preview
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'code' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <TerminalSquare size={16} className="mr-2" /> Code
                </button>
              </div>

               
               <div className="flex items-center space-x-2">
                 {activeTab === 'preview' && (
                   <div className="flex items-center bg-slate-200/50 p-1 rounded-xl">
                     <button
                       onClick={() => setPreviewMode('mobile')}
                       className={`flex items-center px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                         previewMode === 'mobile' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                       }`}
                       title="Preview as mobile"
                     >
                       <Smartphone size={16} className="mr-2" /> Mobile
                     </button>
                     <button
                       onClick={() => setPreviewMode('desktop')}
                       className={`flex items-center px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                         previewMode === 'desktop' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                       }`}
                       title="Preview as desktop"
                     >
                       <Monitor size={16} className="mr-2" /> Desktop
                     </button>
                   </div>
                 )}
                 {versions.length > 1 && (
                   <div className="flex items-center bg-slate-200/50 p-1 rounded-xl mr-3">
                    <button
                      onClick={handleUndo}
                      disabled={currentVersionIndex <= 0}
                      className={`p-2 rounded-lg transition-all ${
                        currentVersionIndex <= 0 
                          ? 'text-slate-300 cursor-not-allowed' 
                          : 'text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm'
                      }`}
                      title="Undo (Previous Version)"
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={currentVersionIndex >= versions.length - 1}
                      className={`p-2 rounded-lg transition-all ${
                        currentVersionIndex >= versions.length - 1 
                          ? 'text-slate-300 cursor-not-allowed' 
                          : 'text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm'
                      }`}
                      title="Redo (Next Version)"
                    >
                      <Redo2 size={16} />
                    </button>
                  </div>

                )}
                {generatedCode && (
                   <button 
                    onClick={handleDownload}
                    className="text-slate-500 hover:text-indigo-600 bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all active:scale-95"
                    title="Download HTML"
                   >
                     <Download size={18} />
                   </button>
                )}

                {/* Zoom Controls */}
                <div className="flex items-center bg-slate-200/50 p-1 rounded-xl ml-1">
                  <button
                    onClick={() => handleManualZoom(-0.1)}
                    disabled={zoomLevel <= 0.2}
                    className={`p-2 rounded-lg transition-all ${
                      zoomLevel <= 0.2 
                        ? 'text-slate-300 cursor-not-allowed' 
                        : 'text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm'
                    }`}
                    title="Zoom Out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    onClick={resetZoom}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      isAutoZoom ? 'text-indigo-600 bg-white shadow-sm' : 'text-slate-500 hover:text-indigo-600'
                    }`}
                    title={isAutoZoom ? "Currently Auto-Zoomed" : "Reset to Auto-Zoom"}
                  >
                    {isAutoZoom ? 'AUTO' : `${Math.round(zoomLevel * 100)}%`}
                  </button>
                  <button
                    onClick={() => handleManualZoom(0.1)}
                    disabled={zoomLevel >= 3}
                    className={`p-2 rounded-lg transition-all ${
                      zoomLevel >= 3 
                        ? 'text-slate-300 cursor-not-allowed' 
                        : 'text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm'
                    }`}
                    title="Zoom In"
                  >
                    <ZoomIn size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Container for Device or Code */}
            <div 
              ref={previewContainerRef}
              className="flex-1 flex items-center justify-center p-6 overflow-auto relative custom-scrollbar"
            >
              
              {/* Animated Background Pattern */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                   style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
              </div>

              {activeTab === 'preview' ? (
                /* Device Mockup */
                <div
                  className={previewMode === 'mobile' ? 'device-smartphone' : 'device-desktop'}
                  style={{ 
                    transform: `scale(${zoomLevel})`,
                    transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transformOrigin: 'center center'
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
                  <div className="device-screen">
                    {isGenerating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm z-10 p-6 text-center">
                        <div className="relative w-24 h-24 mb-8">
                          <div className="absolute inset-0 border-[6px] border-indigo-100 rounded-[2rem]"></div>
                          <div className="absolute inset-0 border-[6px] border-indigo-600 rounded-[2rem] border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto text-indigo-500 animate-pulse" size={32} />
                        </div>
                        <h3 className="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Building Interface...</h3>
                        <p className="text-sm text-slate-600 font-semibold mt-2 animate-pulse">Writing HTML, CSS, and JavaScript</p>
                      </div>
                    ) : (
                      <div className="w-full h-full relative">
                        {generatedCode ? (
                          <iframe
                            ref={iframeRef}
                            title="Generated App Preview"
                            srcDoc={generatedCode}
                            className="w-full h-full border-none"
                            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 p-10 text-center">
                            <div className="w-20 h-20 rounded-[2rem] bg-indigo-50 flex items-center justify-center mb-6 shadow-sm border-2 border-dashed border-indigo-200">
                               {previewMode === 'mobile' ? (
                                 <Smartphone size={32} className="text-indigo-300" />
                               ) : (
                                 <Monitor size={32} className="text-indigo-300" />
                               )}
                             </div>
                            <h4 className="font-extrabold text-slate-900 text-lg tracking-tight mb-2">
                              {previewMode === 'mobile' ? 'Mobile Preview Standby' : 'Desktop Preview Standby'}
                            </h4>
                            <p className="text-base text-slate-500 font-medium max-w-xs leading-relaxed">
                              Your generated app will render here automatically in {PREVIEW_MODES[previewMode].label.toLowerCase()} view.
                            </p>
                          </div>
                        )}
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
                        <div className="w-32 h-1.5 bg-slate-200/50 rounded-full backdrop-blur-sm hover:bg-slate-300 transition-colors"></div>
                      </div>
                    </>
                  ) : (
                    <div className="device-desktop-stand"></div>
                  )}
                </div>

              ) : (
                /* Code View */
                <div className="w-full h-full bg-[#1E1E1E] rounded-xl overflow-hidden shadow-xl border border-slate-800 flex flex-col">
                  <div className="bg-[#2D2D2D] px-4 py-2 flex items-center border-b border-black/50">
                    <div className="flex space-x-2 mr-4">
                      <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                      <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                      <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">index.html</span>
                    <div className="flex-1"></div>
                    {generatedCode && (
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
                    {isGenerating ? (
                       <div className="flex items-center justify-center h-full space-x-3 text-indigo-400/60 font-mono text-sm">
                         <Loader2 className="animate-spin" size={20} />
                         <span>Synthesizing source code...</span>
                       </div>
                    ) : generatedCode ? (
                      <div 
                        className="py-4 font-mono text-[13px] leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(generatedCode) }}
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-600 font-mono text-sm opacity-50">
                        <Code2 size={48} className="mb-4 text-slate-700" />
                        <span>// No code generated yet.</span>
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
