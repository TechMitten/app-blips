import { TriangleAlert, RotateCcw, X, Wand2, MessageSquare, Zap, Palette, Sparkles } from 'lucide-react';
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
  isGeneratingStarters,
  onGenerateStarters,
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
      className="h-full w-full min-h-0 overflow-hidden flex flex-col bg-surface z-20 shrink-0 relative @container border-b md:border-b-0 md:border-r border-slate-200"
    >
      {/* Subtle atmospheric gradient */}
      <div className={`absolute inset-0 pointer-events-none z-0 prompt-atmosphere ${!isChatActive ? 'prompt-atmosphere-hero' : ''}`} />

      {/* Studio Panel Header Bar — aligns horizontally with PreviewPane's header */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 2xl:py-3.5 border-b border-slate-200 bg-surface/95 backdrop-blur-md z-10">
        {/* Left: Section identity & status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="nav-segmented-group -ml-1 sm:-ml-[5px] flex items-center gap-2 px-3 py-1.5">
            <span className="shrink-0 text-indigo-500">
              {chatMode === 'ask' ? <MessageSquare size={14} /> : <Wand2 size={14} />}
            </span>
            <span className="font-semibold text-xs sm:text-sm text-slate-800 truncate">
              {isChatActive ? (chatMode === 'ask' ? 'Assistant' : 'Builder') : 'Prompt & Build'}
            </span>
            {(isGenerating || isResumingProject) && (
              <span className="status-dot animate-pulse shrink-0" aria-hidden="true" />
            )}
            {generatedCode && versions.length > 0 && (
              <span className="status-tick shrink-0 text-[10px] py-0.5 px-1.5">
                v{Math.min(currentVersionIndex + 1, versions.length)}
              </span>
            )}
          </div>
        </div>

        {/* Right: Quick actions / mode pill */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isChatActive && !isGenerating ? (
            <div className="nav-segmented-group nav-segmented-compact" role="radiogroup" aria-label="Chat mode">
              <button
                type="button"
                onClick={() => onChatModeChange('build')}
                className={`nav-segmented-btn text-xs py-1.5 px-2.5 font-semibold ${chatMode === 'build' ? 'nav-segmented-btn-active' : ''}`}
              >
                <Wand2 size={12} aria-hidden="true" />
                <span>Build</span>
              </button>
              <button
                type="button"
                onClick={() => onChatModeChange('ask')}
                className={`nav-segmented-btn text-xs py-1.5 px-2.5 font-semibold ${chatMode === 'ask' ? 'nav-segmented-btn-active' : ''}`}
              >
                <MessageSquare size={12} aria-hidden="true" />
                <span>Ask</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 select-none py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Ready</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 flex flex-col relative z-[1] chat-scrollbar">
        <div className={`w-full max-w-xl mx-auto space-y-4 animate-fade-in ${isChatActive ? 'mt-auto' : 'my-auto'}`}>

          {/* Header: compact hero while empty, instrument status once conversation exists */}
          {isChatActive ? (
            <header className="chat-status pb-2 mb-2 border-b border-slate-200/60">
              <div className="flex items-center gap-2 mb-1 min-h-[20px]">
                {(isGenerating || isResumingProject) && (
                  <span className="status-dot animate-pulse" aria-hidden="true" />
                )}
                {generatedCode && versions.length > 0 && (
                  <span className="status-tick">
                    v{Math.min(currentVersionIndex + 1, versions.length)}
                  </span>
                )}
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {statusWord}
                </span>
              </div>
              <p className="text-slate-500 text-xs leading-relaxed">
                {isGenerating && generationStatus ? generationStatus : statusLine}
              </p>
            </header>
          ) : (
            <div className="space-y-3 relative">
              <div className="space-y-2 relative">
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="orion-belt" aria-hidden="true">
                    <span className="orion-dot" />
                    <span className="orion-dot orion-dot-mid" />
                    <span className="orion-dot" />
                  </span>
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-slate-500">
                    AI App Generator
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 leading-tight">
                  What do you want to{' '}
                  <span className="bg-gradient-to-r from-indigo-500 to-blue-500 dark:from-indigo-400 dark:to-sky-300 bg-clip-text text-transparent">
                    build?
                  </span>
                </h2>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed max-w-[34ch]">
                  Describe an idea in plain words. AppBlips turns it into a complete, interactive single-file app.
                </p>
              </div>
            </div>
          )}

          {/* Starter Prompts */}
          {showStarterIdeas && (
            <>
              <StarterIdeas
                ideas={starterIdeas}
                isGenerating={isGeneratingStarters}
                onRefresh={onGenerateStarters}
                onPick={(starter) => onPickStarter(starter.prompt)}
              />
              <div className="pt-2.5 flex items-center justify-between text-[11px] text-slate-500 font-medium border-t border-slate-200/60">
                <span className="inline-flex items-center gap-1.5">
                  <Zap size={12} className="text-indigo-500" aria-hidden="true" />
                  Instant Preview
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Palette size={12} className="text-indigo-500" aria-hidden="true" />
                  Tailwind Built-in
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={12} className="text-indigo-500" aria-hidden="true" />
                  Natural Edits
                </span>
              </div>
            </>
          )}

          {(versions.length > 0 || pendingPrompt) && (
            <>
              {interruptedJob && (
                <div role="alert" className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 p-3 rounded-xl animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 bg-amber-100 dark:bg-amber-900/50 rounded-lg text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5">
                      <TriangleAlert size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-[0.14em] mb-0.5">Build interrupted</p>
                      <p className="text-xs text-amber-900 dark:text-amber-200 font-medium leading-snug truncate" title={interruptedJob.prompt}>
                        &ldquo;{interruptedJob.prompt}&rdquo;
                      </p>
                    </div>
                    <button
                      onClick={onDismissInterruptedJob}
                      className="p-1 rounded-md text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors flex-shrink-0 cursor-pointer"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-2 pl-8">
                    <button
                      onClick={onRetryInterruptedJob}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900/70 transition-colors px-2.5 py-1 rounded-lg cursor-pointer"
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
            <div role="alert" className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 p-3.5 rounded-xl backdrop-blur-sm animate-fade-in">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 bg-rose-100 dark:bg-rose-900/50 rounded-lg text-rose-600 dark:text-rose-400 flex-shrink-0">
                  <TriangleAlert size={14} />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-[0.14em] mb-0.5">Error</p>
                  <p className="text-xs text-rose-800 dark:text-rose-200 font-medium leading-snug">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Input Area */}
      <div className="shrink-0 p-3 sm:p-3.5 border-t border-slate-200 bg-surface/95 backdrop-blur-md relative z-[1]">
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
