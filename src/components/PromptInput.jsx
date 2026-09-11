import { useEffect, useRef } from 'react';
import { Wand2, MessageSquare, Edit2, Loader2, X, Paperclip, Camera } from 'lucide-react';

// Prompt textarea with the Build/Ask mode toggle and submit/cancel footer.
// Enter sends (Shift+Enter for a newline); Cmd/Ctrl+Enter keeps working too.
// The textarea auto-grows to a cap before scrolling.
export default function PromptInput({
  prompt,
  onPromptChange,
  onSubmit,
  onEnhancePrompt,
  isEnhancingPrompt = false,
  onCancelGeneration,
  isGenerating,
  isChatActive,
  hasCode,
  chatMode,
  onChatModeChange,
  isClarifying,
  attachment = null,
  attachmentError = null,
  isCapturingScreenshot = false,
  onAttachScreenshot,
  onAttachFile,
  onRemoveAttachment,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const canSubmit = !isGenerating && !isEnhancingPrompt && prompt.trim().length > 0;
  const canEnhance = chatMode === 'build' && !isClarifying && !isGenerating && !isEnhancingPrompt && prompt.trim().length > 0;
  const showEnhanceButton = chatMode === 'build' && !isClarifying;

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

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (file) onAttachFile?.(file);
  };

  const submitLabel = isGenerating
    ? (chatMode === 'ask' ? 'Thinking...' : (isClarifying ? 'Answering...' : (hasCode ? 'Updating...' : 'Building...')))
    : (chatMode === 'ask' ? 'Send' : (isClarifying ? 'Answer' : (isChatActive ? 'Update App' : 'Build App')));

  return (
    <div data-tour="prompt" className="prompt-input-dock bg-white dark:bg-[#161824] rounded-2xl border-2 border-slate-300 dark:border-white/20 overflow-hidden transition-all shadow-md flex flex-col">
      {attachment && (
        <div className="flex items-center gap-2 px-3 sm:px-4 pt-3">
          <div className="relative shrink-0">
            <img
              src={attachment.dataUrl}
              alt={attachment.name || 'Attached image'}
              className="w-11 h-11 rounded-lg object-cover border-2 border-slate-300 dark:border-white/20 shadow-2xs"
            />
            <button
              type="button"
              onClick={onRemoveAttachment}
              aria-label="Remove attached image"
              title="Remove attached image"
              className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-4.5 h-4.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer"
            >
              <X size={10} strokeWidth={3} />
            </button>
          </div>
          <span className="text-xs font-semibold text-slate-600 dark:text-white/60 truncate">
            {attachment.name || 'Attached image'}
          </span>
        </div>
      )}
      {attachmentError && (
        <p className="px-3 sm:px-4 pt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{attachmentError}</p>
      )}
      <div className="relative">
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
          className={`prompt-input-field w-full min-h-[52px] sm:min-h-[62px] max-h-40 px-4 pt-3.5 pb-2 outline-none resize-none text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 text-sm font-medium leading-relaxed bg-transparent custom-scrollbar ${showEnhanceButton ? 'pr-11' : ''}`}
          disabled={isGenerating || isEnhancingPrompt}
        />
        {showEnhanceButton && prompt.trim().length > 0 && (
          <button
            type="button"
            onClick={onEnhancePrompt}
            disabled={!canEnhance}
            aria-label={isEnhancingPrompt ? 'Enhancing prompt...' : 'Enhance prompt with AI'}
            title={isEnhancingPrompt ? 'Enhancing prompt...' : 'Enhance prompt with AI'}
            className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-full text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-400/30 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {isEnhancingPrompt ? <Loader2 className="animate-spin" size={13} /> : <Wand2 size={13} />}
          </button>
        )}
      </div>
      <div className="prompt-input-footer flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-t-2 border-slate-200 dark:border-white/10 bg-slate-100/90 dark:bg-white/[0.04]">
        <div className="flex items-center gap-2 min-w-0">
          {!isGenerating ? (
            <>
              <div className="prompt-input-attach nav-segmented-group p-0.5 rounded-full border-2 border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.08] shadow-2xs flex items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach an image from your device"
                  title="Attach an image from your device"
                  className="nav-segmented-btn cursor-pointer w-8 h-8 !p-0 rounded-full transition-all text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white"
                >
                  <Paperclip size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onAttachScreenshot}
                  disabled={!hasCode || isCapturingScreenshot}
                  aria-label={isCapturingScreenshot ? 'Capturing preview screenshot...' : 'Attach a screenshot of the preview'}
                  title={!hasCode ? 'Build an app first to screenshot the preview' : (isCapturingScreenshot ? 'Capturing preview screenshot...' : 'Attach a screenshot of the preview')}
                  className="nav-segmented-btn cursor-pointer w-8 h-8 !p-0 rounded-full transition-all text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-700 dark:disabled:hover:text-white/70"
                >
                  {isCapturingScreenshot ? <Loader2 className="animate-spin" size={15} /> : <Camera size={15} aria-hidden="true" />}
                </button>
              </div>
              <div className="chat-mode-toggle prompt-input-mode nav-segmented-group p-0.5 rounded-full border-2 border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.08] shadow-2xs" role="radiogroup" aria-label="Chat mode">
                <label
                  className={`nav-segmented-btn cursor-pointer w-8 h-8 !p-0 rounded-full transition-all ${chatMode === 'build' ? 'nav-segmented-btn-active shadow-sm text-white bg-red-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}
                  title="Build mode"
                >
                  <input type="radio" name="chatMode" value="build" checked={chatMode === 'build'} onChange={() => onChatModeChange('build')} className="sr-only" />
                  <Wand2 size={15} aria-hidden="true" />
                  <span className="sr-only">Build</span>
                </label>
                <label
                  className={`nav-segmented-btn cursor-pointer w-8 h-8 !p-0 rounded-full transition-all ${chatMode === 'ask' ? 'nav-segmented-btn-active shadow-sm text-white bg-red-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}
                  title="Ask mode"
                >
                  <input type="radio" name="chatMode" value="ask" checked={chatMode === 'ask'} onChange={() => onChatModeChange('ask')} className="sr-only" />
                  <MessageSquare size={15} aria-hidden="true" />
                  <span className="sr-only">Ask</span>
                </label>
              </div>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="prompt-input-cancel inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-700 text-white border-2 border-rose-500 border-b-[3px] border-b-rose-900 dark:border-b-black/80 shadow-md transition-all hover:scale-105 active:translate-y-0.5 active:scale-100 active:border-b-2 cursor-pointer"
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={submitLabel}
            title={submitLabel}
            className={`prompt-input-action inline-flex items-center justify-center w-10 h-10 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              canSubmit
                ? 'bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-600 text-white border-2 border-indigo-500/50 border-b-[4px] border-b-indigo-950 dark:border-b-black/80 shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5 hover:scale-105 active:translate-y-0.5 active:scale-100 active:border-b-2 cursor-pointer'
                : 'bg-slate-200/90 dark:bg-white/[0.08] text-slate-600 dark:text-white/40 border-2 border-slate-300 dark:border-white/15 border-b-[3px] border-b-slate-400/80 dark:border-b-black/80 cursor-not-allowed shadow-xs'
            }`}
          >
            {isGenerating ? (
              <Loader2 className="animate-spin" size={17} />
            ) : chatMode === 'ask' ? (
              <MessageSquare size={17} />
            ) : isClarifying ? (
              <MessageSquare size={17} />
            ) : isChatActive ? (
              <Edit2 size={17} />
            ) : (
              <Wand2 size={17} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
