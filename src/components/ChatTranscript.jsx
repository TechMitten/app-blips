import { Loader2 } from 'lucide-react';
import Markdown from './Markdown';

// Prompt/reply bubbles drawn as the project's star path: a hairline meridian
// with one star node per version (echoing the History sidebar's v-badges), a
// hollow "forming" node on the in-flight turn, and a mono caret while
// streaming. `chatBottomRef` anchors the auto-scroll-to-bottom effect in App.
export default function ChatTranscript({
  versions,
  currentVersionIndex,
  pendingPrompt,
  streamingReply,
  isGenerating,
  chatMode,
  chatBottomRef,
}) {
  return (
    <div className="chat-log space-y-3 pb-1" role="log" aria-label="Build conversation">
      {versions.slice(0, currentVersionIndex + 1).map((ver, idx) => {
        const isActive = idx === currentVersionIndex;
        return (
          <div key={ver.id} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-xl rounded-br-xs bg-indigo-600 dark:bg-blue-400 text-white px-3.5 py-2 text-[length:var(--chat-prompt-text)] font-medium shadow-2xs">
                {ver.prompt}
              </div>
            </div>
            {ver.reply && (
              <div className="relative flex justify-start">
                <span className="star-anchor" aria-hidden="true">
                  <span className={`star-node ${isActive ? 'star-node-active' : ''}`} />
                  <span className={`star-tick ${isActive ? 'star-tick-active' : ''}`}>v{idx + 1}</span>
                </span>
                <div className="max-w-[88%] rounded-xl rounded-bl-xs bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/10 shadow-2xs text-slate-800 dark:text-slate-700 px-3.5 py-2.5 text-[length:var(--chat-text)] leading-relaxed">
                  <Markdown text={ver.reply} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {pendingPrompt && (
        <div className="space-y-1.5">
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-xl rounded-br-xs bg-indigo-600 dark:bg-blue-400 text-white px-3.5 py-2 text-[length:var(--chat-prompt-text)] font-medium shadow-2xs animate-fade-in">
              {pendingPrompt}
            </div>
          </div>
          {streamingReply ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-xl rounded-bl-xs bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/10 shadow-2xs text-slate-800 dark:text-slate-700 px-3.5 py-2.5 text-[length:var(--chat-text)] leading-relaxed animate-fade-in">
                <Markdown text={streamingReply} />
              </div>
            </div>
          ) : isGenerating ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-xl rounded-bl-xs bg-white dark:bg-white/[0.04] border border-slate-200/90 dark:border-white/10 shadow-2xs text-slate-600 dark:text-slate-400 px-3.5 py-2 text-[length:var(--chat-prompt-text)] flex items-center gap-2 animate-fade-in">
                <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={14} />
                <span className="text-[length:var(--chat-label-text)] font-medium text-slate-700 dark:text-slate-400">{chatMode === 'ask' ? 'Thinking...' : 'Building app...'}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
