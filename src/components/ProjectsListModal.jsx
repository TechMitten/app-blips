import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Search, X, Check, Pencil, Trash2, Smartphone, Globe, ChevronRight, Layers,
} from 'lucide-react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import { formatModifiedTime } from '../lib/helpers';

// One identifying icon per studio. Tints come from the indigo/sky ramps, which
// the dark theme remaps (dark fill, light glyph), so both themes stay legible.
const STUDIO_ICONS = {
  app: { Icon: Smartphone, label: 'App', tile: 'bg-indigo-100 text-indigo-700 ring-indigo-200/80 dark:ring-indigo-400/25' },
  website: { Icon: Globe, label: 'Website', tile: 'bg-sky-100 text-sky-700 ring-sky-200/80 dark:ring-sky-400/25' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'app', label: 'Apps' },
  { key: 'website', label: 'Websites' },
];

const studioOf = (project) => (project.studioMode === 'website' ? 'website' : 'app');

const toDate = (value) => {
  if (!value) return null;
  const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

// "Edited 5m ago" style; the exact timestamp stays available as a tooltip.
const formatRelative = (value) => {
  const d = toDate(value);
  if (!d) return 'Just now';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

const ICON_BTN = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:text-slate-500';

// Saved-projects browser: search, studio filter, open, in-place rename,
// delete-with-confirm. Owns its editing/search/confirmation UI state; the
// actual persistence goes through onRenameProject / onDeleteProject (both
// resolve to a success bool).
export default function ProjectsListModal({
  projects,
  currentProjectId,
  onClose,
  onLoadProject,
  onRenameProject,
  onDeleteProject,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deletingProjectId, setDeletingProjectId] = useState(null);
  const searchRef = useRef(null);

  const counts = {
    all: projects.length,
    app: projects.filter((p) => studioOf(p) === 'app').length,
    website: projects.filter((p) => studioOf(p) === 'website').length,
  };
  const trimmedQuery = query.trim().toLowerCase();
  const visibleProjects = projects.filter((p) =>
    (filter === 'all' || studioOf(p) === filter)
    && (!trimmedQuery || (p.name || '').toLowerCase().includes(trimmedQuery))
  );
  const isFiltered = Boolean(trimmedQuery) || filter !== 'all';

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setRenamingProjectId(null);
  };

  // Escape backs out one layer at a time: rename, then the modal. The delete
  // confirmation handles its own keys while open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || projectToDelete) return;
      if (editingProjectId) cancelProjectRename();
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editingProjectId, projectToDelete, onClose]);

  const startProjectRename = (project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name || 'Untitled App');
    setProjectToDelete(null);
  };

  const submitProjectRename = async (project) => {
    const trimmedName = editingProjectName.trim();
    if (!trimmedName) return;

    if (trimmedName === (project.name || 'Untitled App')) {
      cancelProjectRename();
      return;
    }

    setRenamingProjectId(project.id);
    const ok = await onRenameProject(project, trimmedName);
    if (ok) cancelProjectRename();
    else setRenamingProjectId(null);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    setDeletingProjectId(projectToDelete.id);
    const ok = await onDeleteProject(projectToDelete);
    setDeletingProjectId(null);
    if (ok) {
      if (editingProjectId === projectToDelete.id) {
        cancelProjectRename();
      }
      setProjectToDelete(null);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
    searchRef.current?.focus();
  };

  return (
    <>
      <Modal
        zIndex={60}
        scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in"
        cardClass="w-full max-w-2xl bg-surface rounded-2xl border border-slate-200 shadow-2xl dark:bg-[#17171c] dark:border-white/12 dark:shadow-[0_24px_64px_-16px_rgb(0_0_0/0.9)] overflow-hidden flex flex-col h-[min(640px,85vh)] animate-scale-in"
        cardProps={{
          onClick: (e) => e.stopPropagation(),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'projects-modal-title',
        }}
      >
        {/* Header: title + count, close */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 id="projects-modal-title" className="text-lg font-semibold tracking-tight text-slate-900">
              Your projects
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {projects.length === 0
                ? 'Nothing saved yet'
                : `${projects.length} saved · pick up where you left off`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${ICON_BTN} -mr-1.5 -mt-1 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:hover:text-white`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar: search + studio filter */}
        {projects.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 pb-4 sm:flex-row sm:items-center dark:border-white/10">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                ref={searchRef}
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 transition-colors hover:border-slate-300 focus:border-indigo-500 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-white/15 dark:bg-black/30 dark:placeholder:text-slate-500 dark:hover:border-white/25 dark:focus:bg-black/40 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div role="tablist" aria-label="Filter by studio" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-black/30 dark:ring-1 dark:ring-white/10">
              {FILTERS.map(({ key, label }) => {
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
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {projects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200/80 dark:ring-indigo-400/25">
                <FolderOpen size={22} aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">No projects yet</h3>
              <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
                Anything you build is saved here automatically, so you can come back to it any time.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="brand-fill-text mt-5 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                Start building
              </button>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-white/[0.06]">
                <Search size={20} aria-hidden="true" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">No matching projects</h3>
              <p className="mt-1 text-sm text-slate-500">
                {trimmedQuery
                  ? <>Nothing matches &ldquo;{query.trim()}&rdquo;{filter !== 'all' && ` in ${FILTERS.find((f) => f.key === filter).label}`}.</>
                  : `No ${FILTERS.find((f) => f.key === filter).label.toLowerCase()} saved yet.`}
              </p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 text-sm font-semibold text-indigo-600 hover:underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-1 p-3" aria-label="Saved projects">
              {visibleProjects.map((project) => {
                const isCurrent = currentProjectId === project.id;
                const studio = STUDIO_ICONS[studioOf(project)];
                const versionCount = project.versions?.length || 1;
                const isEditing = editingProjectId === project.id;
                const isRenaming = renamingProjectId === project.id;
                const name = project.name || 'Untitled App';

                return (
                  <li
                    key={project.id}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      isEditing
                        ? 'bg-slate-100 ring-1 ring-slate-200 dark:bg-white/[0.06] dark:ring-white/12'
                        : 'hover:bg-slate-100 focus-within:bg-slate-100 dark:hover:bg-white/[0.06] dark:focus-within:bg-white/[0.06]'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${studio.tile}`}
                      title={`${studio.label} project`}
                    >
                      <studio.Icon size={18} aria-hidden="true" />
                    </div>

                    {isEditing ? (
                      /* In-place rename */
                      <form
                        className="flex min-w-0 flex-1 items-center gap-2"
                        onSubmit={(e) => { e.preventDefault(); submitProjectRename(project); }}
                      >
                        <input
                          autoFocus
                          type="text"
                          value={editingProjectName}
                          onChange={(e) => setEditingProjectName(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          aria-label="Project name"
                          disabled={isRenaming}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-indigo-500 bg-surface px-3 text-sm font-medium text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:bg-black/40"
                        />
                        <button
                          type="submit"
                          disabled={!editingProjectName.trim() || isRenaming}
                          aria-label="Save name"
                          title="Save (Enter)"
                          className="brand-fill-text inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelProjectRename}
                          aria-label="Cancel rename"
                          title="Cancel (Esc)"
                          className={`${ICON_BTN} h-9 w-9 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white`}
                        >
                          <X size={16} />
                        </button>
                      </form>
                    ) : (
                      <>
                        {/* The whole row opens the project; the stretched
                            ::after makes the row the hit target while the
                            action buttons sit above it. */}
                        <button
                          type="button"
                          onClick={() => onLoadProject(project)}
                          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-400/60"
                        >
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900" title={name}>
                              {name}
                            </span>
                            {isCurrent && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                                Open
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                            <span>{studio.label}</span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Layers size={11} aria-hidden="true" />
                              {versionCount} version{versionCount !== 1 ? 's' : ''}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span title={formatModifiedTime(project.lastModified)}>
                              Edited {formatRelative(project.lastModified)}
                            </span>
                          </span>
                        </button>

                        <div className="relative z-10 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => startProjectRename(project)}
                            aria-label={`Rename ${name}`}
                            title="Rename"
                            className={`${ICON_BTN} hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white`}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setProjectToDelete(project)}
                            aria-label={`Delete ${name}`}
                            title="Delete"
                            className={`${ICON_BTN} hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <ChevronRight size={16} className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer: result count + keyboard hint */}
        {projects.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500 dark:border-white/10 dark:bg-black/20">
            <span>
              {isFiltered
                ? <>Showing <span className="font-semibold text-slate-700">{visibleProjects.length}</span> of {projects.length}</>
                : <><span className="font-semibold text-slate-700">{projects.length}</span> project{projects.length !== 1 ? 's' : ''}</>}
            </span>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <kbd className="rounded border border-slate-200 bg-surface px-1.5 py-px font-mono text-[10px] text-slate-500 dark:border-white/15 dark:bg-white/[0.06]">Esc</kbd>
              to close
            </span>
          </div>
        )}
      </Modal>

      {projectToDelete && (
        <ConfirmModal
          title="Delete project"
          subtitle="This cannot be undone."
          onClose={() => setProjectToDelete(null)}
          onConfirm={confirmDeleteProject}
          confirmLabel="Delete"
          busyLabel="Deleting..."
          busy={deletingProjectId === projectToDelete.id}
          icon={Trash2}
          confirmClass={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold transition-all ${
            deletingProjectId === projectToDelete.id
              ? 'bg-red-200 text-white cursor-not-allowed'
              : 'bg-danger text-white hover:bg-danger-hover'
          }`}
        >
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed">
            Delete <span className="font-bold text-slate-900">{projectToDelete.name || 'Untitled App'}</span> and all of its versions?
          </div>
          {currentProjectId === projectToDelete.id && (
            <p className="text-xs font-medium text-slate-500">
              This project is currently open. Deleting it will clear the current workspace.
            </p>
          )}
        </ConfirmModal>
      )}
    </>
  );
}
