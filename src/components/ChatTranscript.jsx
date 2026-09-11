import { Loader2 } from 'lucide-react';
import Markdown from './Markdown';

// Prompt/reply bubbles drawn as the project's star path: a hairline meridian
// with one star node per version (echoing the History sidebar's v-badges), a
// hollow "forming" node on the in-flight turn, and a mono caret while
// streaming. `chatBottomRef` anchors the auto-scroll-to-bottom effect in App.
export default function ChatTranscript({
  versions,
  currentVersionIndex,
  startIndex = 0,
  pendingPrompt,
  pendingAttachment = null,
  streamingReply,
  isGenerating,
  chatMode,
  chatBottomRef,
}) {
  return (
    <div className="chat-log space-y-3.5 pb-1" role="log" aria-label="Build conversation">
      {startIndex > 0 && (
        <div
          className="flex items-center gap-3 pt-1"
          role="separator"
          aria-label="New chat started"
          title="Earlier messages remain in version history — restore a version to bring them back."
        >
          <div className="h-px flex-1 bg-slate-300/80 dark:bg-white/10" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40 whitespace-nowrap">
            New chat
          </span>
          <div className="h-px flex-1 bg-slate-300/80 dark:bg-white/10" />
        </div>
      )}
      {versions.slice(startIndex, currentVersionIndex + 1).map((ver, idx) => {
        const isActive = startIndex + idx === currentVersionIndex;
        return (
          <div key={ver.id} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-xs bg-indigo-600 dark:bg-[#262A34] text-white dark:text-[#F1F5F9] px-4 py-2.5 text-[length:var(--chat-prompt-text)] font-semibold shadow-xs border border-indigo-500/40 dark:border-[rgba(255,255,255,0.12)]">
                {ver.prompt}
              </div>
            </div>
            {ver.reply && (
              <div className="relative flex justify-start">
                <span className="star-anchor" aria-hidden="true">
                  <span className={`star-node ${isActive ? 'star-node-active' : ''}`} />
                  <span className={`star-tick ${isActive ? 'star-tick-active' : ''}`}>v{startIndex + idx + 1}</span>
                </span>
                <div className="max-w-[88%] rounded-2xl rounded-bl-xs bg-blue-50/80 backdrop-blur-md dark:backdrop-blur-none dark:bg-[#1D2A4A] border border-blue-200/60 dark:border-[#2D3E6B] shadow-none dark:shadow-xs text-slate-900 dark:text-[#E2E8F0] px-4 py-3 text-[length:var(--chat-text)] leading-relaxed">
                  <Markdown text={ver.reply} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {pendingPrompt && (
        <div className="space-y-1.5">
          {pendingAttachment && (
            <div className="flex justify-end">
              <img
                src={pendingAttachment.dataUrl}
                alt={pendingAttachment.name || 'Attached image'}
                className="w-16 h-16 rounded-xl object-cover border-2 border-indigo-500/40 dark:border-white/15 shadow-xs animate-fade-in"
              />
            </div>
          )}
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-xs bg-indigo-600 dark:bg-[#262A34] text-white dark:text-[#F1F5F9] px-4 py-2.5 text-[length:var(--chat-prompt-text)] font-semibold shadow-xs border border-indigo-500/40 dark:border-[rgba(255,255,255,0.12)] animate-fade-in">
              {pendingPrompt}
            </div>
          </div>
          {streamingReply ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-2xl rounded-bl-xs bg-blue-50/80 backdrop-blur-md dark:backdrop-blur-none dark:bg-[#1D2A4A] border border-blue-200/60 dark:border-[#2D3E6B] shadow-none dark:shadow-xs text-slate-900 dark:text-[#E2E8F0] px-4 py-3 text-[length:var(--chat-text)] leading-relaxed animate-fade-in">
                <Markdown text={streamingReply} />
              </div>
            </div>
          ) : isGenerating ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-2xl rounded-bl-xs bg-blue-50/80 backdrop-blur-md dark:backdrop-blur-none dark:bg-[#1D2A4A] border border-blue-200/60 dark:border-[#2D3E6B] shadow-none dark:shadow-xs text-slate-800 dark:text-[#E2E8F0] px-4 py-2.5 text-[length:var(--chat-prompt-text)] flex items-center gap-2.5 animate-fade-in">
                <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={14} />
                <span className="text-[length:var(--chat-label-text)] font-bold text-slate-800 dark:text-[#E2E8F0]">{chatMode === 'ask' ? 'Thinking...' : 'Building app...'}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
