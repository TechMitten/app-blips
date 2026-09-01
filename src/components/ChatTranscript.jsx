import { Loader2 } from 'lucide-react';

// Prompt/reply bubbles for past versions plus the in-flight pending prompt.
// `chatBottomRef` anchors the auto-scroll-to-bottom effect in App.
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
    <div className="space-y-4">
      {versions.slice(0, currentVersionIndex + 1).map((ver) => (
        <div key={ver.id} className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium shadow-sm">
              {ver.prompt}
            </div>
          </div>
          {ver.reply && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-800 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                {ver.reply}
              </div>
            </div>
          )}
        </div>
      ))}
      {pendingPrompt && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium shadow-sm">
              {pendingPrompt}
            </div>
          </div>
          {streamingReply ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-800 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap animate-fade-in">
                {streamingReply}
              </div>
            </div>
          ) : isGenerating ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-500 px-4 py-2.5 text-sm flex items-center gap-2 animate-fade-in">
                <Loader2 className="animate-spin text-indigo-500" size={14} />
                <span className="text-xs font-medium">{chatMode === 'ask' ? 'Thinking...' : 'Building app...'}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
