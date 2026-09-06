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
    <div className="prompt-input-dock bg-white dark:bg-[#161824] rounded-2xl border-2 border-slate-300 dark:border-white/20 overflow-hidden transition-all shadow-md flex flex-col">
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
            : chatMode === 'ask'
              ? (isChatActive ? "Ask a question about the code..." : "Ask anything...")
              : isChatActive
                ? "e.g. Make the background dark, add a reset button..."
                : "e.g. A minimalist task manager with categories..."
        }
        className="prompt-input-field w-full min-h-[52px] sm:min-h-[62px] max-h-40 px-4 pt-3.5 pb-2 outline-none resize-none text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 text-sm font-medium leading-relaxed bg-transparent custom-scrollbar"
        disabled={isGenerating}
      />
      <div className="prompt-input-footer flex items-center justify-between gap-2 px-4 py-2.5 border-t-2 border-slate-200 dark:border-white/10 bg-slate-100/90 dark:bg-white/[0.04]">
        <div className="flex items-center min-w-0">
          {!isGenerating ? (
            <div className="chat-mode-toggle prompt-input-mode nav-segmented-group nav-segmented-compact p-0.5 rounded-xl border-2 border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.08] shadow-2xs" role="radiogroup" aria-label="Chat mode">
              <label className={`nav-segmented-btn cursor-pointer py-1.5 px-3 text-xs font-black rounded-lg transition-all ${chatMode === 'build' ? 'nav-segmented-btn-active shadow-sm text-white bg-red-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}>
                <input type="radio" name="chatMode" value="build" checked={chatMode === 'build'} onChange={() => onChatModeChange('build')} className="sr-only" />
                <Wand2 size={13} aria-hidden="true" />
                <span>Build</span>
              </label>
              <label className={`nav-segmented-btn cursor-pointer py-1.5 px-3 text-xs font-black rounded-lg transition-all ${chatMode === 'ask' ? 'nav-segmented-btn-active shadow-sm text-white bg-red-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}>
                <input type="radio" name="chatMode" value="ask" checked={chatMode === 'ask'} onChange={() => onChatModeChange('ask')} className="sr-only" />
                <MessageSquare size={13} aria-hidden="true" />
                <span>Ask</span>
              </label>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="prompt-input-cancel inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white border-2 border-rose-500 border-b-[3px] border-b-rose-900 dark:border-b-black/80 shadow-md transition-all active:translate-y-0.5 active:border-b-2 cursor-pointer"
            >
              <X size={14} />
              Cancel
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`prompt-input-action inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-black rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              canSubmit
                ? 'bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-600 text-white border-2 border-indigo-500/50 border-b-[4px] border-b-indigo-950 dark:border-b-black/80 shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5 active:translate-y-0.5 active:border-b-2 cursor-pointer'
                : 'bg-slate-200/90 dark:bg-white/[0.08] text-slate-600 dark:text-white/40 border-2 border-slate-300 dark:border-white/15 border-b-[3px] border-b-slate-400/80 dark:border-b-black/80 cursor-not-allowed shadow-xs'
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={15} />
                <span>{chatMode === 'ask' ? "Thinking..." : (isClarifying ? "Answering..." : (hasCode ? "Updating..." : "Building..."))}</span>
              </>
            ) : (
              <>
                {chatMode === 'ask' ? <MessageSquare size={15} /> : (isClarifying ? <MessageSquare size={15} /> : (isChatActive ? <Edit2 size={15} /> : <Wand2 size={15} />))}
                <span>{chatMode === 'ask' ? "Send" : (isClarifying ? "Answer" : (isChatActive ? "Update App" : "Build App"))}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
