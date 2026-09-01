import { Loader2 } from 'lucide-react';

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
    <div className="chat-log space-y-4 pb-1" role="log" aria-label="Build conversation">
      {versions.slice(0, currentVersionIndex + 1).map((ver, idx) => {
        const isActive = idx === currentVersionIndex;
        return (
          <div key={ver.id} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-3.5 py-2.5 text-sm font-medium shadow-sm">
                {ver.prompt}
              </div>
            </div>
            {ver.reply && (
              <div className="relative flex justify-start">
                <span className="star-anchor" aria-hidden="true">
                  <span className={`star-node ${isActive ? 'star-node-active' : ''}`} />
                  <span className={`star-tick ${isActive ? 'star-tick-active' : ''}`}>v{idx + 1}</span>
                </span>
                <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-100 border border-slate-200/60 text-slate-800 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {ver.reply}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {pendingPrompt && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-3.5 py-2.5 text-sm font-medium shadow-sm animate-fade-in">
              {pendingPrompt}
            </div>
          </div>
          {streamingReply ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-100 border border-slate-200/60 text-slate-800 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap animate-fade-in">
                {streamingReply}
                <span className="stream-caret" aria-hidden="true" />
              </div>
            </div>
          ) : isGenerating ? (
            <div className="relative flex justify-start">
              <span className="star-anchor" aria-hidden="true">
                <span className="star-node star-node-pending" />
              </span>
              <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-100 border border-slate-200/60 text-slate-500 px-3.5 py-2.5 text-sm flex items-center gap-2 animate-fade-in">
                <Loader2 className="animate-spin text-indigo-500" size={14} />
                <span className="text-xs font-medium">{chatMode === 'ask' ? 'Thinking' : 'Building app'}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
