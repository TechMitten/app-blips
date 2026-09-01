import { Wand2, MessageSquare, Edit2, Loader2, X } from 'lucide-react';

// Prompt textarea with the Build/Ask mode toggle and submit/cancel footer.
// Submit fires on Cmd/Ctrl+Enter or the button.
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
}) {
  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-slate-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100/60 overflow-hidden transition-all input-glow">
      <textarea
        id="prompt"
        name="prompt"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isGenerating && prompt.trim()) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={isChatActive ? (chatMode === 'ask' ? "Ask a question about the code..." : "e.g. Make the background dark, add a reset button...") : "e.g. A minimalist task manager with categories..."}
        className="w-full h-16 sm:h-20 xl:h-20 2xl:h-24 px-4 pt-3 pb-2 outline-none resize-none text-slate-900 placeholder:text-slate-400 text-sm sm:text-base leading-relaxed bg-transparent"
        disabled={isGenerating}
      />
      {isChatActive && (
        <div className="px-3 sm:px-3.5 pb-2">
          <div className="flex items-center justify-between py-1.5 px-2.5 sm:px-3 rounded-lg bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] 2xl:text-xs font-bold text-slate-500 uppercase tracking-wider">Mode</span>
            <div className="flex items-center gap-1 sm:gap-1.5">
              <label className={`flex cursor-pointer items-center gap-1 sm:gap-1.5 rounded-md px-2 py-0.5 text-xs xl:text-sm font-semibold transition-all ${chatMode === 'build' ? 'bg-surface text-indigo-700 shadow-sm border border-slate-300' : 'text-slate-500 hover:text-slate-800'}`}>
                <input type="radio" name="chatMode" value="build" checked={chatMode === 'build'} onChange={() => onChatModeChange('build')} className="sr-only" disabled={isGenerating} />
                <Wand2 size={13} className={chatMode === 'build' ? 'text-indigo-600' : 'text-slate-400'} />
                <span>Build</span>
              </label>
              <label className={`flex cursor-pointer items-center gap-1 sm:gap-1.5 rounded-md px-2 py-0.5 text-xs xl:text-sm font-semibold transition-all ${chatMode === 'ask' ? 'bg-surface text-indigo-700 shadow-sm border border-slate-300' : 'text-slate-500 hover:text-slate-800'}`}>
                <input type="radio" name="chatMode" value="ask" checked={chatMode === 'ask'} onChange={() => onChatModeChange('ask')} className="sr-only" disabled={isGenerating} />
                <MessageSquare size={13} className={chatMode === 'ask' ? 'text-indigo-600' : 'text-slate-400'} />
                <span>Ask</span>
              </label>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-3.5 sm:px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 select-none">
          <kbd className="px-2 py-0.5 rounded border border-slate-300 bg-surface font-sans text-xs leading-none text-slate-600 font-semibold shadow-2xs">⌘ ↵</kbd>
          <span className="hidden sm:inline">{chatMode === 'ask' ? 'to ask' : 'to build'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={isGenerating || !prompt.trim()}
            className={`inline-flex items-center justify-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 text-sm font-bold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isGenerating || !prompt.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'brand-gradient text-white shadow-premium-md hover:shadow-premium-lg hover:brightness-105 active:scale-[0.99]'
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                <span>{chatMode === 'ask' ? "Thinking..." : (hasCode ? "Updating..." : "Building...")}</span>
              </>
            ) : (
              <>
                {chatMode === 'ask' ? <MessageSquare size={16} /> : (isChatActive ? <Edit2 size={16} /> : <Wand2 size={16} />)}
                <span>{chatMode === 'ask' ? "Ask" : (isChatActive ? "Update App" : "Build App")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
