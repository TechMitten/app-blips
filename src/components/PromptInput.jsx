import { useEffect, useRef, useState } from 'react';
import { Wand2, Loader2, X, Paperclip, Camera, Send } from 'lucide-react';

// The mode control is one slot-machine reel with three stops. "AI" means Build
// with AI text generation enabled, so the three are mutually exclusive and
// clicking the reel advances: Build -> Ask -> AI -> Build.
const MODE_SEQUENCE = ['build', 'ask', 'ai'];
const MODE_LABELS = { build: 'Build', ask: 'Ask', ai: 'AI' };
const MODE_INDEX = { build: 0, ask: 1, ai: 2 };
const REEL_EXTRA_CYCLES = 3;   // full extra turns added to every spin
const REEL_NORMALIZE_AT = 30;  // multiple of 3; rewind here to keep it finite
const REEL_ITEM_COUNT = 40;
const REEL_ITEMS = Array.from({ length: REEL_ITEM_COUNT }, (_, i) => MODE_SEQUENCE[i % 3]);

// Prompt textarea with the Build/Ask mode toggle and submit/cancel footer.
// Desktop Enter sends; touch keyboards keep Enter for newlines. Cmd/Ctrl+Enter sends.
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
  studioMode = 'app',
  attachment = null,
  attachmentError = null,
  isCapturingScreenshot = false,
  onAttachScreenshot,
  onAttachFile,
  onRemoveAttachment,
  aiEnabled,
  onAiEnabledChange,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const canSubmit = !isGenerating && !isEnhancingPrompt && prompt.trim().length > 0;
  const canEnhance = chatMode === 'build' && !isClarifying && !isGenerating && !isEnhancingPrompt && prompt.trim().length > 0;
  const showEnhanceButton = chatMode === 'build' && !isClarifying;

  // AI is the third reel stop and means "Build + AI", so the exposed mode is
  // derived from both chatMode and aiEnabled; the reel animates to that stop.
  const selectedMode = chatMode === 'ask' ? 'ask' : aiEnabled ? 'ai' : 'build';

  const [reelIndex, setReelIndex] = useState(MODE_INDEX[selectedMode]);
  const [spinning, setSpinning] = useState(false);
  const [lastMode, setLastMode] = useState(selectedMode);
  if (lastMode !== selectedMode) {
    setLastMode(selectedMode);
    setSpinning(true);
    setReelIndex((index) => {
      const delta = ((MODE_INDEX[selectedMode] - (index % 3)) % 3 + 3) % 3;
      return index + delta + REEL_EXTRA_CYCLES;
    });
  }
  const handleReelEnd = (event) => {
    if (event.propertyName !== 'transform') return;
    setSpinning(false);
    setReelIndex((index) => (index >= REEL_NORMALIZE_AT ? index - REEL_NORMALIZE_AT : index));
  };
  const cycleMode = () => {
    const next = MODE_SEQUENCE[(MODE_INDEX[selectedMode] + 1) % 3];
    const wantsMode = next === 'ask' ? 'ask' : 'build';
    const wantsAi = next === 'ai';
    if (wantsMode !== chatMode) onChatModeChange(wantsMode);
    if (wantsAi !== aiEnabled) onAiEnabledChange?.(wantsAi);
  };

  useEffect(() => {
    const resize = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      const maxHeight = Math.min(176, parseFloat(getComputedStyle(el).maxHeight) || 176);
      el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [prompt]);

  useEffect(() => {
    if (isClarifying && !isGenerating) {
      textareaRef.current?.focus();
    }
  }, [isClarifying, isGenerating]);

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !window.matchMedia('(pointer: coarse)').matches && !(e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)) {
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

  const isWebsite = studioMode === 'website';
  const noun = isWebsite ? 'Website' : 'App';

  const submitLabel = isGenerating
    ? (chatMode === 'ask' ? 'Thinking...' : (isClarifying ? 'Answering...' : (hasCode ? `Updating ${noun}...` : `Building ${noun}...`)))
    : (chatMode === 'ask' ? 'Send' : (isClarifying ? 'Answer' : (isChatActive ? `Update ${noun}` : `Build ${noun}`)));

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
                : isWebsite
                  ? (isChatActive
                    ? "e.g. Change the hero photo, add a pricing section..."
                    : "e.g. A one-page site for a cozy neighborhood bakery...")
                  : (isChatActive
                    ? "e.g. Make the background dark, add a reset button..."
                    : "e.g. A minimalist task manager with categories...")
          }
          className={`prompt-input-field w-full min-h-[56px] sm:min-h-[66px] max-h-40 px-5 pt-4 pb-2 outline-none resize-none text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 text-sm font-medium leading-relaxed bg-transparent custom-scrollbar ${showEnhanceButton ? 'pr-11' : ''}`}
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
      <div className="prompt-input-footer flex flex-wrap items-center justify-between gap-2 px-3 sm:px-3.5 pb-3 pt-1.5">
        <div className="flex items-center gap-x-2 gap-y-2">
          {!isGenerating ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="prompt-input-mode">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach an image from your device"
                  title="Attach an image from your device"
                  className="chat-mode-option !min-w-[var(--composer-key-size)] !p-0"
                >
                  <Paperclip size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onAttachScreenshot}
                  disabled={!hasCode || isCapturingScreenshot}
                  aria-label={isCapturingScreenshot ? 'Capturing preview screenshot...' : 'Attach a screenshot of the preview'}
                  title={!hasCode ? 'Build an app first to screenshot the preview' : (isCapturingScreenshot ? 'Capturing preview screenshot...' : 'Attach a screenshot of the preview')}
                  className="chat-mode-option !min-w-[var(--composer-key-size)] !p-0"
                >
                  {isCapturingScreenshot ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} aria-hidden="true" />}
                </button>
              </div>
              <button
                type="button"
                onClick={cycleMode}
                aria-label={`${MODE_LABELS[selectedMode]} mode. Activate to switch mode.`}
                title={`${MODE_LABELS[selectedMode]} mode — click to switch`}
                className={`chat-mode-reel${spinning ? ' is-spinning' : ''}`}
              >
                <span className="chat-mode-reel-window" aria-hidden="true">
                  <span
                    className={`chat-mode-reel-track ${spinning ? 'is-spinning' : ''}`}
                    style={{ transform: `translateY(calc(${-reelIndex} * var(--composer-key-size)))` }}
                    onTransitionEnd={handleReelEnd}
                  >
                    {REEL_ITEMS.map((word, index) => (
                      <span key={index} className="chat-mode-reel-item">{MODE_LABELS[word]}</span>
                    ))}
                  </span>
                </span>
              </button>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isGenerating && (
            <button
              onClick={onCancelGeneration}
              className="prompt-input-cancel composer-key composer-key-danger !rounded-full"
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={18} />
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={submitLabel}
            title={submitLabel}
            className="prompt-input-action composer-key prompt-input-send !rounded-full"
          >
            {isGenerating ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
