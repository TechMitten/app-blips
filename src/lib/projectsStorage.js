// localStorage <-> Supabase row plumbing for the projects list. Pure helpers --
// no React, no hooks -- so the auth hook (local -> cloud import) and the
// projects hook can share them without an import cycle.

export const readProjectRows = () => {
  try {
    return JSON.parse(localStorage.getItem('orion-projects') || '[]');
  } catch {
    return [];
  }
};

export const writeProjectRows = (rows) => {
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

export const cloudRowsToProjects = (rows) => (rows || []).map(row => ({
  id: row.id,
  name: row.name,
  versions: row.data?.versions || [],
  currentVersionIndex: row.data?.currentVersionIndex ?? -1,
  chatContextStartIndex: Math.min(row.data?.chatContextStartIndex ?? 0, (row.data?.versions || []).length),
  currentChatSessionId: row.data?.currentChatSessionId ?? null,
  deployment: row.data?.deployment || null,
  aiEnabled: Boolean(row.data?.aiEnabled),
  lastModified: row.updated_at
}));
