import { Loader2, User } from 'lucide-react';
import Markdown from './Markdown';

// Prompt/reply bubbles as a two-sided conversation: the person's turn on the
// right behind a neutral avatar, the app's reply on the left behind the
// AppBlips mark. `chatBottomRef` anchors the auto-scroll-to-bottom effect in
// App.
//
// This replaced an earlier "star path" treatment (a hairline meridian with one
// node + mono vN tick per version). The version each reply produced is still
// worth knowing, so it moved to the avatar's tooltip rather than disappearing
// -- the status header above the log carries the live "vN of N" readout.

const BUBBLE_MAX = 'max-w-[calc(100%-3.25rem)]';

function UserAvatar() {
  return (
    <span className="chat-avatar chat-avatar-user" aria-hidden="true">
      <User size={18} />
    </span>
  );
}

function BotAvatar({ title }) {
  return (
    <span className="chat-avatar chat-avatar-bot" title={title} aria-hidden="true">
      <img src="/android-chrome-192x192.png" alt="" />
    </span>
  );
}

function PromptRow({ children, className = '' }) {
  return (
    <div className="flex items-start justify-end gap-2.5">
      <div
        className={`${BUBBLE_MAX} chat-bubble chat-bubble-user rounded-2xl px-4 py-3 text-[length:var(--chat-prompt-text)] font-medium ${className}`}
      >
        {children}
      </div>
      <UserAvatar />
    </div>
  );
}

function ReplyRow({ title, className = '', children }) {
  return (
    <div className="flex items-start justify-start gap-2.5">
      <BotAvatar title={title} />
      <div
        className={`${BUBBLE_MAX} chat-bubble chat-bubble-bot rounded-2xl px-4 py-3 text-[length:var(--chat-text)] leading-relaxed ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

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
    <div className="chat-log space-y-4 pb-1" role="log" aria-label="Build conversation">
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
        const versionNumber = startIndex + idx + 1;
        return (
          <div key={ver.id} className="space-y-2.5">
            <PromptRow>{ver.prompt}</PromptRow>
            {ver.reply && (
              <ReplyRow title={`Version ${versionNumber}`}>
                <Markdown text={ver.reply} />
              </ReplyRow>
            )}
          </div>
        );
      })}
      {pendingPrompt && (
        <div className="space-y-2.5">
          {pendingAttachment && (
            <div className="flex justify-end pr-[3.25rem]">
              <img
                src={pendingAttachment.dataUrl}
                alt={pendingAttachment.name || 'Attached image'}
                className="w-16 h-16 rounded-xl object-cover border border-slate-300 dark:border-white/15 shadow-xs animate-fade-in"
              />
            </div>
          )}
          <PromptRow className="animate-fade-in">{pendingPrompt}</PromptRow>
          {streamingReply ? (
            <ReplyRow className="animate-fade-in">
              <Markdown text={streamingReply} />
            </ReplyRow>
          ) : isGenerating ? (
            <ReplyRow className="animate-fade-in flex items-center gap-2.5">
              <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-300" size={14} />
              <span className="text-[length:var(--chat-label-text)] font-bold">
                {chatMode === 'ask' ? 'Thinking...' : 'Building app...'}
              </span>
            </ReplyRow>
          ) : null}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
