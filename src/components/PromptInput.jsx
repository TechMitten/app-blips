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
    const newHeight = Math.min(el.scrollHeight, 176);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden';
  }, [prompt]);

  useEffect(() => {
    if (isClarifying && !isGenerating) {
      textareaRef.current?.focus();
    }
  }, [isClarifying, isGenerating]);

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
    <div className="bg-surface rounded-xl shadow-2xs border border-slate-200 focus-within:border-indigo-500/80 focus-within:ring-2 focus-within:ring-indigo-500/15 overflow-hidden transition-all input-glow flex flex-col">
      <textarea
        ref={textareaRef}
        id="prompt"
        name="prompt"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isClarifying
            ? "Type your answer here..."
            : isChatActive
              ? (chatMode === 'ask' ? "Ask a question about the code..." : "e.g. Make the background dark, add a reset button...")
              : "e.g. A minimalist task manager with categories..."
        }
        className="w-full min-h-[48px] sm:min-h-[58px] max-h-40 px-3.5 pt-2.5 sm:pt-3 pb-1.5 outline-none resize-none text-slate-900 placeholder:text-slate-400 text-xs sm:text-sm leading-relaxed bg-transparent custom-scrollbar"
        disabled={isGenerating}
      />
      <div className="flex items-center justify-between gap-2 border-t border-slate-200/60 bg-slate-50/60 px-3 py-1.5 sm:py-2">
        <div className="flex items-center min-w-0">
          {isChatActive && !isGenerating ? (
            <div className="nav-segmented-group nav-segmented-compact" role="radiogroup" aria-label="Chat mode">
              <label className={`nav-segmented-btn cursor-pointer py-1 px-2.5 text-[11px] font-semibold ${chatMode === 'build' ? 'nav-segmented-btn-active' : ''}`}>
                <input type="radio" name="chatMode" value="build" checked={chatMode === 'build'} onChange={() => onChatModeChange('build')} className="sr-only" />
                <Wand2 size={12} aria-hidden="true" />
                <span>Build</span>
              </label>
              <label className={`nav-segmented-btn cursor-pointer py-1 px-2.5 text-[11px] font-semibold ${chatMode === 'ask' ? 'nav-segmented-btn-active' : ''}`}>
                <input type="radio" name="chatMode" value="ask" checked={chatMode === 'ask'} onChange={() => onChatModeChange('ask')} className="sr-only" />
                <MessageSquare size={12} aria-hidden="true" />
                <span>Ask</span>
              </label>
            </div>
          ) : (
            !isGenerating && (
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-slate-500 select-none">
                <span className="hidden sm:inline">Press</span>
                <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-surface text-[10px] leading-none text-slate-600 font-mono font-semibold shadow-2xs" title="Shift+Enter for a new line">Enter</kbd>
                <span className="hidden sm:inline">{isClarifying ? 'to answer' : (hasCode ? 'to update' : 'to build')}</span>
              </div>
            )
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 transition-colors cursor-pointer"
            >
              <X size={13} />
              Cancel
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              canSubmit
                ? 'brand-gradient text-white shadow-2xs hover:brightness-105 active:scale-[0.98] cursor-pointer'
                : 'bg-slate-100 text-slate-400 border border-slate-200/70 cursor-not-allowed shadow-none'
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                <span>{chatMode === 'ask' ? "Thinking..." : (isClarifying ? "Answering..." : (hasCode ? "Updating..." : "Building..."))}</span>
              </>
            ) : (
              <>
                {chatMode === 'ask' ? <MessageSquare size={14} /> : (isClarifying ? <MessageSquare size={14} /> : (isChatActive ? <Edit2 size={14} /> : <Wand2 size={14} />))}
                <span>{chatMode === 'ask' ? "Ask" : (isClarifying ? "Answer" : (isChatActive ? "Update App" : "Build App"))}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
