import { Loader2, RotateCcw, User } from 'lucide-react';
import { useState } from 'react';
import Markdown from './Markdown';
import ImageLightbox from './ImageLightbox';

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

function PromptRow({ children, className = '', onRewind }) {
  return (
    <div className="group flex items-start justify-end gap-2.5">
      {onRewind && (
        <button
          type="button"
          onClick={onRewind}
          className="chat-rewind-btn self-center p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer"
          aria-label="Rewind project to this message"
          title="Rewind project to this message"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      )}
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
  generationStatus = null,
  chatMode,
  studioMode = 'app',
  chatBottomRef,
  onRewind,
}) {
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
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
        const versionIndex = startIndex + idx;
        const versionNumber = versionIndex + 1;
        const canRewind = onRewind && !isGenerating && versionIndex < currentVersionIndex;
        return (
          <div key={ver.id} className="space-y-2.5">
            <PromptRow onRewind={canRewind ? () => onRewind(versionIndex) : undefined}>{ver.prompt}</PromptRow>
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
              <button
                type="button"
                onClick={() => setIsAttachmentOpen(true)}
                aria-label="View attached image full size"
                title="View full size"
                className="block cursor-zoom-in"
              >
                <img
                  src={pendingAttachment.dataUrl}
                  alt={pendingAttachment.name || 'Attached image'}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-300 dark:border-white/15 shadow-xs animate-fade-in"
                />
              </button>
              {isAttachmentOpen && (
                <ImageLightbox
                  src={pendingAttachment.dataUrl}
                  alt={pendingAttachment.name || 'Attached image'}
                  onClose={() => setIsAttachmentOpen(false)}
                />
              )}
            </div>
          )}
          <PromptRow className="animate-fade-in">{pendingPrompt}</PromptRow>
          {streamingReply ? (
            <ReplyRow className="animate-fade-in">
              <Markdown text={streamingReply} />
            </ReplyRow>
          ) : isGenerating ? (
            <ReplyRow className="animate-fade-in flex items-center gap-2.5">
              <Loader2 className="animate-spin text-indigo-600 dark:text-white" size={14} />
              <span className="text-[length:var(--chat-label-text)] font-bold">
                {chatMode === 'ask' ? 'Thinking...' : `Building ${studioMode === 'website' ? 'website' : 'app'}...`}
              </span>
            </ReplyRow>
          ) : null}
          {/* The reply above usually finishes long before the work does; keep a
              live progress line so the pauses after the edits are explained. */}
          {isGenerating && streamingReply && generationStatus && chatMode !== 'ask' && (
            <div
              key={generationStatus}
              role="status"
              className="flex items-center gap-2 pl-1 text-[length:var(--chat-label-text)] font-semibold text-slate-500 dark:text-white/60 animate-fade-in"
            >
              <Loader2 className="animate-spin shrink-0" size={12} />
              <span>{generationStatus}</span>
            </div>
          )}
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
