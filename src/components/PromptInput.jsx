import { useEffect, useRef } from 'react';
import { Wand2, MessageSquare, Edit2, Loader2, X } from 'lucide-react';

// Prompt textarea with the Build/Ask mode toggle and submit/cancel footer.
// Enter sends (Shift+Enter for a newline); Cmd/Ctrl+Enter keeps working too.
// The textarea auto-grows to a cap before scrolling.
export default function PromptInput({
  prompt,
  onPromptChange,
  onSubmit,
  onCancelGeneration,
  isGenerating,
  isChatActive,
  hasCode,
  chatMode,
  onChatModeChange,
  isClarifying,
}) {
  const textareaRef = useRef(null);
  const canSubmit = !isGenerating && prompt.trim().length > 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [prompt]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !(e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-slate-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100/60 overflow-hidden transition-all input-glow flex flex-col">
      {isClarifying && !isGenerating && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <button
            onClick={(e) => onSubmit(e, "Yes")}
            className="flex-1 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg border border-indigo-200 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={(e) => onSubmit(e, "No")}
            className="flex-1 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-200 transition-colors"
          >
            No
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        id="prompt"
        name="prompt"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isChatActive ? (chatMode === 'ask' ? "Ask a question about the code..." : "e.g. Make the background dark, add a reset button...") : "e.g. A minimalist task manager with categories..."}
        className="w-full min-h-[56px] max-h-44 px-4 pt-3 pb-2 outline-none resize-none text-slate-900 placeholder:text-slate-400 text-sm sm:text-base leading-relaxed bg-transparent"
        disabled={isGenerating}
      />
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-3.5 sm:px-4 py-2">
        <div className="flex items-center min-w-0">
          {isChatActive && !isGenerating ? (
            <div className="nav-segmented-group nav-segmented-compact" role="radiogroup" aria-label="Chat mode">
              <label className={`nav-segmented-btn cursor-pointer ${chatMode === 'build' ? 'nav-segmented-btn-active' : ''}`}>
                <input type="radio" name="chatMode" value="build" checked={chatMode === 'build'} onChange={() => onChatModeChange('build')} className="sr-only" />
                <Wand2 size={13} aria-hidden="true" />
                <span>Build</span>
              </label>
              <label className={`nav-segmented-btn cursor-pointer ${chatMode === 'ask' ? 'nav-segmented-btn-active' : ''}`}>
                <input type="radio" name="chatMode" value="ask" checked={chatMode === 'ask'} onChange={() => onChatModeChange('ask')} className="sr-only" />
                <MessageSquare size={13} aria-hidden="true" />
                <span>Ask</span>
              </label>
            </div>
          ) : (
            !isGenerating && (
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 select-none">
                <kbd className="px-2 py-0.5 rounded border border-slate-300 bg-surface font-mono text-xs leading-none text-slate-600 font-semibold shadow-2xs" title="Shift+Enter for a new line">↵</kbd>
                <span className="hidden sm:inline">{hasCode ? 'to update' : 'to build'}</span>
              </div>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`inline-flex items-center justify-center gap-2 whitespace-nowrap px-3.5 py-1.5 sm:px-4 sm:py-2 text-sm font-bold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              canSubmit
                ? 'brand-gradient text-white shadow-premium-md hover:shadow-premium-lg hover:brightness-105 active:scale-[0.99]'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                <span>{chatMode === 'ask' ? "Thinking..." : (isClarifying ? "Answering..." : (hasCode ? "Updating..." : "Building..."))}</span>
              </>
            ) : (
              <>
                {chatMode === 'ask' ? <MessageSquare size={16} /> : (isClarifying ? <MessageSquare size={16} /> : (isChatActive ? <Edit2 size={16} /> : <Wand2 size={16} />))}
                <span>{chatMode === 'ask' ? "Ask" : (isClarifying ? "Answer" : (isChatActive ? "Update App" : "Build App"))}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
