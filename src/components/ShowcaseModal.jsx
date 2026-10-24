import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CircleAlert, Plus, Sparkles, X } from 'lucide-react';
import Modal from './Modal';
import ShowcaseSubmitModal from './ShowcaseSubmitModal';
import { SHOWCASE_PROJECTS, loadShowcaseDoc, showcaseAction } from '../lib/showcase';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'app', label: 'Apps' },
  { key: 'website', label: 'Websites' },
  { key: 'game', label: 'Games' },
];

const ICON_BTN = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:hover:bg-white/[0.08] dark:hover:text-white';
const PILL_LINK = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:border-white/15 dark:hover:bg-white/[0.08]';

// The showcase pages are generated code like any preview, so they only ever
// run in a sandboxed frame without allow-same-origin (an opaque origin that
// can't reach the app's storage). Bundled exports go in as srcdoc because the
// app serves its own files with frame-ancestors 'none'; approved submissions
// are framed from their own address.
function ShowcaseFrame({ project, title, sandbox, className, style, tabIndex, onError }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    if (!project.file) return undefined;
    let cancelled = false;
    loadShowcaseDoc(project.file).then(
      (text) => { if (!cancelled) setDoc(text); },
      () => { if (!cancelled) onError?.(); },
    );
    return () => { cancelled = true; };
  }, [project.file, onError]);

  if (project.file && doc === null) return null;
  return (
    <iframe
      title={title}
      sandbox={sandbox}
      {...(project.file ? { srcDoc: doc } : { src: project.url })}
      referrerPolicy="no-referrer"
      tabIndex={tabIndex}
      className={className}
      style={style}
    />
  );
}

// A live, scaled-down 1280x800 render of the page (or its thumbnail image).
// The frame only mounts once the card scrolls into view, so opening the
// showcase doesn't start every game at once.
function ShowcaseThumbnail({ project }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0.25);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || project.thumbnail) return undefined;
    const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1280));
    resize.observe(container);
    const reveal = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      reveal.disconnect();
    }, { rootMargin: '200px' });
    reveal.observe(container);
    return () => {
      resize.disconnect();
      reveal.disconnect();
    };
  }, [project.thumbnail]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="relative aspect-[16/10] w-full overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-white/10"
      style={{ backgroundColor: project.background }}
    >
      {project.thumbnail ? (
        <img
          src={project.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : visible && (
        <ShowcaseFrame
          project={project}
          title={`${project.name} preview`}
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: 1280, height: 800, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

function ShowcaseViewer({ project, onBack, onClose }) {
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => setFailed(true), []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-white/10">
        <button type="button" onClick={onBack} aria-label="Back to the showcase" title="Back (Esc)" className={ICON_BTN}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="showcase-modal-title" className="truncate text-base font-semibold text-slate-900">{project.name}</h2>
          <p className="truncate text-xs text-slate-500">
            {project.category}{project.author ? ` · by ${project.author}` : ''}
          </p>
        </div>
        <a href={project.url} target="_blank" rel="noopener noreferrer" className={`${PILL_LINK} hidden sm:inline-flex`}>
          Open in browser
          <ArrowUpRight size={15} aria-hidden="true" />
        </a>
        <button type="button" onClick={onClose} aria-label="Close" className={ICON_BTN}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {failed ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-600">
          <CircleAlert size={20} className="text-red-600" aria-hidden="true" />
          This project couldn&rsquo;t be loaded.
          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-600 underline underline-offset-2">
            Open it in your browser instead
          </a>
        </div>
      ) : (
        // Games need focus for keyboard controls, so the frame isn't skipped
        // in the Tab order like the thumbnails are.
        <ShowcaseFrame
          project={project}
          title={`${project.name} interactive demo`}
          sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock"
          className="min-h-0 w-full flex-1 border-0"
          style={{ backgroundColor: project.background }}
          onError={handleError}
        />
      )}
    </div>
  );
}

// "Showcase", opened from the studio picker: the projects on
// appblips.com/showcase, playable in place, plus a way to submit your own.
export default function ShowcaseModal({ onClose }) {
  const [filter, setFilter] = useState('all');
  const [activeProject, setActiveProject] = useState(null);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);

  // Escape backs out one layer: the open project, then the showcase. The
  // submit dialog handles its own Escape (capture phase) while open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (activeProject) setActiveProject(null);
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeProject, onClose]);

  const counts = Object.fromEntries(FILTERS.map(({ key }) => [
    key, key === 'all' ? SHOWCASE_PROJECTS.length : SHOWCASE_PROJECTS.filter((p) => p.kind === key).length,
  ]));
  const visibleProjects = SHOWCASE_PROJECTS.filter((p) => filter === 'all' || p.kind === filter);

  return (
    <>
      <Modal
        zIndex={60}
        scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-2 sm:p-6 animate-fade-in"
        cardClass="w-full max-w-6xl bg-surface rounded-2xl border border-slate-200 shadow-2xl dark:bg-[#17171c] dark:border-white/12 dark:shadow-[0_24px_64px_-16px_rgb(0_0_0/0.9)] overflow-hidden flex flex-col h-[calc(100dvh-1rem)] sm:h-[min(900px,92vh)] animate-scale-in"
        cardProps={{ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'showcase-modal-title' }}
      >
        {activeProject ? (
          <ShowcaseViewer
            project={activeProject}
            onBack={() => setActiveProject(null)}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
              <div className="min-w-0">
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">
                  <Sparkles size={13} aria-hidden="true" />
                  Built with AppBlips
                </p>
                <h2 id="showcase-modal-title" className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                  Showcase
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Real projects, each built from one prompt. Explore a website or jump into a game.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSubmitOpen(true)}
                  className="brand-fill-text hidden h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 sm:inline-flex"
                >
                  <Plus size={16} aria-hidden="true" />
                  Submit yours
                </button>
                <button type="button" onClick={onClose} aria-label="Close" className={`${ICON_BTN} -mr-1.5 -mt-1`}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="shrink-0 border-b border-slate-200 px-5 pb-4 sm:px-6 dark:border-white/10">
              <div role="tablist" aria-label="Filter by type" className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-black/30 dark:ring-1 dark:ring-white/10">
                {FILTERS.filter(({ key }) => counts[key] > 0).map(({ key, label }) => {
                  const active = filter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(key)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
                        active
                          ? 'bg-surface text-slate-900 shadow-sm dark:bg-white/[0.12] dark:text-white dark:shadow-none'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                      }`}
                    >
                      {label}
                      <span className={`text-[11px] tabular-nums ${active ? 'text-slate-500 dark:text-white/60' : 'text-slate-400 dark:text-slate-500'}`}>
                        {counts[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
              <ul className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
                {visibleProjects.map((project) => (
                  <li key={project.url}>
                    <button
                      type="button"
                      onClick={() => setActiveProject(project)}
                      aria-label={`${showcaseAction(project)}: ${project.name}`}
                      className="group flex h-full w-full flex-col rounded-xl border border-slate-200 bg-surface p-3 text-left transition-colors hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-indigo-300"
                    >
                      <ShowcaseThumbnail project={project} />
                      <span className="flex flex-1 flex-col px-1 pt-3">
                        <span className="text-xs font-medium text-slate-500">
                          {project.category}{project.author ? ` · by ${project.author}` : ''}
                        </span>
                        <span className="mt-1 text-base font-semibold text-slate-900">{project.name}</span>
                        <span className="mt-1 text-sm leading-relaxed text-slate-600">{project.description}</span>
                        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-indigo-600 dark:text-indigo-300" aria-hidden="true">
                          {showcaseAction(project)}
                          <ArrowUpRight size={15} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setIsSubmitOpen(true)}
                    className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center transition-colors hover:border-indigo-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:border-white/15 dark:hover:border-indigo-300 dark:hover:bg-white/[0.03]"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                      <Plus size={20} aria-hidden="true" />
                    </span>
                    <span className="text-base font-semibold text-slate-900">Submit your project</span>
                    <span className="max-w-xs text-sm leading-relaxed text-slate-600">
                      Built something with AppBlips? Send us its link to be featured here.
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </>
        )}
      </Modal>
      {isSubmitOpen && <ShowcaseSubmitModal onClose={() => setIsSubmitOpen(false)} />}
    </>
  );
}
