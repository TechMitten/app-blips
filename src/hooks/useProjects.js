import { useState, useEffect, useCallback } from 'react';
import {
  readProjectRows, writeProjectRows, localRowsToProjects
} from '../lib/projectsStorage';
import { migratePreviewStorage, clearPreviewStorage } from '../lib/previewStorage';
import { migrateChatSessions } from '../lib/chatSessions';
import { clearStartFresh, isStartFresh } from '../lib/config';
import { LANDING_PAGE, versionFiles } from '../lib/pages';

// Project persistence: the saved-apps list, load/save/rename/delete, the
// auto-save-name debounce, and the resume-last-project effect. AppBlips is
// single-user: rows live in localStorage, or on disk in the desktop app
// (projectsStorage.js routes to lib/desktop.js there).
//
// The workspace state itself (versions, currentVersionIndex, projectName, …)
// stays in App because the generation flow owns it; this hook reads it via the
// `workspace` param and writes it back through the passed setters, which are
// all stable React state setters.
export default function useProjects({ workspace }) {
  const {
    versions, currentVersionIndex, chatContextStartIndex, currentChatSessionId, projectName, currentProjectId, studioMode,
    setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setStudioMode,
    setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt,
    setIsResumingProject, clearStreamingState
  } = workspace;

  // Adopting a project (load or save) cancels a pending start-fresh marker:
  // once a project is anchored, the next reload should come back to it.
  const rememberProjectId = (id) => {
    clearStartFresh();
    localStorage.setItem('orion-current-project-id', id);
  };

  const [myProjects, setMyProjects] = useState([]);
  const [isProjectsListOpen, setIsProjectsListOpen] = useState(false);

  const loadUserProjects = useCallback(async () => {
    const projects = localRowsToProjects(readProjectRows());
    setMyProjects(projects);
    return projects;
  }, []);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      const row = readProjectRows().find(r => r.id === projectId);
      if (!row) {
        localStorage.removeItem('orion-current-project-id');
        return;
      }

      const projectData = row.data || {};
      // Upgrade legacy rows (no per-version session ids) to the grouped
      // chat-session model using the old single cutoff.
      const migrated = migrateChatSessions(
        projectData.versions, projectData.chatContextStartIndex, projectData.currentChatSessionId
      );

      clearStreamingState();
      setProjectName(row.name || 'Untitled App');
      setVersions(migrated.versions);
      setCurrentVersionIndex(projectData.currentVersionIndex ?? -1);
      setChatContextStartIndex(Math.min(projectData.chatContextStartIndex ?? 0, migrated.versions.length));
      setCurrentChatSessionId(migrated.currentChatSessionId);
      setStudioMode(projectData.studioMode === 'website' ? 'website' : projectData.studioMode === 'game' ? 'game' : 'app');
      const currentVersion = migrated.versions[projectData.currentVersionIndex];
      if (currentVersion) {
        setFiles(versionFiles(currentVersion));
        setActivePage(LANDING_PAGE);
      }
      setCurrentProjectId(projectId);
      setHasSentFirstPrompt(Boolean(projectData.versions?.length));
      rememberProjectId(projectId);
    } catch (err) {
      console.error("Error loading project by ID:", err);
    }
  }, [clearStreamingState, setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setStudioMode, setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt]);

  const saveProject = useCallback(async (params = {}) => {
    const {
      versionsToSave = versions,
      indexToSave = currentVersionIndex,
      nameToSave = projectName,
      idToSave = currentProjectId,
      chatContextStartToSave = chatContextStartIndex,
      sessionIdToSave = currentChatSessionId,
      studioModeToSave = studioMode
    } = params;

    if (!versionsToSave.length && !params.force) return;

    const projectId = idToSave || currentProjectId || Date.now().toString();

    try {
      const projectData = {
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
        chatContextStartIndex: Math.min(chatContextStartToSave ?? 0, versionsToSave.length),
        currentChatSessionId: sessionIdToSave ?? null,
        studioMode: studioModeToSave === 'website' ? 'website' : studioModeToSave === 'game' ? 'game' : 'app',
      };

      const rows = readProjectRows();
      const existingIndex = rows.findIndex(r => r.id === projectId);
      const row = {
        id: projectId,
        name: nameToSave,
        data: projectData,
        updatedAt: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        rows[existingIndex] = row;
      } else {
        rows.push(row);
      }
      writeProjectRows(rows);

      if (!currentProjectId || currentProjectId !== projectId) {
        migratePreviewStorage(currentProjectId || 'draft', projectId);
        setCurrentProjectId(projectId);
        rememberProjectId(projectId);
      }
      loadUserProjects();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, studioMode, chatContextStartIndex, currentChatSessionId, loadUserProjects, setCurrentProjectId]);

  // --- Auto-save Name Changes ---
  useEffect(() => {
    if (!currentProjectId) return;

    const timeoutId = setTimeout(() => {
      // Only save if name actually changed from what we have in the list
      const currentProjData = myProjects.find(p => p.id === currentProjectId);
      if (currentProjData && currentProjData.name === projectName) return;

      saveProject({ nameToSave: projectName });
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [projectName, currentProjectId, myProjects, saveProject]);

  // --- Data Persistence (resume last project) ---
  // Runs once on mount and reloads the saved-apps list, then reopens the
  // project the user last had open. Respects any currently-open project by only
  // auto-resuming when nothing is open.
  useEffect(() => {
    const fetchAndResume = async () => {
      try {
        const projects = await loadUserProjects();

        // Start-fresh marker: the user confirmed leaving the previous project
        // (New App / Exit / workspace reset) and hasn't adopted another one
        // since, so land on the studio picker instead of resurrecting that
        // project. Stays set until a project is adopted or they go back, so
        // reloads keep showing the picker for the whole new-app flow.
        const startFresh = isStartFresh();

        if (!currentProjectId && !startFresh) {
          const lastProjectId = localStorage.getItem('orion-current-project-id');
          const idToLoad = (lastProjectId && projects.some((p) => p.id === lastProjectId))
            ? lastProjectId
            : null;
          if (idToLoad) {
            await loadProjectById(idToLoad);
          } else if (lastProjectId) {
            localStorage.removeItem('orion-current-project-id');
          }
        }
      } finally {
        setIsResumingProject(false);
      }
    };

    fetchAndResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loading a project straight from the saved-apps list.
  const loadProject = (project) => {
    clearStreamingState();
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    const migrated = migrateChatSessions(
      project.versions, project.chatContextStartIndex, project.currentChatSessionId
    );
    setVersions(migrated.versions);
    setCurrentVersionIndex(project.currentVersionIndex);
    setChatContextStartIndex(Math.min(project.chatContextStartIndex ?? 0, migrated.versions.length));
    setCurrentChatSessionId(migrated.currentChatSessionId);
    setStudioMode(project.studioMode === 'website' ? 'website' : project.studioMode === 'game' ? 'game' : 'app');
    if (migrated.versions && migrated.versions[project.currentVersionIndex]) {
      setFiles(versionFiles(migrated.versions[project.currentVersionIndex]));
      setActivePage(LANDING_PAGE);
    }
    setIsProjectsListOpen(false);
    setHasSentFirstPrompt(Boolean(project.versions?.length));
    rememberProjectId(project.id);
  };

  // Rename/delete return success booleans so the list modal can settle its own
  // inline editing / confirmation UI.
  const renameProject = async (project, trimmedName) => {
    try {
      const rows = readProjectRows();
      const idx = rows.findIndex(r => r.id === project.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], name: trimmedName, updatedAt: new Date().toISOString() };
        writeProjectRows(rows);
      }

      setMyProjects(prev => prev.map((p) => (
        p.id === project.id
          ? { ...p, name: trimmedName }
          : p
      )));

      if (currentProjectId === project.id) {
        setProjectName(trimmedName);
      }

      loadUserProjects();
      return true;
    } catch (err) {
      console.error('Error renaming project:', err);
      return false;
    }
  };

  const deleteProject = async (project) => {
    try {
      const projectId = project.id;
      writeProjectRows(readProjectRows().filter(r => r.id !== projectId));

      clearPreviewStorage(projectId);
      setMyProjects(prev => prev.filter((p) => p.id !== projectId));
      loadUserProjects();
      return true;
    } catch (err) {
      console.error('Error deleting project:', err);
      return false;
    }
  };

  // Wipes every saved app. Reads the store fresh rather than trusting the
  // possibly-stale list state. Continues past individual failures; returns true
  // only if all were removed.
  const deleteAllProjects = async () => {
    try {
      const projects = localRowsToProjects(readProjectRows());
      let allOk = true;
      for (const project of projects) {
        try {
          clearPreviewStorage(project.id);
        } catch (err) {
          allOk = false;
          console.error('Error deleting project:', project.id, err);
        }
      }
      writeProjectRows([]);
      await loadUserProjects();
      return allOk;
    } catch (err) {
      console.error('Error deleting all projects:', err);
      return false;
    }
  };

  return {
    myProjects,
    isProjectsListOpen,
    setIsProjectsListOpen,
    loadUserProjects,
    loadProject,
    saveProject,
    renameProject,
    deleteProject,
    deleteAllProjects,
  };
}
