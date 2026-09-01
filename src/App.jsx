import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge } from './previewBridge';

import Header from './components/Header';
import HistorySidebar from './components/HistorySidebar';
import BuildPanel from './components/BuildPanel';
import PreviewPane from './components/PreviewPane';
import SettingsModal from './components/SettingsModal';
import ProjectsListModal from './components/ProjectsListModal';
import DeployModal from './components/DeployModal';
import NamingModal from './components/NamingModal';
import AuthModal from './components/AuthModal';
import ImportModal from './components/ImportModal';
import ConfirmModal from './components/ConfirmModal';
import AccountSettingsModal from './components/AccountSettingsModal';
import { Code2, TriangleAlert } from 'lucide-react';

import { generateAppCode, generateNewStarterIdeas } from './lib/llm';
import { sanitizeHtmlResponse } from './lib/edits';
import {
  PRESET_COLORS, AVAILABLE_ICONS, STARTER_PRESETS, MARQUEE_MAX_BUFFER_LENGTH, HTML_STREAM_START_RE
} from './lib/constants';
import { buildMarqueeLoop } from './lib/helpers';

import useTheme from './hooks/useTheme';
import useAuth from './hooks/useAuth';
import useProjects from './hooks/useProjects';
import useDeployment from './hooks/useDeployment';
import usePreviewViewport from './hooks/usePreviewViewport';
import useBuildPaneResize from './hooks/useBuildPaneResize';
import usePreviewBridge from './hooks/usePreviewBridge';
import useSuggestions from './hooks/useSuggestions';

// App owns the workspace/generation state (prompt, versions, streaming) and
// composes everything else from hooks (src/hooks) and components
// (src/components). See CLAUDE.md for the module map.
export default function App() {
  // --- Layout / chrome state ---
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('orion-history-open');
    return stored !== null ? stored === 'true' : true;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedVersionIndex, setExpandedVersionIndex] = useState(null);

  // --- Theme ---
  const { themePreference, setThemePreference, resolvedTheme } = useTheme();
  const handleToggleTheme = () => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark');

  // --- Auth (Supabase) ---
  const {
    authStatus, isSignedIn, user,
    isAuthModalOpen, setIsAuthModalOpen,
    isImportModalOpen, importLocalCount, isImporting,
    handleImportProjects: runProjectImport,
    handleSkipImport, handleSignOut,
  } = useAuth();

  // --- Workspace state (the generation flow owns these) ---
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [chatMode, setChatMode] = useState('build'); // 'build' or 'ask'
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [hasSentFirstPrompt, setHasSentFirstPrompt] = useState(false);
  // True from first paint whenever a previously-open project might still be
  // resumed, so the empty-state (starter ideas) never flashes before that
  // project's data lands. Cleared once the resume attempt (successful or not)
  // finishes.
  const [isResumingProject, setIsResumingProject] = useState(
    () => Boolean(localStorage.getItem('orion-current-project-id'))
  );
  const [projectName, setProjectName] = useState('Untitled App');
  const [currentProjectId, setCurrentProjectId] = useState(null);
  // { url, path, deployedAt, versionId } -- persisted inside the project's data blob.
  const [deployment, setDeployment] = useState(null);
  const [starterIdeas, setStarterIdeas] = useState(STARTER_PRESETS.slice(0, 4));
  const [isGeneratingStarters, setIsGeneratingStarters] = useState(false);

  // --- Streaming state ---
  const [streamingCode, setStreamingCode] = useState('');
  const [streamingGeneratedCode, setStreamingGeneratedCode] = useState('');
  const [streamingReply, setStreamingReply] = useState('');

  // --- Naming / new-app flow ---
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [shouldGenerateAfterNaming, setShouldGenerateAfterNaming] = useState(false);
  const [isNewChatConfirmOpen, setIsNewChatConfirmOpen] = useState(false);

  const chatBottomRef = useRef(null);
  const previewContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const streamingReplyRef = useRef('');
  const replyFrozenRef = useRef(false);
  const abortControllerRef = useRef(null);

  const clearStreamingState = useCallback(() => {
    setStreamingCode('');
    setStreamingGeneratedCode('');
    setStreamingReply('');
    streamingBufferRef.current = '';
    streamingGeneratedCodeRef.current = '';
    streamingReplyRef.current = '';
    replyFrozenRef.current = false;
  }, []);

  // --- Contextual suggestions ---
  const {
    contextualSuggestions, isSuggestionsLoading, isSuggestionsExpanded,
    setIsSuggestionsExpanded, handleRefreshSuggestions,
  } = useSuggestions({ generatedCode, versions, projectName, isGenerating });

  // --- Projects (list / persistence) ---
  const {
    myProjects, isProjectsListOpen, setIsProjectsListOpen,
    loadUserProjects, loadProject, saveProject, renameProject, deleteProject,
  } = useProjects({
    authStatus,
    isSignedIn,
    user,
    workspace: {
      versions, currentVersionIndex, projectName, currentProjectId, deployment,
      setProjectName, setVersions, setCurrentVersionIndex, setDeployment,
      setGeneratedCode, setCurrentProjectId, setHasSentFirstPrompt,
      setIsResumingProject, setIsSuggestionsExpanded, clearStreamingState,
    },
  });

  // --- Deployment ---
  const currentVersionId = versions[currentVersionIndex]?.id ?? null;
  const {
    isDeployModalOpen, setIsDeployModalOpen, isDeploying, deployError, setDeployError,
    deployCopied, confirmUndeploy, setConfirmUndeploy, isDeployStale, deploymentUrl,
    openDeployModal, closeDeployModal, handleDeploy, handleUndeploy, handleCopyDeployUrl,
  } = useDeployment({
    generatedCode, isSignedIn, user, projectName, currentProjectId,
    currentVersionId, deployment, setDeployment, saveProject,
  });

  // --- Preview viewport (mode / orientation / zoom) ---
  const {
    previewMode, setPreviewMode, previewOrientation, handleToggleOrientation,
    orientationFlipClass, setOrientationFlipClass, zoomLevel, isAutoZoom,
    handleManualZoom, resetZoom,
  } = usePreviewViewport({ activeTab, isHistoryOpen, containerRef: previewContainerRef });

  // --- Build pane resize ---
  const { buildPaneWidth, isResizingBuildPane, handleBuildPaneResizeStart } = useBuildPaneResize();

  // The preview bridge is spliced in at RENDER time only, so `generatedCode`
  // itself stays pristine: downloads, the code pane, the clipboard,
  // `orion-projects` and -- critically -- applySurgicalEdits never see it.
  const { srcDoc: previewSrcDoc, token: previewToken } = useMemo(
    () => (generatedCode ? injectPreviewBridge(generatedCode) : { srcDoc: '', token: '' }),
    [generatedCode]
  );
  usePreviewBridge({ iframeRef, previewSrcDoc, previewToken, previewMode });

  const codePanelCode = isGenerating ? (streamingGeneratedCode || generatedCode) : generatedCode;
  const marqueeSegment = buildMarqueeLoop(streamingCode);
  const isChatActive = hasSentFirstPrompt || versions.length > 0 || Boolean(generatedCode) || Boolean(pendingPrompt) || isResumingProject;
  const showStarterIdeas = !isChatActive;

  useEffect(() => {
    if (pendingPrompt || versions.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pendingPrompt, versions.length, streamingReply]);

  useEffect(() => {
    localStorage.setItem('orion-history-open', isHistoryOpen);
  }, [isHistoryOpen]);

  const handleGenerateStarters = async () => {
    if (isGeneratingStarters) return;
    setIsGeneratingStarters(true);
    setError(null);
    try {
      const ideas = await generateNewStarterIdeas({ signal: null });
      if (ideas && ideas.length > 0) {
        const mappedIdeas = ideas.map(idea => {
          const IconComponent = AVAILABLE_ICONS[idea.iconName] || AVAILABLE_ICONS.Sparkles || Code2;
          const randomColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
          return {
            ...idea,
            icon: IconComponent,
            color: randomColor
          };
        });
        setStarterIdeas(mappedIdeas);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err.message || 'Failed to generate starter ideas.');
      }
    } finally {
      setIsGeneratingStarters(false);
    }
  };

  const handleGenerate = async (e) => {
    e?.preventDefault();
    if (!prompt.trim()) return;

    // Require naming for transition from Untitled or New App
    if ((projectName === 'Untitled App' || !projectName.trim()) && !currentProjectId) {
      setTempProjectName('');
      setShouldGenerateAfterNaming(true);
      setIsNamingModalOpen(true);
      return;
    }

    setHasSentFirstPrompt(true);
    setIsGenerating(true);
    setIsSuggestionsExpanded(false);
    clearStreamingState();
    setError(null);
    abortControllerRef.current = new AbortController();

    const currentPrompt = prompt;
    setPrompt(''); // Clear input so user can easily type their next refinement
    setPendingPrompt(currentPrompt);

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, (chunk, kind = 'content') => {
        if (kind === 'reasoning') {
          return;
        }
        if (kind === 'status') {
          streamingBufferRef.current = '';
          setStreamingCode(chunk);
          return;
        }
        streamingBufferRef.current = `${streamingBufferRef.current}${chunk.replace(/\s+/g, ' ')}`.slice(-MARQUEE_MAX_BUFFER_LENGTH);
        setStreamingCode(streamingBufferRef.current.trim());
        streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
        if (HTML_STREAM_START_RE.test(streamingGeneratedCodeRef.current)) {
          setStreamingGeneratedCode(sanitizeHtmlResponse(streamingGeneratedCodeRef.current));
        }
        if (!replyFrozenRef.current) {
          const boundaryMatch = streamingGeneratedCodeRef.current.match(HTML_STREAM_START_RE);
          if (boundaryMatch) {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.slice(0, boundaryMatch.index).trim();
            replyFrozenRef.current = true;
          } else {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.trim();
          }
          setStreamingReply(streamingReplyRef.current);
        }
      }, 'both', abortControllerRef.current.signal, chatMode === 'ask');
      setGeneratedCode(generationResult.code);

      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        code: generationResult.code,
        timestamp: new Date().toLocaleTimeString(),
        editMode: generationResult.editMode,
        editSummary: generationResult.editSummary,
        reply: generationResult.reply || null
      };

      // If user goes back in time and generates, truncate the future versions (standard undo behavior)
      const updatedVersions = versions.slice(0, currentVersionIndex + 1);
      const finalVersions = [...updatedVersions, newVersion];
      setVersions(finalVersions);
      setCurrentVersionIndex(updatedVersions.length);

      // Auto-save
      saveProject({
        versionsToSave: finalVersions,
        indexToSave: updatedVersions.length
      });

    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
      setPrompt(currentPrompt); // Restore prompt text on error
    } finally {
      setIsGenerating(false);
      setPendingPrompt('');
      clearStreamingState();
    }
  };

  handleGenerateRef.current = handleGenerate;

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleDownload = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miniapp-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleNewApp = () => {
    if (generatedCode || versions.length > 0 || isGenerating || hasSentFirstPrompt) {
      setIsNewChatConfirmOpen(true);
    } else {
      resetCurrentWorkspace();
    }
  };

  const handleConfirmNewChat = () => {
    resetCurrentWorkspace();
    setIsNewChatConfirmOpen(false);
  };

  const handleCancelNaming = () => {
    setShouldGenerateAfterNaming(false);
    setTempProjectName('');
    setIsNamingModalOpen(false);
  };

  const handleConfirmNaming = (e) => {
    e?.preventDefault();
    const trimmedName = tempProjectName.trim();
    if (!trimmedName) return;

    // If we are confirming a name for a new project triggered by a prompt,
    // or if we explicitly clicked "New App", clear the workspace.
    if (!shouldGenerateAfterNaming || (!currentProjectId && projectName === 'Untitled App')) {
      setGeneratedCode('');
      setPrompt(shouldGenerateAfterNaming ? prompt : ''); // Keep prompt if we're about to generate
      setError(null);
      setVersions([]);
      setCurrentVersionIndex(-1);
      setDeployment(null);
    }

    setProjectName(trimmedName);
    setTempProjectName('');
    setCurrentProjectId(null);
    localStorage.removeItem('orion-current-project-id');
    setIsNamingModalOpen(false);
  };

  useEffect(() => {
    if (!shouldGenerateAfterNaming || isNamingModalOpen) return;

    if ((projectName === 'Untitled App' || !projectName.trim()) || !prompt.trim()) {
      setShouldGenerateAfterNaming(false);
      return;
    }

    setShouldGenerateAfterNaming(false);
    handleGenerateRef.current?.();
  }, [shouldGenerateAfterNaming, isNamingModalOpen, projectName, prompt]);

  const switchVersion = (index) => {
    if (index >= 0 && index < versions.length) {
      clearStreamingState();
      setCurrentVersionIndex(index);
      setGeneratedCode(versions[index].code);
      if (currentProjectId) {
        saveProject({ indexToSave: index });
      }
    }
  };

  const handleUndo = () => {
    if (currentVersionIndex > 0) {
      switchVersion(currentVersionIndex - 1);
    }
  };

  const handleRedo = () => {
    if (currentVersionIndex < versions.length - 1) {
      switchVersion(currentVersionIndex + 1);
    }
  };

  const handleCopyCode = async () => {
    if (!codePanelCode) return;
    try {
      await navigator.clipboard.writeText(codePanelCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const copyVersionCode = async (ver) => {
    if (!ver || !ver.code) return;
    try {
      await navigator.clipboard.writeText(ver.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy version code:', err);
    }
  };

  const downloadVersion = (ver) => {
    if (!ver || !ver.code) return;
    const blob = new Blob([ver.code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miniapp-v${ver.id || Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleExpandVersion = (idx) => {
    setExpandedVersionIndex(prev => prev === idx ? null : idx);
  };

  const resetCurrentWorkspace = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    clearStreamingState();
    setGeneratedCode('');
    setPrompt('');
    setPendingPrompt('');
    setHasSentFirstPrompt(false);
    setChatMode('build');
    setError(null);
    setVersions([]);
    setCurrentVersionIndex(-1);
    setCurrentProjectId(null);
    setDeployment(null);
    setDeployError(null);
    setConfirmUndeploy(false);
    setIsDeployModalOpen(false);
    setTempProjectName('');
    setShouldGenerateAfterNaming(false);
    setIsNamingModalOpen(false);
    setProjectName('Untitled App');
    localStorage.removeItem('orion-current-project-id');
  };

  // Deleting the currently-open project also clears the workspace.
  const handleDeleteProject = async (project) => {
    const wasCurrent = currentProjectId === project.id;
    const ok = await deleteProject(project);
    if (ok && wasCurrent) {
      resetCurrentWorkspace();
    }
    return ok;
  };

  const handleImportProjects = () => runProjectImport(loadUserProjects);

  const handleRequireSignInFromDeploy = () => {
    setIsDeployModalOpen(false);
    setIsAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen h-dvh overflow-hidden bg-slate-50 flex flex-col font-sans">
      <Header
        projectName={projectName}
        onNewApp={handleNewApp}
        savedAppsCount={myProjects.length}
        versionsCount={versions.length}
        onOpenApps={() => setIsProjectsListOpen(true)}
        isHistoryOpen={isHistoryOpen}
        onToggleHistory={() => setIsHistoryOpen(!isHistoryOpen)}
        resolvedTheme={resolvedTheme}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        authStatus={authStatus}
        isSignedIn={isSignedIn}
        userEmail={user?.email}
        onOpenAccountSettings={() => setIsAccountSettingsOpen(true)}
        onSignIn={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* Streaming Marquee - Only visible when generating */}
      {isGenerating && (
        <div className="marquee-container" id="marquee-container" aria-live="polite">
          <div className="marquee-track">
            <span className="marquee-segment">{marqueeSegment}</span>
            <span className="marquee-segment" aria-hidden="true">{marqueeSegment}</span>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
          resolvedTheme={resolvedTheme}
        />
      )}

      {isProjectsListOpen && (
        <ProjectsListModal
          projects={myProjects}
          currentProjectId={currentProjectId}
          onClose={() => setIsProjectsListOpen(false)}
          onLoadProject={loadProject}
          onRenameProject={renameProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      {isNewChatConfirmOpen && (
        <ConfirmModal
          title="Start a new app?"
          subtitle="This will clear your current workspace."
          onClose={() => setIsNewChatConfirmOpen(false)}
          onConfirm={handleConfirmNewChat}
          confirmLabel="Start New"
          confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
        >
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              You have unsaved changes. Starting a new app will discard your current work including any generated code and version history.
            </span>
          </div>
        </ConfirmModal>
      )}

      {isDeployModalOpen && (
        <DeployModal
          isSignedIn={isSignedIn}
          deployment={deployment}
          deploymentUrl={deploymentUrl}
          isDeployStale={isDeployStale}
          isDeploying={isDeploying}
          deployError={deployError}
          deployCopied={deployCopied}
          confirmUndeploy={confirmUndeploy}
          setConfirmUndeploy={setConfirmUndeploy}
          hasCode={Boolean(generatedCode)}
          onClose={closeDeployModal}
          onDeploy={handleDeploy}
          onUndeploy={handleUndeploy}
          onCopyUrl={handleCopyDeployUrl}
          onRequireSignIn={handleRequireSignInFromDeploy}
        />
      )}

      {isNamingModalOpen && (
        <NamingModal
          name={tempProjectName}
          onNameChange={setTempProjectName}
          onConfirm={handleConfirmNaming}
          onCancel={handleCancelNaming}
        />
      )}

      {isAccountSettingsOpen && isSignedIn && (
        <AccountSettingsModal
          user={user}
          onClose={() => setIsAccountSettingsOpen(false)}
          onSignOut={handleSignOut}
        />
      )}

      {isAuthModalOpen && (
        <AuthModal onClose={() => setIsAuthModalOpen(false)} />
      )}

      {isImportModalOpen && (
        <ImportModal
          localCount={importLocalCount}
          importing={isImporting}
          onImport={handleImportProjects}
          onSkip={handleSkipImport}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <HistorySidebar
          isOpen={isHistoryOpen}
          versions={versions}
          currentVersionIndex={currentVersionIndex}
          expandedVersionIndex={expandedVersionIndex}
          onToggleExpand={toggleExpandVersion}
          onSwitchVersion={switchVersion}
          onCopyVersion={copyVersionCode}
          onDownloadVersion={downloadVersion}
          onCollapse={() => setIsHistoryOpen(false)}
          onExpand={() => setIsHistoryOpen(true)}
        />

        {/* Main Workspace */}
        <main className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

          {/* Prompt/Chat Sidebar (Left) - Build Panel */}
          <BuildPanel
            width={buildPaneWidth}
            isChatActive={isChatActive}
            isResumingProject={isResumingProject}
            chatMode={chatMode}
            onChatModeChange={setChatMode}
            generatedCode={generatedCode}
            showStarterIdeas={showStarterIdeas}
            starterIdeas={starterIdeas}
            isGeneratingStarters={isGeneratingStarters}
            onGenerateStarters={handleGenerateStarters}
            onPickStarter={setPrompt}
            versions={versions}
            currentVersionIndex={currentVersionIndex}
            pendingPrompt={pendingPrompt}
            streamingReply={streamingReply}
            isGenerating={isGenerating}
            error={error}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={handleGenerate}
            onCancelGeneration={handleCancelGeneration}
            chatBottomRef={chatBottomRef}
            contextualSuggestions={contextualSuggestions}
            isSuggestionsLoading={isSuggestionsLoading}
            isSuggestionsExpanded={isSuggestionsExpanded}
            setIsSuggestionsExpanded={setIsSuggestionsExpanded}
            onRefreshSuggestions={handleRefreshSuggestions}
            onPickSuggestion={setPrompt}
          />

          {/* Drag handle to resize the build panel */}
          <div
            onMouseDown={handleBuildPaneResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize build panel"
            title="Drag to resize"
            className={`hidden md:flex items-stretch w-1.5 shrink-0 cursor-col-resize z-20 group transition-colors ${
              isResizingBuildPane ? 'bg-indigo-400/25' : 'hover:bg-indigo-400/15'
            }`}
          >
            <div className={`w-px h-full mx-auto panel-edge-right transition-colors ${
              isResizingBuildPane ? 'bg-indigo-500' : 'bg-slate-300/80 group-hover:bg-indigo-400'
            }`} />
          </div>

          {/* Preview/Device Area (Right) */}
          <PreviewPane
            activeTab={activeTab}
            onTabChange={setActiveTab}
            versions={versions}
            currentVersionIndex={currentVersionIndex}
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
            previewOrientation={previewOrientation}
            onToggleOrientation={handleToggleOrientation}
            orientationFlipClass={orientationFlipClass}
            onOrientationFlipEnd={setOrientationFlipClass}
            zoomLevel={zoomLevel}
            isAutoZoom={isAutoZoom}
            onZoomIn={handleManualZoom}
            onZoomOut={handleManualZoom}
            onResetZoom={resetZoom}
            onUndo={handleUndo}
            onRedo={handleRedo}
            hasCode={Boolean(generatedCode)}
            onOpenNewTab={handleOpenInNewTab}
            onDownload={handleDownload}
            deployment={deployment}
            isDeployStale={isDeployStale}
            isSignedIn={isSignedIn}
            onOpenDeployModal={openDeployModal}
            containerRef={previewContainerRef}
            iframeRef={iframeRef}
            previewSrcDoc={previewSrcDoc}
            isGenerating={isGenerating}
            code={codePanelCode}
            copied={copied}
            onCopyCode={handleCopyCode}
          />
        </main>
      </div>
    </div>
  );
}
