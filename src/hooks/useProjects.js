import { useState, useEffect, useCallback, useRef } from 'react';
import { db, firebaseEnabled } from '../firebase';
import { collection, query, where, orderBy, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { isValidUuid } from '../lib/helpers';
import {
  readProjectRows, writeProjectRows, localRowsToProjects, cloudRowsToProjects
} from '../lib/projectsStorage';
import { migratePreviewStorage, clearPreviewStorage } from '../lib/previewStorage';

// Project persistence: the saved-apps list (local rows when signed out or
// self-hosted, Firestore rows when signed in with Firebase enabled),
// load/save/rename/delete, the auto-save-name debounce, and the
// resume-last-project effect.
//
// `useCloud` (not `isSignedIn` alone) decides Firestore vs. localStorage: in
// a self-hosted build the mock auth provider always reports `isSignedIn`
// true, but there's no Firebase project behind `db` to talk to, so cloud
// storage additionally requires `firebaseEnabled`.
//
// The workspace state itself (versions, currentVersionIndex, projectName, …)
// stays in App because the generation flow owns it; this hook reads it via the
// `workspace` param and writes it back through the passed setters, which are
// all stable React state setters.
export default function useProjects({ authStatus, isSignedIn, user, workspace }) {
  const {
    versions, currentVersionIndex, projectName, currentProjectId, deployment,
    setProjectName, setVersions, setCurrentVersionIndex, setDeployment,
    setGeneratedCode, setCurrentProjectId, setHasSentFirstPrompt,
    setIsResumingProject, setIsSuggestionsExpanded, clearStreamingState
  } = workspace;

  const useCloud = isSignedIn && firebaseEnabled;

  const [myProjects, setMyProjects] = useState([]);
  const [isProjectsListOpen, setIsProjectsListOpen] = useState(false);
  const previousAuthStatusRef = useRef(null);

  const fetchCloudProjects = useCallback(async () => {
    if (!user?.id) return [];
    try {
      const q = query(
        collection(db, 'projects'),
        where('user_id', '==', user.id),
        orderBy('updated_at', 'desc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => d.data());
      return cloudRowsToProjects(data);
    } catch (err) {
      // If composite index is still building, fall back to where-only query and sort client-side
      if (err?.code === 'failed-precondition') {
        const fallbackQ = query(
          collection(db, 'projects'),
          where('user_id', '==', user.id)
        );
        const snapshot = await getDocs(fallbackQ);
        const data = snapshot.docs.map(d => d.data());
        const projects = cloudRowsToProjects(data);
        return projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      }
      throw err;
    }
  }, [user?.id]);

  const loadUserProjects = useCallback(async () => {
    try {
      let projects;
      if (useCloud) {
        projects = await fetchCloudProjects();
      } else {
        projects = localRowsToProjects(readProjectRows());
      }
      setMyProjects(projects);
      return projects;
    } catch (err) {
      console.error("Error loading projects:", err);
      // Fall back to the local list so a transient cloud failure doesn't blank the UI.
      const projects = localRowsToProjects(readProjectRows());
      setMyProjects(projects);
      return projects;
    }
  }, [useCloud, fetchCloudProjects]);

  const loadProjectById = useCallback(async (projectId) => {
    try {
      let row;
      if (useCloud) {
        const docRef = doc(db, 'projects', projectId);
        const docSnap = await getDoc(docRef);
        const data = docSnap.exists() ? docSnap.data() : null;
        if (!data) {
          localStorage.removeItem('orion-current-project-id');
          return;
        }
        row = { id: data.id, name: data.name, data: data.data };
      } else {
        row = readProjectRows().find(r => r.id === projectId);
        if (!row) {
          localStorage.removeItem('orion-current-project-id');
          return;
        }
      }

      clearStreamingState();
      setProjectName(row.name || 'Untitled App');
      const projectData = row.data || {};
      setVersions(projectData.versions || []);
      setCurrentVersionIndex(projectData.currentVersionIndex ?? -1);
      setDeployment(projectData.deployment || null);
      if (projectData.versions && projectData.versions[projectData.currentVersionIndex]) {
        setGeneratedCode(projectData.versions[projectData.currentVersionIndex].code);
      }
      setCurrentProjectId(projectId);
      setHasSentFirstPrompt(Boolean(projectData.versions?.length));
      localStorage.setItem('orion-current-project-id', projectId);
    } catch (err) {
      console.error("Error loading project by ID:", err);
    }
  }, [useCloud, clearStreamingState, setProjectName, setVersions, setCurrentVersionIndex, setDeployment, setGeneratedCode, setCurrentProjectId, setHasSentFirstPrompt]);

  const saveProject = useCallback(async (params = {}) => {
    const {
      versionsToSave = versions,
      indexToSave = currentVersionIndex,
      nameToSave = projectName,
      idToSave = currentProjectId,
      deploymentToSave = deployment
    } = params;

    if (!versionsToSave.length && !params.force) return;

    let projectId = idToSave || currentProjectId || (useCloud ? crypto.randomUUID() : Date.now().toString());

    try {
      const projectData = {
        versions: versionsToSave,
        currentVersionIndex: indexToSave,
        deployment: deploymentToSave || null,
      };

      if (useCloud) {
        // Local ids (Date.now() strings) can't live in a uuid column. If a guest
        // project is being edited after sign-in, re-key it once on upload.
        let cloudId = projectId;
        if (!isValidUuid(cloudId)) {
          cloudId = crypto.randomUUID();
          projectId = cloudId;
        }

        await setDoc(doc(db, 'projects', cloudId), {
          id: cloudId,
          user_id: user.id,
          name: nameToSave,
          data: projectData,
          updated_at: new Date().toISOString()
        });
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
        localStorage.setItem('orion-current-project-id', projectId);
      }
      loadUserProjects();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  }, [versions, currentVersionIndex, projectName, currentProjectId, deployment, useCloud, user?.id, loadUserProjects, setCurrentProjectId]);

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
        const projects = await loadUserProjects();

        if (previous === 'signedIn' && authStatus === 'signedOut') {
          // Just signed out: swap in the local list but keep whatever is open.
          return;
        }

        if (!currentProjectId) {
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
  }, [authStatus]);

  // Loading a project straight from the saved-apps list.
  const loadProject = (project) => {
    clearStreamingState();
    setIsSuggestionsExpanded(false);
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    setVersions(project.versions);
    setCurrentVersionIndex(project.currentVersionIndex);
    if (project.versions && project.versions[project.currentVersionIndex]) {
      setGeneratedCode(project.versions[project.currentVersionIndex].code);
    }
    setIsProjectsListOpen(false);
    setHasSentFirstPrompt(Boolean(project.versions?.length));
    localStorage.setItem('orion-current-project-id', project.id);
  };

  // Rename/delete return success booleans so the list modal can settle its own
  // inline editing / confirmation UI.
  const renameProject = async (project, trimmedName) => {
    try {
      if (useCloud) {
        await updateDoc(doc(db, 'projects', project.id), {
          name: trimmedName,
          updated_at: new Date().toISOString()
        });
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
        await deleteDoc(doc(db, 'projects', projectId));
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

  return {
    myProjects,
    isProjectsListOpen,
    setIsProjectsListOpen,
    loadUserProjects,
    loadProject,
    saveProject,
    renameProject,
    deleteProject,
  };
}
