import { Brain, Check, Copy, Loader2, RotateCcw, ShieldCheck, User, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from './Markdown';
import ImageLightbox from './ImageLightbox';
import ThinkingElapsed from './ThinkingElapsed';
import { displayBuildPrompt, displayBuildReply } from '../lib/buildMessages';
import { STUDIO_MODES } from '../lib/constants';
import { loadReviewPhotoUrls } from '../lib/reviewPhotos';

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

// Colours for the copy key on each bubble: the user's bubble is solid indigo
// (dark slate in dark mode), so its key is a light tint rather than the slate
// used on the pale reply bubble.
const COPY_TONES = {
  user: 'text-white/70 hover:text-white hover:bg-white/15',
  bot: 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/5 dark:text-white/55 dark:hover:text-white dark:hover:bg-white/10',
};

// Copies the message as written (a reply keeps its Markdown). The tick shows
// for a moment so the click has visible feedback; if the clipboard is blocked
// the tooltip says so, and the bubble text stays selectable as a fallback.
// It sits in the bubble's bottom-right corner; the negative margins pull it
// into the padding so it doesn't add a full line under short messages.
function CopyMessageButton({ text, tone }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!state) return undefined;
    const timer = setTimeout(() => setState(null), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  if (!text) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy. Select the text and copy it yourself.' : 'Copy message';
  return (
    <div className="flex justify-end -mr-2.5 -mb-2 mt-1">
      <button
        type="button"
        onClick={copy}
        className={`chat-copy-btn inline-flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer ${COPY_TONES[tone]}`}
        aria-label={label}
        title={label}
      >
        {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function PromptRow({ children, className = '', onRewind, copyText }) {
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
        <CopyMessageButton text={copyText} tone="user" />
      </div>
      <UserAvatar />
    </div>
  );
}

function ReplyRow({ title, className = '', copyText, children }) {
  return (
    <div className="flex items-start justify-start gap-2.5">
      <BotAvatar title={title} />
      <div
        className={`${BUBBLE_MAX} chat-bubble chat-bubble-bot rounded-2xl px-4 py-3 text-[length:var(--chat-text)] leading-relaxed ${className}`}
      >
        {children}
        <CopyMessageButton text={copyText} tone="bot" />
      </div>
    </div>
  );
}

// Shown under a finished build while its review offer is open. Reviews spend
// extra tokens, so the user chooses; the choice is saved with the version.
function ReviewOffer({ onReview, onSkip }) {
  return (
    <div className="pl-[3.25rem] animate-fade-in">
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3.5 py-3 space-y-2.5">
        <p className="flex items-start gap-2 text-[length:var(--chat-label-text)] text-slate-600 dark:text-white/70 leading-relaxed">
          <ShieldCheck size={14} className="shrink-0 mt-0.5 text-brand" aria-hidden="true" />
          <span>Want the AI to screenshot and test this in the browser, then write a report? If it finds problems, you choose whether to fix them. Uses extra tokens.</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReview}
            className="brand-fill-text rounded-lg px-3 py-1.5 bg-brand text-white text-[length:var(--chat-label-text)] font-semibold hover:bg-brand-hover transition-colors"
          >
            Review
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-slate-300 dark:border-white/15 px-3 py-1.5 text-[length:var(--chat-label-text)] font-semibold text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// The screenshot each problem in a review report cites, as proof of the
// claim. Photos missing from storage (a project restored from a backup) are
// left out.
function ReviewEvidence({ problems, projectId }) {
  const [urls, setUrls] = useState({});
  const [open, setOpen] = useState(null);
  const hashes = [...new Set(problems.map((item) => item.photo).filter(Boolean))];
  const key = hashes.join(',');
  useEffect(() => {
    let cancelled = false;
    let loaded = {};
    loadReviewPhotoUrls(projectId, key ? key.split(',') : [])
      .then((result) => {
        loaded = result;
        if (cancelled) Object.values(result).forEach((url) => URL.revokeObjectURL(url));
        else setUrls(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      Object.values(loaded).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [projectId, key]);
  const shown = problems.map((item, i) => ({ ...item, number: i + 1 })).filter((item) => urls[item.photo]);
  if (!shown.length) return null;
  return (
    <div className="pl-[3.25rem] animate-fade-in">
      <p className="text-[length:var(--chat-label-text)] font-semibold text-slate-600 dark:text-white/70 mb-1.5">Screenshot evidence</p>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((item) => (
          <button
            key={item.number}
            type="button"
            onClick={() => setOpen(item)}
            title={item.seenIn ? `Open full size: ${item.seenIn}` : 'Open full size'}
            className="text-left rounded-lg border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 p-1.5 cursor-zoom-in hover:border-brand transition-colors"
          >
            <img
              src={urls[item.photo]}
              alt={`Screenshot showing problem ${item.number}: ${item.title}`}
              className="w-full h-24 object-cover object-top rounded"
            />
            <span className="block mt-1 text-[length:var(--chat-label-text)] leading-snug text-slate-700 dark:text-white/80 line-clamp-2">
              {item.number}. {item.title}
            </span>
          </button>
        ))}
      </div>
      {open && (
        <ImageLightbox
          src={urls[open.photo]}
          alt={`Screenshot showing problem ${open.number}: ${open.title}`}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// Shown under a review report that found problems. Nothing is changed until
// the user says so; fixing starts a new chat whose only request is the report.
function FixOffer({ onFix, onSkip }) {
  return (
    <div className="pl-[3.25rem] animate-fade-in">
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3.5 py-3 space-y-2.5">
        <p className="flex items-start gap-2 text-[length:var(--chat-label-text)] text-slate-600 dark:text-white/70 leading-relaxed">
          <Wrench size={14} className="shrink-0 mt-0.5 text-brand" aria-hidden="true" />
          <span>Want the AI to fix these problems? A new chat starts with this report as its task, and the fixes are saved as a new version you can undo.</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFix}
            className="brand-fill-text rounded-lg px-3 py-1.5 bg-brand text-white text-[length:var(--chat-label-text)] font-semibold hover:bg-brand-hover transition-colors"
          >
            Fix problems
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-slate-300 dark:border-white/15 px-3 py-1.5 text-[length:var(--chat-label-text)] font-semibold text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Not now
          </button>
        </div>
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
  thinkingSince = null,
  chatMode,
  studioMode = 'app',
  chatBottomRef,
  onRewind,
  canOfferReview = false,
  onReview,
  onSkipReview,
  canOfferFix = false,
  onFixReview,
  onSkipFix,
  projectId = null,
}) {
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
  return (
    <div className="chat-log select-text space-y-4 pb-1" role="log" aria-label="Build conversation">
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
            <PromptRow onRewind={canRewind ? () => onRewind(versionIndex) : undefined} copyText={displayBuildPrompt(ver)}>{displayBuildPrompt(ver)}</PromptRow>
            {ver.reply && (
              <ReplyRow title={`Version ${versionNumber}`} copyText={displayBuildReply(ver)}>
                <Markdown text={displayBuildReply(ver)} />
              </ReplyRow>
            )}
            {ver.editMode === 'review' && ver.qualityReview?.problems?.some((item) => item.photo) && (
              <ReviewEvidence problems={ver.qualityReview.problems} projectId={projectId} />
            )}
            {canOfferReview && ver.reviewOffer === 'pending' && versionIndex === currentVersionIndex && !isGenerating && !pendingPrompt && (
              <ReviewOffer onReview={onReview} onSkip={onSkipReview} />
            )}
            {canOfferFix && ver.fixOffer === 'pending' && versionIndex === currentVersionIndex && !isGenerating && !pendingPrompt && (
              <FixOffer onFix={onFixReview} onSkip={onSkipFix} />
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
          <PromptRow className="animate-fade-in" copyText={pendingPrompt}>{pendingPrompt}</PromptRow>
          {streamingReply ? (
            <ReplyRow className="animate-fade-in">
              <Markdown text={streamingReply} />
            </ReplyRow>
          ) : isGenerating && thinkingSince ? (
            <ReplyRow className="animate-fade-in flex items-center gap-2.5">
              <Brain className="animate-pulse text-indigo-600 dark:text-white" size={14} />
              <span role="status" className="text-[length:var(--chat-label-text)] font-bold">
                Thinking… <span className="font-semibold text-slate-500 dark:text-white/60"><ThinkingElapsed since={thinkingSince} /></span>
              </span>
            </ReplyRow>
          ) : isGenerating ? (
            <ReplyRow className="animate-fade-in flex items-center gap-2.5">
              <Loader2 className="animate-spin text-indigo-600 dark:text-white" size={14} />
              <span className="text-[length:var(--chat-label-text)] font-bold">
                {chatMode === 'ask' ? 'Thinking...' : generationStatus || `Building ${STUDIO_MODES[studioMode]?.article || 'app'}...`}
              </span>
            </ReplyRow>
          ) : null}
          {/* The reply above usually finishes long before the work does; keep a
              live progress line so the pauses after the edits are explained. */}
          {isGenerating && streamingReply && thinkingSince && chatMode !== 'ask' ? (
            <div
              role="status"
              className="flex items-center gap-2 pl-1 text-[length:var(--chat-label-text)] font-semibold text-slate-500 dark:text-white/60 animate-fade-in"
            >
              <Brain className="animate-pulse shrink-0" size={12} />
              <span>Thinking… <ThinkingElapsed since={thinkingSince} /></span>
            </div>
          ) : isGenerating && streamingReply && generationStatus && chatMode !== 'ask' && (
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
