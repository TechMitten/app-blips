// localStorage row plumbing for the projects list. Pure helpers -- no React --
// so the projects hook and the backup importer can share them. In the desktop
// app the same rows live on disk instead (lib/desktop.js).
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
