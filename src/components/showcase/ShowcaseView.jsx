import { useEffect, useState } from 'react';
import { ArrowLeft, Rocket } from 'lucide-react';
import { showcaseProjects, SHOWCASE_KINDS, KIND_LABELS } from '../../lib/showcase';
import ShowcaseCard from './ShowcaseCard';
import ShowcaseProjectModal from './ShowcaseProjectModal';

// Full-page showcase of hand-picked projects (lib/showcase.js). Static data,
// so there is no loading or error state; the kind filter appears only once
// the list mixes apps, websites and games.
export default function ShowcaseView({ activeProjectId, onOpenProject, onCloseProject, onClose, onRemix }) {
  const [kind, setKind] = useState('all');

  const kinds = SHOWCASE_KINDS.filter((k) => showcaseProjects.some((p) => p.kind === k));
  const visible = kind === 'all' ? showcaseProjects : showcaseProjects.filter((p) => p.kind === kind);
  const activeProject = activeProjectId ? showcaseProjects.find((p) => p.id === activeProjectId) || null : null;

  // Escape backs out of the showcase unless the project modal handles it first.
  useEffect(() => {
    if (activeProjectId) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeProjectId, onClose]);

  return (
    <div className="showcase-view fixed inset-0 z-[55] flex flex-col" role="region" aria-label="Showcase">
      <header className="showcase-topbar">
        <button type="button" onClick={onClose} className="showcase-back-btn" aria-label="Back to the studio">
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">Studio</span>
        </button>
        <div className="showcase-brand">
          <span className="showcase-brand-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>Showcase</span>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-10">
          <div className="showcase-hero">
            <h1>Made with AppBlips</h1>
            <p>A few things built entirely from plain-English prompts. Try them live, then remix one to make it your own.</p>
          </div>

          {kinds.length > 1 && (
            <nav className="showcase-tabs" aria-label="Filter by type">
              {['all', ...kinds].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`showcase-tab ${kind === k ? 'is-active' : ''}`}
                >
                  {k === 'all' ? 'All' : `${KIND_LABELS[k]}s`}
                </button>
              ))}
            </nav>
          )}

          {visible.length === 0 ? (
            <div className="showcase-empty animate-fade-in">
              <span className="showcase-empty-icon"><Rocket size={26} /></span>
              <h3 className="text-base font-semibold text-slate-900">Projects are on the way</h3>
              <p className="max-w-sm text-sm text-slate-500">Check back soon to see what can be built with AppBlips.</p>
            </div>
          ) : (
            <div className="showcase-grid">
              {visible.map((project, i) => (
                <ShowcaseCard key={project.id} project={project} index={i} onOpen={onOpenProject} />
              ))}
            </div>
          )}
        </div>
      </main>

      {activeProjectId && (
        <ShowcaseProjectModal
          key={activeProjectId}
          project={activeProject}
          onClose={onCloseProject}
          onRemix={onRemix}
        />
      )}
    </div>
  );
}
