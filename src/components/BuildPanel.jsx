import { TriangleAlert, RotateCcw, X, Wand2, MessageSquare } from 'lucide-react';
import StarterIdeas from './StarterIdeas';
import ChatTranscript from './ChatTranscript';
import SuggestionsBar from './SuggestionsBar';
import PromptInput from './PromptInput';

// Left-hand prompt/chat pane: studio header, starter ideas, chat transcript and
// the fixed bottom input area (suggestions + prompt). The generation flow and
// all state live in App; this is presentational composition.
export default function BuildPanel({
  isChatActive,
  isResumingProject,
  chatMode,
  generatedCode,
  showStarterIdeas,
  starterIdeas,
  onPickStarter,
  versions,
  currentVersionIndex,
  pendingPrompt,
  streamingReply,
  isGenerating,
  generationStatus,
  isAutoFixing = false,
  error,
  prompt,
  onPromptChange,
  onSubmit,
  onCancelGeneration,
  onChatModeChange,
  chatBottomRef,
  contextualSuggestions,
  isSuggestionsLoading,
  isSuggestionsExpanded,
  setIsSuggestionsExpanded,
  onRefreshSuggestions,
  onPickSuggestion,
  interruptedJob = null,
  onRetryInterruptedJob,
  onDismissInterruptedJob,
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
        ? 'Repairing runtime error in preview.'
        : generatedCode
          ? (chatMode === 'ask'
            ? 'Ask anything about this app.'
            : 'Describe what to change, add, or fix.')
          : 'Synthesizing your app from your prompt.';

  return (
    <div
      className="build-panel h-full w-full min-h-0 overflow-hidden flex flex-col bg-surface z-20 shrink-0 relative @container border-b md:border-b-0 md:border-r border-slate-300/90 dark:border-white/10"
    >
      {/* Subtle atmospheric gradient */}
      <div className={`absolute inset-0 pointer-events-none z-0 prompt-atmosphere ${!isChatActive ? 'prompt-atmosphere-hero' : ''}`} />

      {/* Studio Panel Header Bar — aligns horizontally with PreviewPane's header */}
      <div className="build-panel-header h-14 sm:h-16 shrink-0 flex items-center justify-between px-4 sm:px-5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#14161f] shadow-xs z-10">
        {/* Left: Section identity & status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-white/10 dark:text-white dark:border dark:border-white/15 shadow-sm">
            <span className="w-5 h-5 rounded-lg bg-indigo-500 text-white flex items-center justify-center shadow-2xs shrink-0">
              {chatMode === 'ask' ? <MessageSquare size={13} strokeWidth={2.5} /> : <Wand2 size={13} strokeWidth={2.5} />}
            </span>
            <span className="font-black text-xs sm:text-sm tracking-tight truncate">
              {isChatActive ? (chatMode === 'ask' ? 'Assistant' : 'Builder') : 'Prompt & Build'}
            </span>
            {(isGenerating || isResumingProject) && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
              </span>
            )}
            {generatedCode && versions.length > 0 && (
              <span className="shrink-0 text-[10px] font-mono font-black py-0.5 px-1.5 rounded-md bg-indigo-600 text-white shadow-2xs">
                v{Math.min(currentVersionIndex + 1, versions.length)}
              </span>
            )}
          </div>
        </div>

        {/* Right: Quick actions / mode pill */}
        {isChatActive && !isGenerating && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="nav-segmented-group nav-segmented-compact p-0.5 bg-slate-100 dark:bg-white/[0.08] border-2 border-slate-200 dark:border-white/10 rounded-xl shadow-2xs" role="radiogroup" aria-label="Chat mode">
              <button
                type="button"
                onClick={() => onChatModeChange('build')}
                className={`nav-segmented-btn text-xs py-1 px-3 font-black rounded-lg transition-all ${chatMode === 'build' ? 'nav-segmented-btn-active shadow-sm text-white bg-indigo-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}
              >
                <Wand2 size={12} aria-hidden="true" />
                <span>Build</span>
              </button>
              <button
                type="button"
                onClick={() => onChatModeChange('ask')}
                className={`nav-segmented-btn text-xs py-1 px-3 font-black rounded-lg transition-all ${chatMode === 'ask' ? 'nav-segmented-btn-active shadow-sm text-white bg-indigo-600' : 'text-slate-700 dark:text-white/70 hover:text-indigo-600 dark:hover:text-white'}`}
              >
                <MessageSquare size={12} aria-hidden="true" />
                <span>Ask</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="build-panel-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5 flex flex-col relative z-[1] chat-scrollbar">
        <div className={`build-panel-stage w-full max-w-xl mx-auto space-y-4 animate-fade-in ${isChatActive ? 'mt-auto' : 'my-auto'}`}>

          {/* Header: compact hero while empty, instrument status once conversation exists */}
          {isChatActive ? (
            <header className="chat-status p-4 rounded-2xl border-2 border-slate-300/90 dark:border-white/15 bg-white dark:bg-[#181a24] shadow-sm space-y-2">
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
            <div className="relative p-5 sm:p-6 rounded-3xl border-2 border-indigo-500/30 dark:border-indigo-500/40 bg-white dark:bg-[#181a24] shadow-md space-y-3.5 overflow-hidden">
              {/* Top vibrant rainbow/gradient accent bar */}
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-400" />
              
              {/* Background ambient radial glow */}
              <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-gradient-to-br from-indigo-500/15 via-blue-500/10 to-transparent rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white font-mono text-[11px] font-black uppercase tracking-[0.16em] shadow-sm">
                  <span className="orion-belt" aria-hidden="true">
                    <span className="orion-dot bg-white" />
                    <span className="orion-dot orion-dot-mid bg-amber-300" />
                    <span className="orion-dot bg-white" />
                  </span>
                  AI Studio
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 dark:text-white leading-tight">
                What do you want to{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 dark:from-indigo-400 dark:via-blue-400 dark:to-cyan-400">
                  build?
                </span>
              </h2>

              <p className="text-slate-700 dark:text-white/80 text-xs sm:text-sm font-medium leading-relaxed">
                Describe your idea in plain words to generate an interactive app in seconds.
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
                pendingPrompt={pendingPrompt}
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
        {generatedCode && !isGenerating && chatMode === 'build' && (isSuggestionsLoading || contextualSuggestions.length > 0) && (
          <SuggestionsBar
            suggestions={contextualSuggestions}
            isLoading={isSuggestionsLoading}
            isExpanded={isSuggestionsExpanded}
            setIsExpanded={setIsSuggestionsExpanded}
            onRefresh={onRefreshSuggestions}
            onPick={onPickSuggestion}
          />
        )}
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
        />
      </div>
    </div>
  );
}
