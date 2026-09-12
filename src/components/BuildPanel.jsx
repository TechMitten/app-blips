import { TriangleAlert, RotateCcw, X, Wand2, MessageSquare, Plus } from 'lucide-react';
import StarterIdeas from './StarterIdeas';
import ChatTranscript from './ChatTranscript';
import PromptInput from './PromptInput';

// Left-hand prompt/chat pane: studio header, starter ideas, chat transcript and
// the fixed bottom input area (prompt). The generation flow and
// all state live in App; this is presentational composition.
export default function BuildPanel({
  isChatActive,
  isResumingProject,
  chatMode,
  aiEnabled = false,
  onAiEnabledChange,
  generatedCode,
  showStarterIdeas,
  starterIdeas,
  onPickStarter,
  versions,
  currentVersionIndex,
  chatContextStartIndex = 0,
  pendingPrompt,
  pendingAttachment = null,
  streamingReply,
  isGenerating,
  generationStatus,
  isAutoFixing = false,
  error,
  prompt,
  onPromptChange,
  onSubmit,
  onEnhancePrompt,
  isEnhancingPrompt = false,
  onCancelGeneration,
  onChatModeChange,
  onNewChat,
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
  const statusWord = isResumingProject
    ? 'Restoring'
    : isClarifying
      ? 'Clarifying'
      : isAutoFixing
        ? 'Auto-fixing'
        : generatedCode
          ? (chatMode === 'ask' ? 'Ask' : 'Editing')
          : 'Building';
  const statusLine = isResumingProject
    ? 'Opening your saved project.'
    : isClarifying
      ? (generatedCode
        ? 'Answer the question above to continue editing.'
        : 'Answer the question above to continue building.')
      : isAutoFixing
        ? (generationStatus?.toLowerCase().includes('syntax')
          ? 'Repairing syntax error in code.'
          : 'Repairing runtime error in preview.')
        : generatedCode
          ? (chatMode === 'ask'
            ? 'Ask anything about this app.'
            : 'Describe what to change, add, or fix.')
          : 'Synthesizing your app from your prompt.';

  return (
    <div
      className="build-panel h-full w-full min-h-0 overflow-hidden flex flex-col bg-surface z-20 shrink-0 relative @container border-b md:border-b-0 md:border-r border-slate-200/80 dark:border-white/10"
    >
      {/* Subtle atmospheric gradient */}
      <div className={`absolute inset-0 pointer-events-none z-0 prompt-atmosphere ${!isChatActive ? 'prompt-atmosphere-hero' : ''}`} />

      {/* Studio Panel Header Bar — aligns horizontally with PreviewPane's header */}
      <div className="build-panel-header h-14 sm:h-16 shrink-0 flex items-center justify-between px-4 sm:px-5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#14161f] shadow-xs z-10">
        {/* Left: Section identity & status */}
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <div className="build-badge flex min-w-0 items-center gap-2.5 px-3 py-1.5 rounded-xl text-white">
            <span className="build-badge-icon w-5 h-5 rounded-lg text-white flex items-center justify-center shrink-0">
              {chatMode === 'ask' ? <MessageSquare size={13} strokeWidth={2.5} /> : <Wand2 size={13} strokeWidth={2.5} />}
            </span>
            <span className="build-badge-label font-black text-xs sm:text-sm tracking-tight truncate">
              {isChatActive ? (chatMode === 'ask' ? 'Ask' : 'Build') : 'Prompt & Build'}
            </span>
            {(isGenerating || isResumingProject) && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
              </span>
            )}
            {generatedCode && versions.length > 0 && (
              <span className="shrink-0 text-[10px] font-mono font-black py-0.5 px-1.5 rounded-md bg-blue-600 text-white shadow-2xs">
                v{Math.min(currentVersionIndex + 1, versions.length)}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Right: Quick actions */}
        {isChatActive && versions.length > 0 && !isGenerating && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onNewChat}
              className="new-chat-btn inline-flex items-center justify-center p-1.5 rounded-lg text-slate-900 dark:text-white hover:text-slate-600 dark:hover:text-white/80 hover:scale-110 transition-all cursor-pointer"
              aria-label="New chat (keeps version history)"
              title="New chat (keeps version history)"
            >
              <Plus size={20} strokeWidth={3} aria-hidden="true" />
            </button>
          </div>
        )}
        </div>
      </div>

      <div className="build-panel-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5 md:mr-1.5 flex flex-col relative z-[1] chat-scrollbar">
        <div className={`build-panel-stage w-full max-w-xl mx-auto space-y-4 animate-fade-in ${isChatActive ? 'mt-auto' : 'mt-4 sm:mt-8 mb-auto'}`}>

          {/* Header: compact hero while empty, instrument status once conversation exists */}
          {isChatActive ? (
            <header className="chat-status p-4 rounded-2xl border border-slate-900/8 dark:border-white/15 dark:border-2 bg-white/55 backdrop-blur-md dark:backdrop-blur-none dark:bg-[#181a24] shadow-none dark:shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2 min-h-[22px]">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {(isGenerating || isResumingProject) ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600 dark:bg-indigo-400" />
                      </>
                    ) : (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    )}
                  </span>
                  <span className="font-mono text-xs font-black uppercase tracking-[0.16em] text-slate-900 dark:text-white">
                    {statusWord}
                  </span>
                </div>
                {generatedCode && versions.length > 0 && (
                  <span className="status-tick text-[10px] font-mono font-black px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/40 shadow-2xs">
                    v{Math.min(currentVersionIndex + 1, versions.length)} of {versions.length}
                  </span>
                )}
              </div>
              <p className="text-slate-700 dark:text-white/80 text-xs leading-relaxed font-semibold">
                {isGenerating && generationStatus ? generationStatus : statusLine}
              </p>
            </header>
          ) : (
            <div className="hero-card relative p-5 sm:p-6 rounded-3xl space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="hero-blips" aria-hidden="true">
                  <span className="hero-blip hero-blip-cyan" />
                  <span className="hero-blip hero-blip-brand" />
                  <span className="hero-blip hero-blip-coral" />
                </span>
                <span className="font-mono text-[10px] sm:text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 dark:text-white/50">
                  {chatMode === 'ask' ? 'Plain answers, no build' : 'Prompt in, app out'}
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 dark:text-white leading-tight">
                {chatMode === 'ask' ? 'How can I help you today?' : 'What do you want to build?'}
              </h2>

              <p className="text-slate-700 dark:text-white/80 text-xs sm:text-sm font-medium leading-relaxed">
                {chatMode === 'ask'
                  ? 'Get a plain answer about your app, or anything else — no build required.'
                  : "Describe it in plain words. We'll ship a working app in seconds."}
              </p>
            </div>
          )}

          {/* Starter Prompts */}
          {showStarterIdeas && (
            <StarterIdeas
              ideas={starterIdeas}
              onPick={(starter) => onPickStarter(starter.prompt)}
            />
          )}

          {(versions.length > 0 || pendingPrompt) && (
            <>
              {interruptedJob && (
                <div role="alert" className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 p-3.5 rounded-2xl shadow-xs backdrop-blur-sm animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 bg-amber-100 dark:bg-amber-900/60 rounded-xl text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-700/50 flex-shrink-0 mt-0.5 shadow-2xs">
                      <TriangleAlert size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-[0.14em] mb-0.5">Build interrupted</p>
                      <p className="text-xs text-amber-950 dark:text-amber-100 font-semibold leading-snug truncate" title={interruptedJob.prompt}>
                        &ldquo;{interruptedJob.prompt}&rdquo;
                      </p>
                    </div>
                    <button
                      onClick={onDismissInterruptedJob}
                      className="p-1 rounded-lg text-amber-600 hover:bg-amber-100/80 dark:hover:bg-amber-900/60 transition-colors flex-shrink-0 cursor-pointer"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-2.5 pl-8">
                    <button
                      onClick={onRetryInterruptedJob}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-100 bg-amber-100/90 dark:bg-amber-900/70 hover:bg-amber-200 dark:hover:bg-amber-800 border border-amber-300/80 dark:border-amber-700/60 transition-all px-3 py-1.5 rounded-xl cursor-pointer shadow-2xs"
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
                chatMode={chatMode}
                chatBottomRef={chatBottomRef}
              />
            </>
          )}

          {error && (
            <div role="alert" className="bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 p-3.5 rounded-2xl shadow-xs backdrop-blur-sm animate-fade-in">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 bg-rose-100 dark:bg-rose-900/60 rounded-xl text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-700/50 flex-shrink-0 shadow-2xs">
                  <TriangleAlert size={14} />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-bold text-rose-800 dark:text-rose-300 uppercase tracking-[0.14em] mb-0.5">Error</p>
                  <p className="text-xs text-rose-950 dark:text-rose-100 font-semibold leading-snug">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Input Area */}
      <div className="build-panel-composer shrink-0 p-3 sm:p-4 border-t border-slate-200/90 dark:border-white/10 bg-surface/95 backdrop-blur-xl relative z-[1]">
        <PromptInput
          prompt={prompt}
          onPromptChange={onPromptChange}
          onSubmit={onSubmit}
          onEnhancePrompt={onEnhancePrompt}
          isEnhancingPrompt={isEnhancingPrompt}
          onCancelGeneration={onCancelGeneration}
          isGenerating={isGenerating}
          isChatActive={isChatActive}
          hasCode={Boolean(generatedCode)}
          chatMode={chatMode}
          onChatModeChange={onChatModeChange}
          isClarifying={isClarifying}
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
