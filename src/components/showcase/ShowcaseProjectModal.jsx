import { useEffect, useState } from 'react';
import {
  X, Share2, Shuffle, Maximize2, Smartphone, Tablet, Monitor, Loader2, Check, Copy, TriangleAlert
} from 'lucide-react';
import Modal from '../Modal';
import { showcaseShareUrl, KIND_LABELS } from '../../lib/showcase';

const DEVICES = {
  mobile: { label: 'Smartphone', Icon: Smartphone },
  tablet: { label: 'Tablet', Icon: Tablet },
  desktop: { label: 'Desktop', Icon: Monitor },
};

// The live project on the left, details and actions on the right. Projects
// are deployed apps on their own origin (e.g. my.appblips.com), so the frame
// can keep allow-same-origin -- which deployed apps need for their own
// localStorage -- without reaching this SPA. A URL on the SPA's own origin
// would undo that isolation, so it is never embedded; it only gets a link.
export default function ShowcaseProjectModal({ project, onClose, onRemix }) {
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [copied, setCopied] = useState('');
  const [remixing, setRemixing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const closeButton = (
    <button type="button" onClick={onClose} className="showcase-icon-btn" aria-label="Close">
      <X size={18} />
    </button>
  );

  if (!project) {
    return (
      <Modal zIndex={65} cardClass="w-full max-w-sm bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 p-6 animate-scale-in">
        <div className="flex justify-end">{closeButton}</div>
        <div className="flex flex-col items-center text-center gap-2 pb-2">
          <span className="showcase-empty-icon"><TriangleAlert size={24} /></span>
          <h2 className="text-lg font-bold text-slate-900">This project isn’t available</h2>
          <p className="text-sm text-slate-500">It may have been taken out of the showcase.</p>
        </div>
      </Modal>
    );
  }

  const embeddable = new URL(project.url).origin !== window.location.origin;
  const { label: deviceLabel, Icon: DeviceIcon } = DEVICES[project.device];
  const shareUrl = showcaseShareUrl(window.location.origin, project.id);

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setActionError('Could not copy to the clipboard.');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: project.title, text: `Check out “${project.title}”, made with AppBlips`, url: shareUrl });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    copy(shareUrl, 'share');
  };

  const handleRemix = async () => {
    setRemixing(true);
    setActionError('');
    try {
      await onRemix(project);
    } catch (err) {
      setActionError(err.message || 'Remix failed.');
    } finally {
      setRemixing(false);
    }
  };

  return (
    <Modal
      zIndex={65}
      scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4"
      cardClass="showcase-project-card w-full max-w-7xl bg-surface sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': project.title }}
    >
      <div className="showcase-project-layout">
        <div className="showcase-stage">
          <div className="showcase-stage-bar">
            <div className="showcase-device" aria-label={`Shown as ${deviceLabel}`}>
              <DeviceIcon size={15} />
              <span>{deviceLabel}</span>
            </div>
            <span className="showcase-stage-url" title={project.url}>{project.url.replace(/^https?:\/\//, '')}</span>
            <a href={project.url} target="_blank" rel="noopener noreferrer" className="showcase-stage-link" aria-label="Open full screen in a new tab">
              <Maximize2 size={15} /> <span className="hidden md:inline">Open</span>
            </a>
            <span className="sm:hidden ml-auto">{closeButton}</span>
          </div>
          <div className={`showcase-frame-wrap is-${project.device}`}>
            {embeddable ? (
              <>
                <iframe
                  src={project.url}
                  title={project.title}
                  onLoad={() => setFrameLoaded(true)}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
                  allow="clipboard-write; fullscreen; autoplay"
                  referrerPolicy="no-referrer"
                  className={`showcase-frame ${frameLoaded ? 'is-loaded' : ''}`}
                />
                {!frameLoaded && (
                  <div className="showcase-frame-loading">
                    <Loader2 size={26} className="animate-spin" />
                  </div>
                )}
              </>
            ) : (
              <div className="showcase-frame-loading">
                <a href={project.url} target="_blank" rel="noopener noreferrer" className="showcase-pill-btn pointer-events-auto">
                  <Maximize2 size={15} /> Open in a new tab
                </a>
              </div>
            )}
          </div>
        </div>

        <aside className="showcase-details custom-scrollbar">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="showcase-kind-tag">{KIND_LABELS[project.kind]}</span>
              <h2 className="mt-2 text-lg font-bold leading-snug text-slate-900 break-words">{project.title}</h2>
            </div>
            <span className="hidden sm:inline-flex">{closeButton}</span>
          </div>

          {project.description && (
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">{project.description}</p>
          )}

          <div className="showcase-actions">
            <button type="button" onClick={handleShare} className="showcase-action">
              {copied === 'share' ? <Check size={17} className="text-emerald-500" /> : <Share2 size={17} />}
              {copied === 'share' ? 'Copied' : 'Share'}
            </button>
            {project.source && (
              <button type="button" onClick={handleRemix} disabled={remixing} className="showcase-action showcase-action-primary">
                {remixing ? <Loader2 size={17} className="animate-spin" /> : <Shuffle size={17} />}
                Remix
              </button>
            )}
          </div>
          {project.source && (
            <p className="mt-2 text-xs text-slate-500">Remix copies this project into a new one of your own to keep building on.</p>
          )}
          {actionError && <p className="mt-2 text-xs font-medium text-rose-500">{actionError}</p>}

          {project.prompt && (
            <section className="showcase-prompt">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">The prompt</h3>
                <button type="button" onClick={() => copy(project.prompt, 'prompt')} className="showcase-ghost-btn">
                  {copied === 'prompt' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  {copied === 'prompt' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{project.prompt}</p>
            </section>
          )}
        </aside>
      </div>
    </Modal>
  );
}
