import { TriangleAlert, RotateCcw, X, Plus, History } from 'lucide-react';
import StarterIdeas from './StarterIdeas';
import ChatTranscript from './ChatTranscript';
import PromptInput from './PromptInput';

// Left-hand prompt/chat pane: studio header, starter ideas, chat transcript and
// the fixed bottom input area (prompt). The generation flow and
// all state live in App; this is presentational composition.
export default function BuildPanel({
  isChatActive,
  chatMode,
  studioMode = 'app',
  aiEnabled = false,
  onAiEnabledChange,
  generatedCode,
  showStarterIdeas,
  starterIdeas,
  starterSampleSize,
  onPickStarter,
  versions,
  currentVersionIndex,
  chatContextStartIndex = 0,
  pendingPrompt,
  pendingAttachment = null,
  streamingReply,
  isGenerating,
  generationStatus = null,
  error,
  prompt,
  onPromptChange,
  onSubmit,
  onCancelGeneration,
  onChatModeChange,
  onNewChat,
  isHistoryOpen = false,
  onToggleHistory,
  onRewind,
  chatBottomRef,
  interruptedJob = null,
  onRetryInterruptedJob,
  onDismissInterruptedJob,
  attachment = null,
  attachmentError = null,
  isCapturingScreenshot = false,
  onAttachScreenshot,
  onAttachFile,
  onRemoveAttachment,
}) {
  const isClarifying = chatMode === 'build' && versions[currentVersionIndex]?.editMode === 'clarify';

  return (
    <div
      className="build-panel h-full w-full min-h-0 overflow-hidden flex flex-col bg-surface z-20 shrink-0 relative @container border-b md:border-b-0 md:border-r border-slate-200/80 dark:border-white/10"
    >
      {/* Subtle atmospheric gradient */}
      <div className={`absolute inset-0 pointer-events-none z-0 prompt-atmosphere ${!isChatActive ? 'prompt-atmosphere-hero' : ''}`} />

      {/* Studio Panel Header Bar — aligns horizontally with PreviewPane's header */}
      <div className="build-panel-header h-14 sm:h-16 shrink-0 flex items-center justify-end px-4 sm:px-5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#14161f] shadow-xs z-10">
        {/* Quick actions */}
        <button
          type="button"
          onClick={onToggleHistory}
          className={`history-header-toggle mr-2 inline-flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer ${isHistoryOpen ? 'text-indigo-500 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15' : 'text-slate-500 dark:text-white/70 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'}`}
          aria-label={isHistoryOpen ? 'Hide history' : 'Show history'}
          aria-expanded={isHistoryOpen}
          title={isHistoryOpen ? 'Hide history' : 'Show history'}
        >
          <History size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-tour="newchat"
          onClick={onNewChat}
          disabled={isGenerating}
          className="new-chat-btn inline-flex items-center justify-center p-1.5 rounded-lg text-slate-900 dark:text-white hover:text-slate-600 dark:hover:text-white/80 hover:scale-110 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          aria-label="New chat (keeps version history)"
          title="New chat (keeps version history)"
        >
          <Plus size={20} strokeWidth={3} aria-hidden="true" />
        </button>
      </div>

      <div className="build-panel-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5 md:mr-1.5 flex flex-col relative z-1 chat-scrollbar">
        <div className={`build-panel-stage w-full max-w-xl mx-auto space-y-4 animate-fade-in ${isChatActive ? 'mt-auto' : 'mt-4 sm:mt-8 mb-auto'}`}>

          {/* Empty-state intro: the brand blips carry the mark, and the
              product's own mechanism is the headline. No card here — the
              composer below is the single surface on this screen. */}
          {!isChatActive && (
            <div className="hero-intro relative space-y-3">
              <span className="hero-blips" aria-hidden="true">
                <span className="hero-blip hero-blip-cyan" />
                <span className="hero-blip hero-blip-brand" />
                <span className="hero-blip hero-blip-coral" />
              </span>

              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950 dark:text-white leading-[1.08]">
                {chatMode === 'ask' ? (
                  <>Ask anything.<br />Build nothing.</>
                ) : studioMode === 'website' ? (
                  <>Prompt in.<br />Website out.</>
                ) : (
                  <>Prompt in.<br />App out.</>
                )}
              </h2>

              <p className="text-slate-700 dark:text-white/80 text-sm font-medium leading-relaxed max-w-[44ch]">
                {chatMode === 'ask'
                  ? 'Get a straight answer about your app, or anything else.'
                  : studioMode === 'website'
                    ? "Describe the website you want in plain words. We'll build a working version in seconds — then click any element in the preview to edit it."
                    : "Describe the app you want in plain words. We'll build a working version in seconds — interactive, and it saves your data."}
              </p>
            </div>
          )}

          {/* Starter Prompts */}
          {showStarterIdeas && (
            <StarterIdeas
              ideas={starterIdeas}
              sampleSize={starterSampleSize}
              onPick={(starter) => onPickStarter(starter.prompt)}
            />
          )}

          {(versions.length > 0 || pendingPrompt) && (
            <>
              {interruptedJob && (
                <div role="alert" className="bg-amber-50/90 border border-amber-200 p-3.5 rounded-2xl shadow-xs backdrop-blur-sm animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 bg-amber-100 rounded-xl text-amber-700 border border-amber-200/80 shrink-0 mt-0.5 shadow-2xs">
                      <TriangleAlert size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[10px] font-bold text-amber-800 uppercase tracking-[0.14em] mb-0.5">Build interrupted</p>
                      <p className="text-xs text-amber-950 font-semibold leading-snug truncate" title={interruptedJob.prompt}>
                        &ldquo;{interruptedJob.prompt}&rdquo;
                      </p>
                    </div>
                    <button
                      onClick={onDismissInterruptedJob}
                      className="p-1 rounded-lg text-amber-600 hover:bg-amber-100/80 transition-colors shrink-0 cursor-pointer"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-2.5 pl-8">
                    <button
                      onClick={onRetryInterruptedJob}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-100/90 hover:bg-amber-200 border border-amber-300/80 transition-all px-3 py-1.5 rounded-xl cursor-pointer shadow-2xs"
                    >
                      <RotateCcw size={11} />
                      Retry
                    </button>
                  </div>
                </div>
              )}
              <ChatTranscript
                versions={versions}
                currentVersionIndex={currentVersionIndex}
                startIndex={chatContextStartIndex}
                pendingPrompt={pendingPrompt}
                pendingAttachment={pendingAttachment}
                streamingReply={streamingReply}
                isGenerating={isGenerating}
                generationStatus={generationStatus}
                chatMode={chatMode}
                studioMode={studioMode}
                chatBottomRef={chatBottomRef}
                onRewind={onRewind}
              />
            </>
          )}

          {error && (
            <div role="alert" className="bg-rose-50/90 border border-rose-200 p-3.5 rounded-2xl shadow-xs backdrop-blur-sm animate-fade-in">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 bg-rose-100 rounded-xl text-rose-700 border border-rose-200/80 shrink-0 shadow-2xs">
                  <TriangleAlert size={14} />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-bold text-rose-800 uppercase tracking-[0.14em] mb-0.5">Error</p>
                  <p className="text-xs text-rose-950 font-semibold leading-snug">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Input Area */}
      <div className="build-panel-composer shrink-0 p-3 sm:p-4 border-t border-slate-200/90 dark:border-white/10 bg-surface/95 backdrop-blur-xl relative z-1">
        <PromptInput
          prompt={prompt}
          onPromptChange={onPromptChange}
          onSubmit={onSubmit}
          onCancelGeneration={onCancelGeneration}
          isGenerating={isGenerating}
          isChatActive={isChatActive}
          hasCode={Boolean(generatedCode)}
          chatMode={chatMode}
          onChatModeChange={onChatModeChange}
          isClarifying={isClarifying}
          studioMode={studioMode}
          attachment={attachment}
          attachmentError={attachmentError}
          isCapturingScreenshot={isCapturingScreenshot}
          onAttachScreenshot={onAttachScreenshot}
          onAttachFile={onAttachFile}
          onRemoveAttachment={onRemoveAttachment}
          aiEnabled={aiEnabled}
          onAiEnabledChange={onAiEnabledChange}
        />
      </div>
    </div>
  );
}
