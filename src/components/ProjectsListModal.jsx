import { useState } from 'react';
import {
  FolderOpen, Search, X, Plus, Clock, Edit2, Trash2, Layers, Check, ExternalLink
} from 'lucide-react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import { formatModifiedTime } from '../lib/helpers';

// Saved-apps browser: search, open, in-place rename, delete-with-confirm.
// Owns its editing/search/confirmation UI state; the actual persistence goes
// through onRenameProject / onDeleteProject (both resolve to a success bool).
export default function ProjectsListModal({
  projects,
  currentProjectId,
  onClose,
  onLoadProject,
  onRenameProject,
  onDeleteProject,
}) {
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deletingProjectId, setDeletingProjectId] = useState(null);

  const matchesQuery = (p) => !projectSearchQuery.trim() || (p.name || '').toLowerCase().includes(projectSearchQuery.toLowerCase().trim());
  const visibleProjects = projects.filter(matchesQuery);

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setRenamingProjectId(null);
  };

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

  return (
    <>
      <Modal
        zIndex={60}
        scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in"
        cardClass="w-full max-w-4xl bg-surface rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[88vh] animate-scale-in"
        cardProps={{ onClick: (e) => e.stopPropagation() }}
      >
        {/* Modal Header Bar */}
        <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/60 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 brand-gradient rounded-2xl flex items-center justify-center text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20 dark:shadow-none dark:ring-white/20">
              <FolderOpen size={20} className="drop-shadow-xs" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Your Saved Apps</h2>
                <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  {projects.length}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Pick up where you left off or manage your applications</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Bar */}
            {projects.length > 0 && (
              <div className="relative flex-1 sm:w-60">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={projectSearchQuery}
                  onChange={(e) => setProjectSearchQuery(e.target.value)}
                  placeholder="Search apps..."
                  className="w-full pl-9 pr-7 py-2 text-xs sm:text-sm rounded-xl bg-surface border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs transition-all"
                />
                {projectSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setProjectSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}

            {/* Close X button */}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-200/70 transition-colors shrink-0"
              title="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body / Apps List */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar bg-slate-50/40">
          {projects.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-16 h-16 rounded-3xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-500 shadow-premium-sm">
                <FolderOpen size={28} />
              </div>
              <h3 className="text-slate-900 font-bold text-base sm:text-lg">No saved apps yet</h3>
              <p className="text-slate-500 mt-1.5 text-xs sm:text-sm max-w-sm mx-auto leading-relaxed">
                Build your first application in the workspace and it will be saved automatically to this list.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  document.getElementById('prompt')?.focus();
                }}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl brand-gradient text-white font-semibold text-xs sm:text-sm shadow-premium-md hover:shadow-premium-lg transition-all"
              >
                <Plus size={15} strokeWidth={2.4} />
                <span>Create an App</span>
              </button>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <Search size={22} />
              </div>
              <h3 className="text-slate-800 font-bold text-base">No matching apps</h3>
              <p className="text-slate-500 mt-1 text-xs sm:text-sm">
                No applications match &ldquo;{projectSearchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setProjectSearchQuery('')}
                className="mt-4 px-4 py-1.5 rounded-lg bg-surface border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 shadow-2xs transition-colors"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleProjects.map((project) => {
                const isCurrent = currentProjectId === project.id;
                const initialLetter = (project.name || 'U').trim()[0]?.toUpperCase() || 'A';
                const versionCount = project.versions?.length || 1;

                return (
                  <div
                    key={project.id}
                    className={`rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden relative group bg-surface shadow-2xs hover:shadow-premium-md ${
                      isCurrent
                        ? 'border-indigo-300 ring-2 ring-indigo-500/20 bg-indigo-50/10'
                        : 'border-slate-200/90 hover:border-indigo-300'
                    }`}
                  >
                    {/* Card Header & Content */}
                    <div className="p-5 pb-4">
                      {editingProjectId === project.id ? (
                        /* In-place Rename */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                              Rename Application
                            </label>
                            <span className="text-[11px] text-slate-400">Press Enter to save</span>
                          </div>
                          <input
                            autoFocus
                            type="text"
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                submitProjectRename(project);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelProjectRename();
                              }
                            }}
                            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                            placeholder="App name"
                          />
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => submitProjectRename(project)}
                              disabled={!editingProjectName.trim() || renamingProjectId === project.id}
                              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                                !editingProjectName.trim() || renamingProjectId === project.id
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-2xs'
                              }`}
                            >
                              <Check size={13} />
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelProjectRename}
                              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                              <X size={13} />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Standard Card Info */
                        <div>
                          <div className="flex items-start justify-between gap-3 mb-2.5">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* App Icon Avatar */}
                              <div className="w-10 h-10 rounded-xl brand-gradient text-white font-bold text-sm flex items-center justify-center shadow-2xs shrink-0 ring-1 ring-black/5 dark:ring-white/10">
                                {initialLetter}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4
                                    onClick={() => onLoadProject(project)}
                                    className="font-bold text-slate-900 text-base leading-snug truncate cursor-pointer hover:text-indigo-600 transition-colors"
                                    title={project.name}
                                  >
                                    {project.name}
                                  </h4>
                                  {isCurrent && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full shrink-0">
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                                  <span className="flex items-center gap-1">
                                    <Clock size={11} className="text-slate-400" />
                                    {formatModifiedTime(project.lastModified)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Top Right Actions (Rename & Delete) */}
                            <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => startProjectRename(project)}
                                aria-label="Rename app"
                                title="Rename app"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setProjectToDelete(project)}
                                aria-label="Delete app"
                                title="Delete app"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Bottom / Footer Row */}
                    {editingProjectId !== project.id && (
                      <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-slate-200/80 text-xs font-semibold text-slate-600 shadow-2xs">
                            <Layers size={12} className="text-indigo-500" />
                            {versionCount} version{versionCount !== 1 ? 's' : ''}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onLoadProject(project)}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-semibold text-xs transition-all shadow-2xs ${
                            isCurrent
                              ? 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-indigo-500/20'
                              : 'bg-surface hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200'
                          }`}
                        >
                          <span>{isCurrent ? 'Open in Editor' : 'Open App'}</span>
                          <ExternalLink size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Bottom Bar */}
        <div className="bg-slate-50/90 border-t border-slate-200/80 px-6 sm:px-8 py-4 flex items-center justify-between text-xs text-slate-500">
          <div className="font-medium">
            {projects.length > 0 && (
              <span>
                Showing <span className="font-bold text-slate-700">
                  {visibleProjects.length}
                </span> of <span className="font-bold text-slate-700">{projects.length}</span> apps
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nav-btn bg-surface hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold px-4 py-1.5 rounded-xl border border-slate-200 shadow-2xs transition-colors"
          >
            Close
          </button>
        </div>
      </Modal>

      {projectToDelete && (
        <ConfirmModal
          title="Delete App"
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
            Delete <span className="font-bold text-slate-900">{projectToDelete.name || 'Untitled App'}</span> from your saved applications?
          </div>
          {currentProjectId === projectToDelete.id && (
            <p className="text-xs font-medium text-slate-500">
              This app is currently open. Deleting it will clear the current workspace.
            </p>
          )}
        </ConfirmModal>
      )}
    </>
  );
}
