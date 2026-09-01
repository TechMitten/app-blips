import { RefreshCw } from 'lucide-react';
import StarterIdeas from './StarterIdeas';
import ChatTranscript from './ChatTranscript';
import SuggestionsBar from './SuggestionsBar';
import PromptInput from './PromptInput';

// Left-hand prompt/chat pane: hero header, starter ideas, chat transcript and
// the fixed bottom input area (suggestions + prompt). The generation flow and
// all state live in App; this is presentational composition.
export default function BuildPanel({
  width,
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
}) {
  return (
    <div
      className="w-full md:w-[var(--build-pane-width)] min-h-0 overflow-hidden flex flex-col bg-surface z-20 flex-shrink-0 relative"
      style={{ '--build-pane-width': `${width}px` }}
    >
      {/* Subtle atmospheric gradient */}
      <div className="absolute inset-0 pointer-events-none z-0 prompt-atmosphere" />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-8 xl:px-10 2xl:px-12 pt-5 lg:pt-6 2xl:pt-8 pb-3 flex flex-col justify-start relative z-[1] chat-scrollbar">
        <div className="max-w-2xl w-full mx-auto space-y-4 xl:space-y-5 2xl:space-y-6 animate-fade-in">

          {/* Header Section */}
          <div className={isChatActive ? 'refine-card' : 'relative'}>
            {!isChatActive && (
              <div className="pointer-events-none absolute -top-8 left-0 right-0 h-44 hero-atmosphere" aria-hidden="true" />
            )}
            <div className="space-y-2.5 sm:space-y-3 relative">
              {isChatActive ? (
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-[0.14em] bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                    {isResumingProject ? 'Loading' : (generatedCode ? 'Editing Mode' : 'Building Mode')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 pt-0.5">
                  <span className="orion-belt" aria-hidden="true">
                    <span className="orion-dot" />
                    <span className="orion-dot orion-dot-mid" />
                    <span className="orion-dot" />
                  </span>
                </div>
              )}
              <h2 className="text-3xl sm:text-4xl lg:text-[2.5rem] xl:text-[2.85rem] 2xl:text-[3.3rem] font-bold tracking-tight text-slate-900 leading-[1.08]">
                {isChatActive ? (
                  <>
                    {isResumingProject ? 'Loading' : (generatedCode ? (chatMode === 'ask' ? 'Ask about' : 'Refine') : 'Building')}{' '}
                    <span className="bg-gradient-to-r from-indigo-600 to-blue-600 dark:from-slate-900 dark:to-slate-600 bg-clip-text text-transparent">your app</span>
                  </>
                ) : (
                  <>What do you want to <span className="bg-gradient-to-r from-indigo-600 to-blue-600 dark:from-slate-900 dark:to-slate-600 bg-clip-text text-transparent">build?</span></>
                )}
              </h2>
              <p className="text-slate-600 text-sm sm:text-base xl:text-lg 2xl:text-xl leading-relaxed max-w-[36ch]">
                {isChatActive
                  ? (isResumingProject ? "Reopening your saved project." : (generatedCode ? (chatMode === 'ask' ? "Ask questions to understand the codebase." : "Describe what to change, add, or fix.") : "Orion is synthesizing your application from your prompt."))
                  : "Describe an idea in plain words and Orion turns it into a complete, working app."}
              </p>
            </div>
          </div>

          {/* Starter Prompts */}
          {showStarterIdeas && (
            <StarterIdeas
              ideas={starterIdeas}
              isGenerating={isGeneratingStarters}
              onRefresh={onGenerateStarters}
              onPick={(starter) => onPickStarter(starter.prompt)}
            />
          )}

          {(versions.length > 0 || pendingPrompt) && (
            <ChatTranscript
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              pendingPrompt={pendingPrompt}
              streamingReply={streamingReply}
              isGenerating={isGenerating}
              chatMode={chatMode}
              chatBottomRef={chatBottomRef}
            />
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl backdrop-blur-sm animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-rose-100 rounded-lg text-rose-600 flex-shrink-0">
                  <RefreshCw size={15} />
                </div>
                <div>
                  <p className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-0.5">Error</p>
                  <p className="text-[13px] text-rose-800 font-medium leading-snug">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Input Area */}
      <div className="shrink-0 p-3 sm:p-3.5 pt-2 border-t border-slate-200/80 bg-surface/95 backdrop-blur-md relative z-[1]">
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
        />
      </div>
    </div>
  );
}
