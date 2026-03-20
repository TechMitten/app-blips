import React, { useState, useRef } from 'react';
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
  Moon, 
  Sun,
  Download,
  RefreshCw,
  Sparkles,
  ChevronRight,
  TerminalSquare,
  Plus,
  Edit2,
  Clock,
  Undo2,
  Redo2
} from 'lucide-react';

// --- Constants ---
const SYSTEM_PROMPT = `You are an expert frontend developer and UX designer. 
Generate a complete, self-contained HTML file (with inline CSS and JS) that implements the user's requested app.

CRITICAL RULES:
1. Output ONLY valid, raw HTML code.
2. DO NOT wrap the output in markdown formatting (e.g., no \`\`\`html or \`\`\` blocks).
3. The app MUST be fully responsive and designed specifically to look great on a mobile smartphone screen (375px width).
4. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for styling.
5. Include modern UI elements, rounded corners, good typography (import Google fonts if needed), and smooth interactions.
6. Ensure any JavaScript is fully functional and self-contained within a <script> tag.
7. If you are updating an existing app, ensure you return the ENTIRE updated HTML file, not just the changed parts.`;

// --- API Helper with Exponential Backoff ---
const generateAppCode = async (
  prompt,
  currentCode = null,
  provider = 'openrouter',
  retryCount = 0
) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  const openrouterKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const openrouterModel = import.meta.env.VITE_OPENROUTER_MODEL || 'openrouter/free';
  const geminiModel = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash-preview-09-2025';

  try {
    const userText = currentCode 
      ? `Update the existing mobile web app based on this new request: "${prompt}"\n\nHere is the current complete HTML code. Please return the FULL, updated HTML file, incorporating the new request while keeping the rest of the app functional.\n\n\`\`\`html\n${currentCode}\n\`\`\``
      : `Create a mobile-friendly web app based on this request: ${prompt}`;

    let endpoint;
    let headers;
    let body;

    if (provider === 'gemini') {
      if (!geminiKey) {
        throw new Error('Gemini API key is missing. Set VITE_GEMINI_API_KEY in .env.');
      }
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      headers = {
        'Content-Type': 'application/json'
      };
      body = JSON.stringify({
        contents: [{
          parts: [{ text: userText }]
        }],
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        generationConfig: {
          temperature: 0.7,
        }
      });
    } else {
      if (!openrouterKey) {
        throw new Error('OpenRouter API key is missing. Set VITE_OPENROUTER_API_KEY in .env.');
      }
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      headers = {
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Orion App Generator',
        'Content-Type': 'application/json'
      };
      body = JSON.stringify({
        model: openrouterModel,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: userText
          }
        ]
      });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const result = await response.json();
    let text = '';

    if (provider === 'gemini') {
      text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      text = result.choices?.[0]?.message?.content || '';
    }

    // Sanitize in case the model ignored the "no markdown" rule or included preamble reasoning
    // 1. Try to find content between ```html and ``` blocks
    const htmlBlockMatch = text.match(/```html\s*([\s\S]*?)\s*```/i);
    if (htmlBlockMatch) {
      return htmlBlockMatch[1].trim();
    }

    // 2. Try to find content between generic ``` blocks
    const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // 3. Try to find starting from <!DOCTYPE or <html
    const htmlStartMatch = text.match(/(<!DOCTYPE html[\s\S]*)/i) || text.match(/(<html[\s\S]*)/i);
    if (htmlStartMatch) {
      let content = htmlStartMatch[0];
      // If there's a closing tag, cut off everything after it
      const endTagMatch = content.match(/<\/html>/i);
      if (endTagMatch) {
        const lastIndex = content.toLowerCase().lastIndexOf('</html>');
        return content.substring(0, lastIndex + 7).trim();
      }
      // Otherwise just clean up trailing markdown if it exists
      return content.replace(/\n?```$/, '').trim();
    }

    // fallback: remove common prefixes/suffixes if present
    text = text.replace(/^```html\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    
    return text;
  } catch (err) {
    if (retryCount < 5) {
      await new Promise(r => setTimeout(r, delays[retryCount]));
      return generateAppCode(prompt, currentCode, provider, retryCount + 1);
    }
    throw new Error(err.message || "Failed to generate app after multiple attempts.");
  }
};



const syntaxHighlightHtml = (code) => {
  if (!code) return "";

  // 1. Escape basic HTML characters
  const escape = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  let html = escape(code);

  // 2. Comments (HTML)
  html = html.replace(/&lt;!--([\s\S]*?)--&gt;/g, '<span class="token-comment">&lt;!--$1--&gt;</span>');

  // 3. Doctype
  html = html.replace(/(&lt;!DOCTYPE[\s\S]*?&gt;)/gi, '<span class="token-doctype">$1</span>');

  // 4. Tags and Attributes
  // Matches tags like &lt;tag-name attr="val"&gt;
  html = html.replace(/(&lt;\/?)([\w-:]+)([\s\S]*?)(&gt;)/g, (match, prefix, tagName, attrs, suffix) => {
    const highlightedTag = `${prefix}<span class="token-tag-name">${tagName}</span>`;
    
    // Attributes: key=&quot;value&quot; or key (boolean)
    const highlightedAttrs = attrs.replace(/\s+([\w-:]+)(?:=(&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;|[\w:-]+))?/g, (m, attrName, attrValue) => {
      let res = ` <span class="token-attr-name">${attrName}</span>`;
      if (attrValue) {
        res += `=<span class="token-string">${attrValue}</span>`;
      }
      return res;
    });
    
    return highlightedTag + highlightedAttrs + suffix;
  });

  // 5. Basic JS/CSS highlighting inside <script>/<style> blocks would be nice,
  // but let's stick to improving the variety first.
  
  return html;
};

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [apiProvider, setApiProvider] = useState(() => localStorage.getItem('orion-api-provider') || 'openrouter');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const iframeRef = useRef(null);

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

    setIsGenerating(true);
    setError(null);
    setActiveTab('preview');
    
    const currentPrompt = prompt;
    setPrompt(''); // Clear input so user can easily type their next refinement

    try {
      const code = await generateAppCode(currentPrompt, generatedCode, apiProvider);
      setGeneratedCode(code);
      
      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        code: code,
        timestamp: new Date().toLocaleTimeString()
      };
      
      // If user goes back in time and generates, truncate the future versions (standard undo behavior)
      const updatedVersions = versions.slice(0, currentVersionIndex + 1);
      setVersions([...updatedVersions, newVersion]);
      setCurrentVersionIndex(updatedVersions.length);
      
    } catch (err) {
      setError(err.message);
      setPrompt(currentPrompt); // Restore prompt text on error
    } finally {
      setIsGenerating(false);
    }
  };

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
    setGeneratedCode('');
    setPrompt('');
    setError(null);
    setVersions([]);
    setCurrentVersionIndex(-1);
  };

  const handleUndo = () => {
    if (currentVersionIndex > 0) {
      const prevIndex = currentVersionIndex - 1;
      setCurrentVersionIndex(prevIndex);
      setGeneratedCode(versions[prevIndex].code);
    }
  };

  const handleRedo = () => {
    if (currentVersionIndex < versions.length - 1) {
      const nextIndex = currentVersionIndex + 1;
      setCurrentVersionIndex(nextIndex);
      setGeneratedCode(versions[nextIndex].code);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-inner text-white">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Orion</h1>
            <p className="text-xs text-slate-500 font-medium">AI-Powered Micro App Builder</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="text-slate-500 hover:text-slate-900 transition-colors p-2 rounded-full hover:bg-slate-100"
            title="Settings"
          >
            <Settings size={20} />
          </button>
          <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold border border-indigo-200">
            JS
          </div>
          <span className="px-2 py-1 text-xs rounded-md bg-slate-100 text-slate-600 border border-slate-200">
            {apiProvider === 'gemini' ? 'Gemini' : 'OpenRouter'}
          </span>
        </div>
      </header>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-sm font-medium text-slate-700">AI Provider</label>
                <div className="mt-2 flex gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="apiProvider"
                      value="openrouter"
                      checked={apiProvider === 'openrouter'}
                      onChange={(e) => setApiProvider(e.target.value)}
                    />
                    OpenRouter
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="apiProvider"
                      value="gemini"
                      checked={apiProvider === 'gemini'}
                      onChange={(e) => setApiProvider(e.target.value)}
                    />
                    Gemini
                  </label>
                </div>
              </div>

            </div>
            <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-2 bg-slate-50">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-lg px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="rounded-lg px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
              <History size={14} className="mr-2" /> Version History
            </h2>
            {versions.length > 0 && (
              <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-bold">
                {versions.length}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {versions.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No versions yet. Start building!
              </div>
            ) : (
              [...versions].reverse().map((ver, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                return (
                  <button
                    key={ver.id}
                    onClick={() => {
                      setCurrentVersionIndex(idx);
                      setGeneratedCode(ver.code);
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all group flex flex-col ${
                      currentVersionIndex === idx 
                        ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                        : 'hover:bg-slate-50 border-transparent hover:border-slate-200'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full mb-1">
                      <span className={`text-xs font-bold ${currentVersionIndex === idx ? 'text-indigo-600' : 'text-slate-400'}`}>
                        v{idx + 1} {idx === 0 ? '(Initial)' : ''}
                      </span>
                      <span className="text-[10px] text-slate-400 flex items-center">
                        <Clock size={10} className="mr-1" /> {ver.timestamp}
                      </span>
                    </div>
                    <span className={`text-sm line-clamp-2 leading-tight ${currentVersionIndex === idx ? 'text-indigo-900 font-medium' : 'text-slate-600'}`}>
                      {ver.prompt}
                    </span>
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
            
            {/* Scrollable Info Area */}
            <div className="flex-1 overflow-y-auto p-6 lg:p-8">
              <div className="space-y-8">
                <div className="space-y-2">
                  <h2 className="text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight">
                    {generatedCode ? "Refine your app" : "What do you want to build?"}
                  </h2>
                  <p className="text-slate-500 text-base">
                    {generatedCode 
                      ? "Tell the AI what to change, add, or fix in your current app."
                      : "Describe your mini-app in natural language, and AI will generate the code."}
                  </p>
                </div>

                {/* Suggestions */}
                {!generatedCode && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 mb-4 flex items-center">
                      <Sparkles size={16} className="mr-2 text-amber-500" /> Need inspiration?
                    </h3>
                    <div className="flex flex-col gap-3">
                      {suggestedPrompts.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => setPrompt(suggestion)}
                          className="text-left p-4 bg-slate-50 border border-slate-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all text-sm text-slate-600 hover:text-indigo-700 hover:bg-white font-medium group flex items-start justify-between"
                        >
                          <span className="leading-relaxed">{suggestion}</span>
                          <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-500 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                {error && (
                  <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <RefreshCw className="h-5 w-5 text-red-400" aria-hidden="true" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-red-700 font-medium">
                          {error}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Bottom Input Area */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={generatedCode ? "E.g., Make the background dark blue, add a reset button..." : "E.g., A minimalist task manager..."}
                  className="w-full h-32 p-4 outline-none resize-none text-slate-700 placeholder:text-slate-400 text-base leading-relaxed bg-transparent"
                  disabled={isGenerating}
                />
                <div className="bg-slate-50 border-t border-slate-100 p-3 flex justify-between items-center">
                  <div className="flex space-x-2">
                    {generatedCode && (
                      <button 
                        onClick={handleNewApp}
                        className="flex items-center text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-200 transition-colors font-medium text-sm"
                      >
                        <Plus size={16} className="mr-1.5" /> New App
                      </button>
                    )}
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                    className={`flex items-center px-5 py-2 rounded-xl font-medium text-white transition-all transform active:scale-95 ${
                      isGenerating || !prompt.trim() 
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
                        {generatedCode ? <Edit2 className="mr-2" size={18} /> : <Wand2 className="mr-2" size={18} />}
                        {generatedCode ? "Update" : "Build"}
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
              <div className="flex bg-slate-200/70 p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'preview' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Smartphone size={16} className="mr-2" /> Preview
                </button>
                <button
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'code' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <TerminalSquare size={16} className="mr-2" /> Code
                </button>
              </div>
              
              <div className="flex items-center space-x-2">
                {versions.length > 1 && (
                  <div className="flex items-center bg-slate-200/70 p-1 rounded-lg mr-2">
                    <button
                      onClick={handleUndo}
                      disabled={currentVersionIndex <= 0}
                      className={`p-1.5 rounded-md transition-all ${
                        currentVersionIndex <= 0 
                          ? 'text-slate-400 cursor-not-allowed opacity-50' 
                          : 'text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm'
                      }`}
                      title="Undo (Previous Version)"
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={currentVersionIndex >= versions.length - 1}
                      className={`p-1.5 rounded-md transition-all ${
                        currentVersionIndex >= versions.length - 1 
                          ? 'text-slate-400 cursor-not-allowed opacity-50' 
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
                    className="text-slate-500 hover:text-indigo-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all"
                    title="Download HTML"
                   >
                     <Download size={18} />
                   </button>
                )}
              </div>
            </div>

            {/* Container for Device or Code */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-hidden relative">
              
              {/* Animated Background Pattern */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                   style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
              </div>

              {activeTab === 'preview' ? (
                /* Smartphone Device Mockup */
                <div className="relative w-[320px] h-[650px] bg-black rounded-[3rem] p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)] ring-1 ring-slate-900/5">
                  {/* Notch */}
                  <div className="absolute top-0 inset-x-0 flex justify-center z-20">
                    <div className="w-32 h-6 bg-black rounded-b-3xl"></div>
                  </div>
                  
                  {/* Screen */}
                  <div className="relative w-full h-full bg-white rounded-[2.25rem] overflow-hidden">
                    {isGenerating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10">
                        <div className="relative w-20 h-20 mb-6">
                          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto text-indigo-500 animate-pulse" size={24} />
                        </div>
                        <p className="text-slate-600 font-medium animate-pulse">Building your app...</p>
                        <p className="text-xs text-slate-400 mt-2">Writing HTML, CSS & JS</p>
                      </div>
                    ) : generatedCode ? (
                      <iframe
                        ref={iframeRef}
                        title="Generated App Preview"
                        srcDoc={generatedCode}
                        className="w-full h-full border-none"
                        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 p-6 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4 shadow-sm border border-slate-200">
                           <Smartphone size={32} className="text-slate-300" />
                        </div>
                        <p className="font-medium text-slate-500">Device Ready</p>
                        <p className="text-sm mt-2 text-slate-400">Enter a prompt and hit build to see your app here.</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Home Indicator */}
                  <div className="absolute bottom-2 inset-x-0 flex justify-center z-20">
                    <div className="w-24 h-1 bg-white/30 rounded-full"></div>
                  </div>
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
                  </div>
                  <div className="flex-1 p-4 overflow-auto">
                    {isGenerating ? (
                       <div className="flex items-center space-x-2 text-slate-500 font-mono text-sm">
                         <Loader2 className="animate-spin" size={16} />
                         <span>Generating code...</span>
                       </div>
                    ) : generatedCode ? (
                      <pre className="text-sm font-mono text-slate-100 whitespace-pre-wrap">
                        <code
                          className="language-html"
                          dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(generatedCode) }}
                        />
                      </pre>
                    ) : (
                      <div className="text-slate-600 font-mono text-sm">
                        // No code generated yet.
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