import { useState, useEffect, useCallback, useRef } from 'react';
import { firebaseEnabled } from '../firebase';
import { listCloudProjects, loadCloudProject, saveCloudProject, renameCloudProject, deleteCloudProject } from '../lib/cloudProjects';
import { isValidUuid } from '../lib/helpers';
import { clearStartFresh, isStartFresh } from '../lib/config';
import {
  readProjectRows, writeProjectRows, localRowsToProjects, cloudRowsToProjects
} from '../lib/projectsStorage';
import { migratePreviewStorage, clearPreviewStorage, clearAllPreviewStorage } from '../lib/previewStorage';
import { removeDeployment } from '../lib/deploy';
import { clearPendingJob } from '../lib/pendingJob';
import { migrateChatSessions } from '../lib/chatSessions';
import { LANDING_PAGE, versionFiles } from '../lib/pages';
import { archiveVersions, deleteProjectHistory, ensureVersionFiles, isArchivedVersion } from '../lib/historyStore';

// Project persistence: the saved-apps list (localStorage rows when
// self-hosted, Firestore docs when signed in with hosted mode enabled),
// load/save/rename/delete, the auto-save-name debounce, and the
// resume-last-project effect.
//
// Hosted mode never uses localStorage for project data: signed in, everything
// lives in Firestore (and the last-open project is simply the most recently
// updated one); signed out, work is in memory only, and signing out wipes the
// workspace and any browser-side leftovers so the next visitor sees nothing.
//
// `useCloud` (not `isSignedIn` alone) decides Firestore vs. localStorage: in
// a self-hosted build the mock auth provider always reports `isSignedIn`
// true, but there's no Firebase project behind the client to talk to, so cloud
// storage additionally requires `firebaseEnabled`.
//
// The workspace state itself (versions, currentVersionIndex, projectName, …)
// stays in App because the generation flow owns it; this hook reads it via the
// `workspace` param and writes it back through the passed setters, which are
// all stable React state setters.
export default function useProjects({ authStatus, isSignedIn, user, workspace }) {
  const {
    versions, currentVersionIndex, chatContextStartIndex, currentChatSessionId, projectName, currentProjectId, deployment, studioMode,
    setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setDeployment, setStudioMode,
    setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt,
    setIsResumingProject, clearStreamingState, resetWorkspace
  } = workspace;

  const useCloud = isSignedIn && firebaseEnabled;

  // Last-open pointer: self-hosted only. Hosted resumes the newest cloud row.
  // Adopting a project (load or save) cancels a pending start-fresh marker in
  // both modes: once a project is anchored, the next reload should come back
  // to it like normal.
  const rememberProjectId = (id) => {
    clearStartFresh();
    if (!firebaseEnabled) localStorage.setItem('orion-current-project-id', id);
  };

  const [myProjects, setMyProjects] = useState([]);
  const [isProjectsListOpen, setIsProjectsListOpen] = useState(false);
  const previousAuthStatusRef = useRef(null);

  const fetchCloudProjects = useCallback(async () => {
    if (!user?.id) return [];
    return cloudRowsToProjects(await listCloudProjects(user.id));
  }, [user?.id]);

  const loadUserProjects = useCallback(async () => {
    try {
      let projects;
      if (useCloud) {
        projects = await fetchCloudProjects();
      } else {
        projects = firebaseEnabled ? [] : localRowsToProjects(readProjectRows());
      }
      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      // Self-hosted only: fall back to the local list. Hosted never reads
      // local rows, so a cloud failure shows an empty list rather than
      // another account's leftovers.
      const projects = firebaseEnabled ? [] : localRowsToProjects(readProjectRows());
      setMyProjects(projects);
      return projects;
    }
  }, [useCloud, fetchCloudProjects]);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      let row;
      if (useCloud) {
        row = await loadCloudProject(user.id, projectId);
        if (!row) return;
      } else {
        row = readProjectRows().find(r => r.id === projectId);
        if (!row) {
          localStorage.removeItem('orion-current-project-id');
          return;
        }
      }

      const projectData = row.data || {};
      // Upgrade legacy rows (no per-version session ids) to the grouped
      // chat-session model using the old single cutoff.
      const migrated = migrateChatSessions(
        projectData.versions, projectData.chatContextStartIndex, projectData.currentChatSessionId
      );
      // Fetched before any state changes, so a failure leaves the workspace as it was.
      const currentVersion = migrated.versions[projectData.currentVersionIndex];
      const currentFiles = currentVersion ? await ensureVersionFiles(projectId, currentVersion) : null;

      clearStreamingState();
      setProjectName(row.name || 'Untitled App');
      setVersions(migrated.versions);
      setCurrentVersionIndex(projectData.currentVersionIndex ?? -1);
      setChatContextStartIndex(Math.min(projectData.chatContextStartIndex ?? 0, migrated.versions.length));
      setCurrentChatSessionId(migrated.currentChatSessionId);
      setDeployment(projectData.deployment || null);
      setStudioMode(projectData.studioMode === 'website' ? 'website' : projectData.studioMode === 'game' ? 'game' : 'app');
      if (currentFiles) {
        setFiles(currentFiles);
        setActivePage(LANDING_PAGE);
      }
      setCurrentProjectId(projectId);
      setHasSentFirstPrompt(Boolean(projectData.versions?.length));
      rememberProjectId(projectId);
    } catch (err) {
      console.error("Error loading project by ID:", err);
    }
  }, [useCloud, user?.id, clearStreamingState, setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setDeployment, setStudioMode, setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt]);

  const saveProject = useCallback(async (params = {}) => {
    const {
      versionsToSave = versions,
      indexToSave = currentVersionIndex,
      nameToSave = projectName,
      idToSave = currentProjectId,
      deploymentToSave = deployment,
      chatContextStartToSave = chatContextStartIndex,
      sessionIdToSave = currentChatSessionId,
      studioModeToSave = studioMode
    } = params;

    if (!versionsToSave.length && !params.force) return;
    // Hosted + signed out: nothing is persisted, work stays in memory.
    if (firebaseEnabled && !useCloud) return;

    let projectId = idToSave || currentProjectId || (useCloud ? crypto.randomUUID() : Date.now().toString());

    try {
      const projectData = {
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
        deployment: deploymentToSave || null,
        chatContextStartIndex: Math.min(chatContextStartToSave ?? 0, versionsToSave.length),
        currentChatSessionId: sessionIdToSave ?? null,
        studioMode: studioModeToSave === 'website' ? 'website' : studioModeToSave === 'game' ? 'game' : 'app',
      };

      if (useCloud) {
        // Cloud ids are random UUIDs (firestore.rules requires the format), so
        // a local Date.now() id from a guest project is re-keyed once on upload.
        let cloudId = projectId;
        if (!isValidUuid(cloudId)) {
          cloudId = crypto.randomUUID();
          projectId = cloudId;
        }

        // Old versions' pages move to R2 so the Firestore project stays small;
        // the open version stays inline. Only the saved copy is slimmed: the
        // workspace keeps its full versions.
        projectData.versions = await archiveVersions(cloudId, versionsToSave, indexToSave);
        await saveCloudProject(user.id, cloudId, nameToSave, projectData);
      } else {
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
      }

      if (!currentProjectId || currentProjectId !== projectId) {
        migratePreviewStorage(currentProjectId || 'draft', projectId);
        setCurrentProjectId(projectId);
        rememberProjectId(projectId);
      }
      if (useCloud) {
        // Patch the list locally: re-listing after every save would re-read
        // every project from Firestore.
        const row = {
          id: projectId,
          name: nameToSave,
          isSummary: true,
          versionCount: versionsToSave.length,
          deployment: projectData.deployment,
          studioMode: projectData.studioMode,
          lastModified: new Date().toISOString(),
        };
        setMyProjects(prev => [row, ...prev.filter(p => p.id !== projectId)]);
      } else {
        loadUserProjects();
      }
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, deployment, studioMode, chatContextStartIndex, currentChatSessionId, useCloud, user?.id, loadUserProjects, setCurrentProjectId]);

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
  // Waits for auth to settle, then reloads the correct project store. Runs on
  // mount and again whenever the signed-in state actually flips (e.g. user signs
  // in/out), so the list always reflects the active store. Respects any
  // currently-open project by only auto-resuming when nothing is open.
  useEffect(() => {
    if (authStatus === 'loading') return;

    const previous = previousAuthStatusRef.current;
    previousAuthStatusRef.current = authStatus;

    const fetchAndResume = async () => {
      try {
        if (previous === 'signedIn' && authStatus === 'signedOut') {
          // Just signed out (hosted only): drop the account's workspace and
          // every browser-side trace of it.
          setMyProjects([]);
          resetWorkspace?.();
          localStorage.removeItem('orion-current-project-id');
          clearStartFresh();
          clearPendingJob();
          clearAllPreviewStorage();
          return;
        }

        const projects = await loadUserProjects();

        // Start-fresh marker: the user confirmed leaving the previous project
        // (New App / Exit / workspace reset) and hasn't adopted another one
        // since, so land on the studio picker instead of resurrecting that
        // project. Stays set until a project is adopted or they go back, so
        // reloads keep showing the picker for the whole new-app flow.
        const startFresh = isStartFresh();

        if (!currentProjectId && !startFresh) {
          if (firebaseEnabled) {
            // loadUserProjects returns rows newest-first.
            if (projects[0]) await loadProjectById(projects[0].id);
          } else {
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
        }
      } finally {
        setIsResumingProject(false);
      }
    };

    fetchAndResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Loading a project straight from the saved-apps list. Cloud rows there are
  // summaries (no versions), and an archived open version needs its pages
  // fetched, so both go through loadProjectById.
  const loadProject = (project) => {
    if (project.isSummary || isArchivedVersion(project.versions?.[project.currentVersionIndex])) {
      setIsProjectsListOpen(false);
      loadProjectById(project.id);
      return;
    }
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
    setDeployment(project.deployment || null);
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
      if (useCloud) {
        await renameCloudProject(project.id, trimmedName);
      } else {
        const rows = readProjectRows();
        const idx = rows.findIndex(r => r.id === project.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], name: trimmedName, updatedAt: new Date().toISOString() };
          writeProjectRows(rows);
        }
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
      if (useCloud) {
        // Deployment first: if it fails the project row survives, so the
        // user can retry instead of leaving a live app nothing points to.
        await removeDeployment(project.deployment);
        await deleteCloudProject(projectId);
        await deleteProjectHistory(projectId);
      } else {
        writeProjectRows(readProjectRows().filter(r => r.id !== projectId));
      }

      clearPreviewStorage(projectId);
      setMyProjects(prev => prev.filter((p) => p.id !== projectId));
      loadUserProjects();
      return true;
    } catch (err) {
      console.error('Error deleting project:', err);
      return false;
    }
  };

  // Wipes every saved app (and, in the cloud, each one's public deployment).
  // Reads the store fresh rather than trusting the possibly-stale list state.
  // Continues past individual failures; returns true only if all were removed.
  const deleteAllProjects = async () => {
    try {
      const projects = useCloud ? await fetchCloudProjects() : localRowsToProjects(readProjectRows());
      let allOk = true;
      for (const project of projects) {
        try {
          if (useCloud) {
            await removeDeployment(project.deployment);
            await deleteCloudProject(project.id);
            await deleteProjectHistory(project.id);
          }
          clearPreviewStorage(project.id);
        } catch (err) {
          allOk = false;
          console.error('Error deleting project:', project.id, err);
        }
      }
      if (!useCloud) writeProjectRows([]);
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
