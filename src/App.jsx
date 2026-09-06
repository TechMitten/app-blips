import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge } from './previewBridge';
import { firebaseEnabled } from './firebase';

import Header from './components/Header';
import HistorySidebar from './components/HistorySidebar';
import BuildPanel from './components/BuildPanel';
import PreviewPane from './components/PreviewPane';
import SettingsModal from './components/SettingsModal';
import HelpModal from './components/HelpModal';
import ProjectsListModal from './components/ProjectsListModal';
import DeployModal from './components/DeployModal';
import NamingModal from './components/NamingModal';
import AuthModal from './components/AuthModal';
import AuthToast from './components/AuthToast';
import ImportModal from './components/ImportModal';
import ConfirmModal from './components/ConfirmModal';
import AccountSettingsModal from './components/AccountSettingsModal';
import SplashScreen from './components/SplashScreen';
import { TriangleAlert, Loader2 } from 'lucide-react';

import { generateAppCode } from './lib/llm';
import { slugifyName } from './lib/deploy';
import { savePendingJob, clearPendingJob, loadPendingJob } from './lib/pendingJob';
import { sanitizeHtmlResponse } from './lib/edits';
import { checkSyntax } from './lib/syntaxCheck';
import {
  STARTER_PRESETS, HTML_STREAM_START_RE
} from './lib/constants';
import { loadShowCodeView, SHOW_CODE_VIEW_KEY, loadAskClarifyingQuestions, ASK_CLARIFYING_QUESTIONS_KEY, loadSkipSplash, SKIP_SPLASH_KEY } from './lib/config';

import useTheme from './hooks/useTheme';
import useChatFont from './hooks/useChatFont';
import useAuth from './hooks/useAuth';
import useProjects from './hooks/useProjects';
import useDeployment from './hooks/useDeployment';
import usePreviewViewport from './hooks/usePreviewViewport';
import usePreviewBridge from './hooks/usePreviewBridge';
import useSuggestions from './hooks/useSuggestions';
import useBuildPaneResize from './hooks/useBuildPaneResize';

// App owns the workspace/generation state (prompt, versions, streaming) and
// composes everything else from hooks (src/hooks) and components
// (src/components). See CLAUDE.md for the module map.

const starterIdeas = STARTER_PRESETS.slice(0, 6);

export default function App() {
  // --- Layout / chrome state ---
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [showCodeView, setShowCodeView] = useState(loadShowCodeView);
  const [askClarifyingQuestions, setAskClarifyingQuestions] = useState(loadAskClarifyingQuestions);
  const [skipSplash, setSkipSplash] = useState(loadSkipSplash);
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('orion-history-open');
    return stored !== null ? stored === 'true' : false;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedVersionIndex, setExpandedVersionIndex] = useState(null);

  // --- Theme ---
  const { themePreference, setThemePreference, resolvedTheme } = useTheme();
  const handleToggleTheme = () => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark');
  const { chatFont, setChatFont } = useChatFont();
  const { panelWidth, isResizing, startResize, resetWidth } = useBuildPaneResize();

  // --- Auth ---
  const {
    authStatus, isSignedIn, user,
    authToast, dismissAuthToast,
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
  const [generationStatus, setGenerationStatus] = useState(null);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixMessage, setAutoFixMessage] = useState(null);
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

  // --- Interrupted build job (persisted across page reloads) ---
  const [interruptedJob, setInterruptedJob] = useState(null);

  // --- Streaming state ---
  const [streamingGeneratedCode, setStreamingGeneratedCode] = useState('');
  const [streamingReply, setStreamingReply] = useState('');

  // --- Naming / new-app flow ---
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [shouldGenerateAfterNaming, setShouldGenerateAfterNaming] = useState(false);
  const [isNewChatConfirmOpen, setIsNewChatConfirmOpen] = useState(false);

  // --- Mobile Layout ---
  const [mobileView, setMobileView] = useState('chat'); // 'chat' | 'preview'

  const chatBottomRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const streamingReplyRef = useRef('');
  const replyFrozenRef = useRef(false);
  const abortControllerRef = useRef(null);
  const runtimeErrorRetriesRef = useRef(0);
  const reloadStateRef = useRef({
    pending: false,
    token: null,
    isAutoFix: false,
    syntaxAutoFixed: false,
    timerId: null,
  });

  const clearStreamingState = useCallback(() => {
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
    containerRef: previewContainerRef,
    previewMode, setPreviewMode, previewOrientation, handleToggleOrientation,
    orientationFlipClass, setOrientationFlipClass, zoomLevel, isAutoZoom,
    handleManualZoom, resetZoom,
  } = usePreviewViewport({ activeTab, isHistoryOpen });

  // The preview bridge is spliced in at RENDER time only, so `generatedCode`
  // itself stays pristine: downloads, the code pane, the clipboard,
  // `orion-projects` and -- critically -- applySurgicalEdits never see it.
  // `previewReloadCount` re-runs the injection with a fresh token so the
  // srcDoc attribute changes and the iframe navigates -- i.e. reloads the
  // generated app -- without touching `generatedCode`.
  const [previewReloadCount, setPreviewReloadCount] = useState(0);

  const cancelPendingReload = useCallback(() => {
    if (reloadStateRef.current.timerId) {
      clearTimeout(reloadStateRef.current.timerId);
      reloadStateRef.current.timerId = null;
    }
    reloadStateRef.current.pending = false;
  }, []);

  const handleReloadPreview = useCallback(() => {
    cancelPendingReload();
    setPreviewReloadCount((n) => n + 1);
  }, [cancelPendingReload]);

  const confirmAndExecuteReload = useCallback(() => {
    reloadStateRef.current.timerId = null;
    if (!reloadStateRef.current.pending) return;
    if (isGenerating || isAutoFixing) return;
    if (chatMode !== 'build') return;

    // Check syntax one more time to ensure code integrity
    if (generatedCode) {
      const syntax = checkSyntax(generatedCode);
      if (syntax.errors && syntax.errors.length > 0) {
        reloadStateRef.current.pending = false;
        return;
      }
    }

    // When auto-fixing was in progress and the settlement period passes with no
    // runtime errors, auto-fixing is confirmed complete.
    if (reloadStateRef.current.isAutoFix || runtimeErrorRetriesRef.current > 0) {
      runtimeErrorRetriesRef.current = 0;
      setIsAutoFixing(false);
      setAutoFixMessage(null);
    }

    // Mark pending false BEFORE triggering the reload so the reloaded frame doesn't re-trigger.
    reloadStateRef.current.pending = false;
    handleReloadPreview();
  }, [isGenerating, isAutoFixing, chatMode, generatedCode, handleReloadPreview]);

  const scheduleReloadSettlement = useCallback((delayMs = 400) => {
    if (reloadStateRef.current.timerId) {
      clearTimeout(reloadStateRef.current.timerId);
    }
    reloadStateRef.current.timerId = setTimeout(() => {
      confirmAndExecuteReload();
    }, delayMs);
  }, [confirmAndExecuteReload]);

  const handlePreviewReady = useCallback(() => {
    // If a preview reload is pending for the latest build/edit/auto-fix,
    // wait a settlement period after the iframe reports ready to confirm
    // that no runtime errors fire during initial mount/execution.
    if (reloadStateRef.current.pending) {
      scheduleReloadSettlement(400);
    }
  }, [scheduleReloadSettlement]);

  const handleRuntimeError = useCallback((payload) => {
    // If a runtime error occurs, auto-fixing is necessary.
    // Immediately cancel any pending reload so it does not reload broken code
    // or interfere with auto-fixing.
    cancelPendingReload();

    if (isGenerating || chatMode !== 'build') return;
    if (runtimeErrorRetriesRef.current >= 2) {
      console.warn('Runtime error auto-fix limit reached.');
      setIsAutoFixing(false);
      setAutoFixMessage(null);
      return;
    }
    runtimeErrorRetriesRef.current += 1;
    const errorDetails = payload?.message || 'Runtime error detected';
    const promptText = `Fix this runtime error:\n${errorDetails}${payload?.line ? ` at line ${payload.line}` : ''}`;
    setIsAutoFixing(true);
    setAutoFixMessage(errorDetails);
    setGenerationStatus(`Fixing runtime error: ${errorDetails}`);
    handleGenerateRef.current?.(null, promptText, true, errorDetails);
  }, [cancelPendingReload, isGenerating, chatMode]);

  const { srcDoc: previewSrcDoc, token: previewToken } = useMemo(
    () => (generatedCode ? injectPreviewBridge(generatedCode) : { srcDoc: '', token: '' }),
    // previewReloadCount is intentionally "unused": bumping it re-runs the
    // injection so a fresh token forces the iframe to navigate (reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedCode, previewReloadCount]
  );

  usePreviewBridge({
    iframeRef,
    previewSrcDoc,
    previewToken,
    previewMode,
    onRuntimeError: handleRuntimeError,
    onReady: handlePreviewReady,
  });

  const codePanelCode = isGenerating ? (streamingGeneratedCode || generatedCode) : generatedCode;
  const isChatActive = hasSentFirstPrompt || versions.length > 0 || Boolean(generatedCode) || Boolean(pendingPrompt) || isResumingProject;
  const showStarterIdeas = !isChatActive;

  useEffect(() => {
    if (pendingPrompt || versions.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pendingPrompt, versions.length, streamingReply]);

  // Warn the user before leaving / reloading while a build is running.
  useEffect(() => {
    if (!isGenerating) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      // returnValue is required for cross-browser support (Chrome ignores the
      // custom message anyway and shows its own generic dialog).
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGenerating]);

  useEffect(() => {
    localStorage.setItem('orion-history-open', isHistoryOpen);
  }, [isHistoryOpen]);

  useEffect(() => {
    localStorage.setItem(SHOW_CODE_VIEW_KEY, showCodeView);
  }, [showCodeView]);

  useEffect(() => {
    localStorage.setItem(ASK_CLARIFYING_QUESTIONS_KEY, askClarifyingQuestions);
  }, [askClarifyingQuestions]);

  useEffect(() => {
    localStorage.setItem(SKIP_SPLASH_KEY, skipSplash);
  }, [skipSplash]);

  useEffect(() => {
    return () => {
      cancelPendingReload();
    };
  }, [cancelPendingReload]);

  // Once the resume-project flow settles, check for an interrupted build job.
  // We surface it only when it belongs to the project that just loaded (matched
  // by projectId) or when both the job and the workspace have no project yet.
  useEffect(() => {
    if (isResumingProject) return; // Still loading — wait.
    const job = loadPendingJob();
    if (!job) return;
    // The current project id is captured via closure; use the ref-based value.
    const resumedId = localStorage.getItem('orion-current-project-id') || null;
    const jobBelongsHere =
      (job.projectId ?? null) === (resumedId ?? null);
    if (jobBelongsHere) {
      setInterruptedJob(job);
    }
    // If the job belongs to a different project, leave the record intact but
    // don't surface it — the user can encounter it by opening that project.
  }, [isResumingProject]);

  const handleShowCodeViewChange = (value) => {
    setShowCodeView(value);
    if (!value) setActiveTab('preview');
  };

  const handleGenerate = async (e, overridePrompt, isAutoFix = false, autoFixError = null) => {
    e?.preventDefault();
    const currentPrompt = typeof overridePrompt === 'string' ? overridePrompt : prompt;
    if (!currentPrompt.trim()) return;

    if (!isAutoFix) {
      cancelPendingReload();
      runtimeErrorRetriesRef.current = 0;
      setIsAutoFixing(false);
      setAutoFixMessage(null);
    } else {
      cancelPendingReload();
      setIsAutoFixing(true);
      setAutoFixMessage(autoFixError || 'Runtime error detected');
    }

    if (!isSignedIn) {
      if (isAutoFix) {
        setIsAutoFixing(false);
        setAutoFixMessage(null);
        setGenerationStatus(null);
      }
      setIsAuthModalOpen(true);
      return;
    }

    // Require naming for transition from Untitled or New App
    if ((projectName === 'Untitled App' || !projectName.trim()) && !currentProjectId) {
      if (isAutoFix) {
        setIsAutoFixing(false);
        setAutoFixMessage(null);
        setGenerationStatus(null);
      }
      setTempProjectName('');
      setShouldGenerateAfterNaming(true);
      setIsNamingModalOpen(true);
      return;
    }

    setHasSentFirstPrompt(true);
    setIsGenerating(true);
    setIsSuggestionsExpanded(false);
    setMobileView('preview');
    clearStreamingState();
    setError(null);
    // Persist the in-flight job so a page close/reload can offer to resume it.
    setInterruptedJob(null);
    savePendingJob({
      projectId: currentProjectId,
      prompt: currentPrompt,
      chatMode,
      startedAt: Date.now(),
    });
    const updatedVersions = versions.slice(0, currentVersionIndex + 1);
    const prevVersion = updatedVersions[updatedVersions.length - 1];
    const shouldAskClarifyingQuestions = !isAutoFix && askClarifyingQuestions && prevVersion?.editMode !== 'clarify';

    setGenerationStatus(
      isAutoFix
        ? `Fixing runtime error${autoFixError ? `: ${autoFixError}` : '…'}`
        : shouldAskClarifyingQuestions
          ? (generatedCode ? "Analyzing requested changes..." : "Analyzing requirements...")
          : null
    );
    abortControllerRef.current = new AbortController();

    setPrompt(''); // Clear input so user can easily type their next refinement
    setPendingPrompt(currentPrompt);

    const chatHistory = updatedVersions.flatMap(v => [
      { role: 'user', content: v.prompt },
      { role: 'assistant', content: v.reply || (v.editMode === 'clarify' ? '' : 'I have updated the code.') }
    ]);

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, chatHistory, (chunk, kind = 'content') => {
        if (kind === 'reasoning') {
          return;
        }
        if (kind === 'clear_reply') {
          setStreamingReply('');
          streamingReplyRef.current = '';
          return;
        }
        if (kind === 'status') {
          setGenerationStatus(chunk);
          return;
        }
        streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
        if (HTML_STREAM_START_RE.test(streamingGeneratedCodeRef.current)) {
          setStreamingGeneratedCode(sanitizeHtmlResponse(streamingGeneratedCodeRef.current));
          setGenerationStatus("Synthesizing your app from your prompt.");
        }
        if (!replyFrozenRef.current) {
          const boundaryMatch = streamingGeneratedCodeRef.current.match(HTML_STREAM_START_RE);
          if (boundaryMatch) {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.slice(0, boundaryMatch.index).trim();
            replyFrozenRef.current = true;
            setStreamingReply(streamingReplyRef.current);
          } else {
            streamingReplyRef.current = streamingGeneratedCodeRef.current.trim();
            // Only stream the reply in ask mode. In build mode, wait for the HTML
            // to start generating to guarantee it's not a tool call before showing the reply.
            if (chatMode === 'ask') {
              setStreamingReply(streamingReplyRef.current);
            }
          }
        }
      }, 'both', abortControllerRef.current.signal, chatMode === 'ask', shouldAskClarifyingQuestions);
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

      const finalVersions = [...updatedVersions, newVersion];
      setVersions(finalVersions);
      setCurrentVersionIndex(updatedVersions.length);

      // Auto-save
      saveProject({
        versionsToSave: finalVersions,
        indexToSave: updatedVersions.length
      });

      // Generation completed successfully — no interrupted job to resume.
      clearPendingJob();

      // Check syntax: verify code is valid and has no unclosed/broken syntax.
      const syntaxCheck = checkSyntax(generationResult.code);
      const hasSyntaxErrors = Boolean(
        (syntaxCheck.errors && syntaxCheck.errors.length > 0) ||
        (generationResult.syntaxErrors && generationResult.syntaxErrors.length > 0)
      );
      const syntaxAutoFixed = Boolean(
        (generationResult.syntaxAutoFixAttempted || generationResult.syntaxRepairCycles > 0) && !hasSyntaxErrors
      );

      // If syntax errors remain, auto-fixing was not confirmed complete (it failed).
      // Do not trigger or schedule reload.
      if (hasSyntaxErrors) {
        cancelPendingReload();
      } else if (generationResult.editMode !== 'clarify' && generationResult.editMode !== 'ask') {
        // At the end of each build or edit, or when auto-fixing (syntax or runtime)
        // is complete, schedule a single preview reload once the iframe settles cleanly.
        cancelPendingReload();
        reloadStateRef.current = {
          pending: true,
          token: null,
          isAutoFix: Boolean(isAutoFix),
          syntaxAutoFixed,
          timerId: null,
        };
        // Fallback settlement timer in case bridge ready event is delayed or skipped
        scheduleReloadSettlement(800);
      }

    } catch (err) {
      cancelPendingReload();
      if (err.name === 'AbortError') {
        // Explicit user cancel — clear the job so no spurious resume banner.
        clearPendingJob();
        return;
      }
      setError(err.message);
      setPrompt(currentPrompt); // Restore prompt text on error
      // Clear the pending job on a hard error — user can see the error message
      // and re-submit themselves; stale job records would be confusing.
      clearPendingJob();
    } finally {
      setIsGenerating(false);
      setIsAutoFixing(false);
      setAutoFixMessage(null);
      setPendingPrompt('');
      setGenerationStatus(null);
      clearStreamingState();
    }
  };

  handleGenerateRef.current = handleGenerate;

  const handleCancelGeneration = () => {
    cancelPendingReload();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setIsAutoFixing(false);
    setAutoFixMessage(null);
    setGenerationStatus(null);
    clearStreamingState();
  };

  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Self-hosted mode's stand-in for Deploy: no public-URL hosting without
  // Firebase Storage, so hand the user the raw file instead.
  const handleExportHtml = () => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyName(projectName) || 'app'}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

  // --- Interrupted job handlers ---
  const handleRetryInterruptedJob = useCallback(() => {
    if (!interruptedJob) return;
    const jobPrompt = interruptedJob.prompt;
    const jobChatMode = interruptedJob.chatMode || 'build';
    setInterruptedJob(null);
    clearPendingJob();
    setChatMode(jobChatMode);
    setPrompt(jobPrompt);
    // Use setTimeout so state setters flush before handleGenerate reads them.
    setTimeout(() => handleGenerateRef.current?.(null, jobPrompt), 0);
  }, [interruptedJob]);

  const handleDismissInterruptedJob = useCallback(() => {
    setInterruptedJob(null);
    clearPendingJob();
  }, []);

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
    setInterruptedJob(null);
    clearPendingJob();
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

  // Only session restore blocks the UI; signed-out visitors can look around
  // freely and are only prompted to sign in when they try to generate or use
  // an account-only feature (see handleGenerate, DeployModal's onRequireSignIn).
  if (authStatus === 'loading') {
    return (
      <div className="h-dvh overflow-hidden bg-slate-50 flex items-center justify-center font-sans">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-50 flex flex-col font-sans">
      <SplashScreen skip={skipSplash} />
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
        onOpenHelp={() => setIsHelpOpen(true)}
        authStatus={authStatus}
        isSignedIn={isSignedIn}
        userEmail={user?.email}
        onOpenAccountSettings={() => setIsAccountSettingsOpen(true)}
        onSignIn={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
        firebaseEnabled={firebaseEnabled}
      />

      {/* Mobile Tab Toggle Bar (Sub-header) */}
      <div className="md:hidden shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 px-4 py-2 flex justify-center z-30">
        <div className="nav-segmented-group nav-segmented-compact w-full max-w-[260px]" role="radiogroup" aria-label="Mobile View">
          <button
            onClick={() => setMobileView('chat')}
            className={`nav-segmented-btn flex-1 py-1.5 text-xs uppercase tracking-wider font-bold ${mobileView === 'chat' ? 'nav-segmented-btn-active' : ''}`}
          >
            Chat
          </button>
          <button
            onClick={() => setMobileView('preview')}
            className={`nav-segmented-btn flex-1 py-1.5 text-xs uppercase tracking-wider font-bold ${mobileView === 'preview' ? 'nav-segmented-btn-active' : ''}`}
          >
            Preview
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
          resolvedTheme={resolvedTheme}
          chatFont={chatFont}
          onChatFontChange={setChatFont}
          showCodeView={showCodeView}
          onShowCodeViewChange={handleShowCodeViewChange}
          askClarifyingQuestions={askClarifyingQuestions}
          onAskClarifyingQuestionsChange={setAskClarifyingQuestions}
          skipSplash={skipSplash}
          onSkipSplashChange={setSkipSplash}
        />
      )}

      {isHelpOpen && (
        <HelpModal onClose={() => setIsHelpOpen(false)} />
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
          user={user}
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

      {isAccountSettingsOpen && isSignedIn && firebaseEnabled && (
        <AccountSettingsModal
          user={user}
          onClose={() => setIsAccountSettingsOpen(false)}
          onSignOut={handleSignOut}
        />
      )}

      {authToast && (
        <AuthToast kind={authToast} onDismiss={dismissAuthToast} />
      )}

      {isAuthModalOpen && firebaseEnabled && (
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
        <main className="flex-1 min-h-0 flex overflow-hidden relative">

          {/* Prompt/Chat Sidebar (Left) - Build Panel */}
          <div
            className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex h-full w-full md:w-[var(--build-panel-width)] flex-1 md:flex-none min-h-0 relative`}
            style={{ '--build-panel-width': `${panelWidth}px` }}
          >
            <BuildPanel
              isChatActive={isChatActive}
              isResumingProject={isResumingProject}
              chatMode={chatMode}
              onChatModeChange={setChatMode}
              generatedCode={generatedCode}
              showStarterIdeas={showStarterIdeas}
              starterIdeas={starterIdeas}
              onPickStarter={setPrompt}
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              pendingPrompt={pendingPrompt}
              streamingReply={streamingReply}
              isGenerating={isGenerating}
              generationStatus={generationStatus}
              isAutoFixing={isAutoFixing}
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
              interruptedJob={interruptedJob}
              onRetryInterruptedJob={handleRetryInterruptedJob}
              onDismissInterruptedJob={handleDismissInterruptedJob}
            />

            {/* Draggable Resize Divider */}
            <div
              onMouseDown={startResize}
              onDoubleClick={resetWidth}
              className="hidden md:flex absolute top-0 -right-1 w-2.5 h-full cursor-col-resize z-30 group items-center justify-center select-none"
              title="Drag to resize pane (double-click to reset)"
              aria-label="Resize edit pane"
            >
              <div className={`w-[2px] h-full transition-colors ${isResizing ? 'bg-indigo-500' : 'group-hover:bg-indigo-400/80 bg-transparent'}`} />
              <div className="absolute top-1/2 -translate-y-1/2 w-1 h-7 rounded-full bg-slate-400/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          </div>

          {/* Iframe shielding overlay while dragging */}
          {isResizing && (
            <div className="fixed inset-0 z-50 cursor-col-resize select-none bg-transparent" />
          )}

          {/* Preview/Device Area (Right) */}
          <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex h-full w-full flex-1 min-h-0`}>
            <PreviewPane
              activeTab={activeTab}
              onTabChange={setActiveTab}
              showCodeView={showCodeView}
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
              deployment={deployment}
              isDeployStale={isDeployStale}
              isSignedIn={isSignedIn}
              onOpenDeployModal={openDeployModal}
              firebaseEnabled={firebaseEnabled}
              onExportHtml={handleExportHtml}
              containerRef={previewContainerRef}
              iframeRef={iframeRef}
              previewSrcDoc={previewSrcDoc}
              onReloadPreview={handleReloadPreview}
              isGenerating={isGenerating && chatMode === 'build'}
              generationStatus={generationStatus}
              isAutoFixing={isAutoFixing}
              autoFixMessage={autoFixMessage}
              code={codePanelCode}
              copied={copied}
              onCopyCode={handleCopyCode}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
