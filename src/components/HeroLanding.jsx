import { useState } from 'react';
import { TriangleAlert, RotateCcw, X } from 'lucide-react';
import HeroSidebar from './HeroSidebar';
import PromptInput from './PromptInput';
import StarterIdeas from './StarterIdeas';
import { loadHeroRailCollapsed, saveHeroRailCollapsed } from '../lib/config';

const COPY = {
  ask: {
    title: 'What would you like to know?',
    subtitle: 'Ask about your app, or anything else.',
  },
  website: {
    title: 'What website should we build?',
    subtitle: 'Describe your site, then click to edit it.',
  },
  app: {
    title: 'What should we build?',
    subtitle: "Describe your app in plain words. We'll build it.",
  },
};

// First-build screen: a side rail plus one centered prompt on a brand-colored
// gradient. It renders in place of the whole workspace (Header + build/preview
// panes) while the chat is empty, and App swaps to the workspace the moment the
// first prompt is submitted. It owns no generation state -- the prompt,
// attachment and mode state all live in App and are shared with the composer
// the workspace uses later, so nothing typed here is lost in the hand-off.
export default function HeroLanding({
  studioMode = 'app',
  chatMode,
  onChatModeChange,
  aiEnabled,
  onAiEnabledChange,
  prompt,
  onPromptChange,
  onSubmit,
  onCancelGeneration,
  isGenerating,
  attachment,
  attachmentError,
  isCapturingScreenshot,
  onAttachScreenshot,
  onAttachFile,
  onRemoveAttachment,
  starterIdeas,
  starterSampleSize,
  onPickStarter,
  error,
  interruptedJob,
  onRetryInterruptedJob,
  onDismissInterruptedJob,
  ...sidebarProps
}) {
  const [railCollapsed, setRailCollapsed] = useState(loadHeroRailCollapsed);
  const toggleRail = () => {
    const next = !railCollapsed;
    setRailCollapsed(next);
    saveHeroRailCollapsed(next);
  };

  const copy = COPY[chatMode === 'ask' ? 'ask' : studioMode === 'website' ? 'website' : 'app'];

  return (
    <div className="hero-landing dark force-dark flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row">
      <HeroSidebar
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
        {...sidebarProps}
      />

      <div className="flex-1 min-h-0 min-w-0 flex px-1.5 pb-1.5 lg:pl-0 lg:pt-1.5">
        <main className="hero-stage flex-1 min-w-0 overflow-y-auto chat-scrollbar animate-fade-in">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
            <div className="flex flex-col items-center gap-3 text-center animate-stagger-1">
              <h1 className="hero-title text-3xl sm:text-4xl lg:text-[2.6rem] font-black tracking-tight leading-[1.1]">
                {copy.title}
              </h1>
              <p className="hero-subtitle max-w-[52ch] text-sm font-medium leading-relaxed">
                {copy.subtitle}
              </p>
            </div>

            <div className="hero-composer w-full max-w-2xl animate-stagger-2">
              <PromptInput
                prompt={prompt}
                onPromptChange={onPromptChange}
                onSubmit={onSubmit}
                onCancelGeneration={onCancelGeneration}
                isGenerating={isGenerating}
                isChatActive={false}
                hasCode={false}
                chatMode={chatMode}
                onChatModeChange={onChatModeChange}
                isClarifying={false}
                studioMode={studioMode}
                attachment={attachment}
                attachmentError={attachmentError}
                isCapturingScreenshot={isCapturingScreenshot}
                onAttachScreenshot={onAttachScreenshot}
                onAttachFile={onAttachFile}
                onRemoveAttachment={onRemoveAttachment}
                aiEnabled={aiEnabled}
                onAiEnabledChange={onAiEnabledChange}
                voiceInput
              />
            </div>

            {interruptedJob && (
              <div role="alert" className="w-full max-w-2xl rounded-2xl border border-amber-300 bg-amber-50/90 dark:border-amber-300/30 dark:bg-amber-500/15 p-3.5 backdrop-blur-sm animate-fade-in">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-200" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200">Build interrupted</p>
                    <p className="truncate text-xs font-semibold text-amber-950 dark:text-white" title={interruptedJob.prompt}>
                      &ldquo;{interruptedJob.prompt}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={onRetryInterruptedJob}
                      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100 dark:border-amber-300/40 dark:bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-900 dark:text-amber-50 transition-colors hover:bg-amber-200 dark:hover:bg-amber-400/30"
                    >
                      <RotateCcw size={11} aria-hidden="true" />
                      Retry
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onDismissInterruptedJob}
                    className="shrink-0 cursor-pointer rounded-lg p-1 text-amber-700 dark:text-amber-200 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Dismiss"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="w-full max-w-2xl rounded-2xl border border-rose-200 bg-rose-50/90 dark:border-rose-300/30 dark:bg-rose-500/20 p-3.5 backdrop-blur-sm animate-fade-in">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-200" aria-hidden="true" />
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rose-800 dark:text-rose-200">Error</p>
                    <p className="text-xs font-semibold leading-snug text-rose-950 dark:text-white">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="w-full max-w-2xl animate-stagger-3">
              <StarterIdeas
                variant="chips"
                ideas={starterIdeas}
                sampleSize={starterSampleSize}
                onPick={(starter) => onPickStarter(starter.prompt)}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
