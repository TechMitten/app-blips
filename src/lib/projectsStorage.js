// localStorage <-> cloud (Firestore) row plumbing for the projects list. Pure helpers --
// no React, no hooks -- so the auth hook (local -> cloud import) and the
// projects hook can share them without an import cycle. In the desktop app the
// same rows live on disk instead (lib/desktop.js).
import { isDesktop, readDesktopRows, writeDesktopRows } from './desktop.js';

export const readProjectRows = () => {
  if (isDesktop) return readDesktopRows();
  try {
    return JSON.parse(localStorage.getItem('orion-projects') || '[]');
  } catch {
    return [];
  }
};

export const writeProjectRows = (rows) => {
  if (isDesktop) {
    writeDesktopRows(rows);
    return;
  }
  localStorage.setItem('orion-projects', JSON.stringify(rows));
};

export const localRowsToProjects = (rows) => rows
  .slice()
  .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  .map(row => ({
    id: row.id,
    name: row.name,
    ...row.data,
    lastModified: row.updatedAt
  }));

// A summary row (listCloudProjects reads only meta docs) has no versions: it
// carries `versionCount` for the list and is `isSummary`, so opening it loads
// the full project (useProjects.loadProject).
export const cloudRowsToProjects = (rows) => (rows || []).map(row => (row.summary ? {
  id: row.id,
  name: row.name,
  isSummary: true,
  versionCount: row.summary.versionCount,
  deployment: row.summary.deployment || null,
  studioMode: row.summary.studioMode,
  lastModified: row.updated_at
} : {
  id: row.id,
  name: row.name,
  versions: row.data?.versions || [],
  currentVersionIndex: row.data?.currentVersionIndex ?? -1,
  chatContextStartIndex: Math.min(row.data?.chatContextStartIndex ?? 0, (row.data?.versions || []).length),
  currentChatSessionId: row.data?.currentChatSessionId ?? null,
  deployment: row.data?.deployment || null,
  // Enumerated explicitly (local rows spread ...row.data instead): a field
  // missing here silently vanishes for hosted users on load. Legacy rows
  // predate the studio split and default to 'app'.
  studioMode: row.data?.studioMode === 'website' ? 'website' : row.data?.studioMode === 'game' ? 'game' : 'app',
  lastModified: row.updated_at
}));

// Versions shown for a project in the Apps list (full or summary row).
export const projectVersionCount = (project) => project.versionCount ?? project.versions?.length ?? 0;

// Names identify projects in the Apps list, so two projects can't share one
// (compared trimmed and case-insensitively). `exceptId` skips the project being
// renamed so keeping its own name isn't a clash.
export const isProjectNameTaken = (projects, name, exceptId = null) => {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return false;
  return (projects || []).some((p) => p.id !== exceptId && String(p.name || '').trim().toLowerCase() === wanted);
};
