import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge } from './previewBridge';
import { injectSelfHostedAiBridge } from './lib/selfHostedAiBridge';
import { generatedAiMode, generatedAiRelayUrl } from './lib/generatedAiMode';
import { firebaseEnabled } from './firebase';

import Header from './components/Header';
import HistorySidebar from './components/HistorySidebar';
import BuildPanel from './components/BuildPanel';
import PreviewPane from './components/PreviewPane';
import SettingsModal from './components/SettingsModal';
import HelpModal from './components/HelpModal';
import GuidedTour, { TourInvitation } from './components/GuidedTour';
import ProjectsListModal from './components/ProjectsListModal';
import DeployModal from './components/DeployModal';
import AnalyticsDashboardModal from './components/AnalyticsDashboardModal';
import NamingModal from './components/NamingModal';
import AuthModal from './components/AuthModal';
import AuthToast from './components/AuthToast';
import ImportModal from './components/ImportModal';
import ConfirmModal from './components/ConfirmModal';
import AccountSettingsModal from './components/AccountSettingsModal';
import SplashScreen from './components/SplashScreen';
import { TriangleAlert, Loader2 } from 'lucide-react';

import { generateAppCode, enhancePrompt } from './lib/llm';
import { compressImageDataUrl } from './lib/attachments';
import { slugifyName } from './lib/deploy';
import { savePendingJob, clearPendingJob, loadPendingJob } from './lib/pendingJob';
import {
  loadPreviewStorage,
  savePreviewStorage,
  clearPreviewStorage,
  applyStorageChange,
} from './lib/previewStorage';
import { sanitizeHtmlResponse } from './lib/edits';
import { checkSyntax, formatSyntaxErrors } from './lib/syntaxCheck';
import {
  newChatSessionId, groupVersionsByChatSession, getChatSessionStartIndex
} from './lib/chatSessions';
import {
  STARTER_PRESETS, ASK_STARTER_PRESETS, HTML_STREAM_START_RE, PREVIEW_MODES
} from './lib/constants';
import { loadShowCodeView, SHOW_CODE_VIEW_KEY, loadAskClarifyingQuestions, ASK_CLARIFYING_QUESTIONS_KEY, loadSkipSplash, SKIP_SPLASH_KEY } from './lib/config';

import useTheme from './hooks/useTheme';
import useChatFont from './hooks/useChatFont';
import useAuth from './hooks/useAuth';
import useProjects from './hooks/useProjects';
import useDeployment from './hooks/useDeployment';
import useAnalytics from './hooks/useAnalytics';
import usePreviewViewport from './hooks/usePreviewViewport';
import usePreviewBridge from './hooks/usePreviewBridge';

// App owns the workspace/generation state (prompt, versions, streaming) and
// composes everything else from hooks (src/hooks) and components
// (src/components). See CLAUDE.md for the module map.


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
  const [isTourOpen, setIsTourOpen] = useState(false);
  const tourLayoutRef = useRef(null);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // --- Theme ---
  const { themePreference, setThemePreference, resolvedTheme } = useTheme();
  const handleToggleTheme = () => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark');
  const { chatFont, setChatFont } = useChatFont();

  // --- Auth ---
  const {
    authStatus, isSignedIn, user,
    username, usernameLoading, claimUsername,
    authToast, dismissAuthToast,
    isAuthModalOpen, setIsAuthModalOpen,
    isImportModalOpen, importLocalCount, isImporting,
    handleImportProjects: runProjectImport,
    handleSkipImport, handleSignOut,
  } = useAuth();

  // --- Workspace state (the generation flow owns these) ---
  const [prompt, setPrompt] = useState('');
  // Pending image attachment for the next prompt -- a screenshot of the
  // preview or a manually-picked file. Ephemeral: sent with the one request
  // and never written into `versions`/localStorage/Firestore (see
  // CLAUDE.md-adjacent plan notes -- avoids Firestore's 1MiB per-project doc
  // cap and keeps applySurgicalEdits/history untouched). { dataUrl, name, source }
  const [attachment, setAttachment] = useState(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [attachmentError, setAttachmentError] = useState(null);
  // Mirrors `attachment` for the duration of one in-flight request, purely so
  // the pending/"sending..." chat bubble can show the thumbnail -- see the
  // attachmentForRequest capture in handleGenerate.
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [chatMode, setChatMode] = useState('build'); // 'build' or 'ask'
  const [error, setError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState(null);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixMessage, setAutoFixMessage] = useState(null);
  const [versions, setVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  // Index into `versions` where the current chat begins. Turns before it are
  // excluded from the LLM's chat history and hidden from the transcript after
  // "New chat", but stay in version history; restoring a version from another
  // chat session re-activates that session (the cutoff moves to its start).
  const [chatContextStartIndex, setChatContextStartIndex] = useState(0);
  // Id of the chat session new prompts will join. Each version records the
  // session it was created in; clicking "+ new chat" starts a fresh id without
  // discarding earlier sessions (they stay grouped in version history).
  const [currentChatSessionId, setCurrentChatSessionId] = useState(newChatSessionId);
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
  const [aiEnabled, setAiEnabled] = useState(false);

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
  const enhanceAbortControllerRef = useRef(null);
  const runtimeErrorRetriesRef = useRef(0);
  const syntaxErrorRetriesRef = useRef(0);
  const isGeneratingRef = useRef(false);
  const isAutoFixingRef = useRef(false);
  const isEvaluatingNewCodeRef = useRef(false);
  const pendingRuntimeErrorRef = useRef(null);
  const prevProjectIdRef = useRef(currentProjectId);
  const [projectStorageVersion, setProjectStorageVersion] = useState(0);
  // Chat sessions derived from the flat versions array (see lib/chatSessions).
  const chatSessions = useMemo(() => groupVersionsByChatSession(versions), [versions]);
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

  // --- Projects (list / persistence) ---
  const {
    myProjects, isProjectsListOpen, setIsProjectsListOpen,
    loadUserProjects, loadProject, saveProject, renameProject, deleteProject,
  } = useProjects({
    authStatus,
    isSignedIn,
    user,
    workspace: {
      versions, currentVersionIndex, chatContextStartIndex, currentChatSessionId, projectName, currentProjectId, deployment, aiEnabled,
      setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setDeployment, setAiEnabled,
      setGeneratedCode, setCurrentProjectId, setHasSentFirstPrompt,
      setIsResumingProject, clearStreamingState,
    },
  });

  // --- Deployment ---
  const currentVersionId = versions[currentVersionIndex]?.id ?? null;
  const {
    isDeployModalOpen, setIsDeployModalOpen, isDeploying, deployError, setDeployError,
    deployCopied, confirmUndeploy, setConfirmUndeploy, isDeployStale, deploymentUrl,
    openDeployModal, closeDeployModal, handleDeploy, handleUndeploy, handleCopyDeployUrl,
  } = useDeployment({
    generatedCode, isSignedIn, user, username, projectName, currentProjectId,
    currentVersionId, deployment, setDeployment, saveProject, aiEnabled,
  });

  // --- Analytics dashboard ---
  const {
    isAnalyticsOpen, openAnalytics, closeAnalytics,
    myAnalyticsApps, appsLoading: analyticsAppsLoading,
    selectedSlug: analyticsSelectedSlug, selectApp: selectAnalyticsApp,
    range: analyticsRange, changeRange: changeAnalyticsRange,
    stats: analyticsStats, statsLoading: analyticsStatsLoading, error: analyticsError,
  } = useAnalytics({ isSignedIn, user });

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
    runtimeErrorRetriesRef.current = 0;
    syntaxErrorRetriesRef.current = 0;
    pendingRuntimeErrorRef.current = null;
    isEvaluatingNewCodeRef.current = false;
    setIsAutoFixing(false);
    isAutoFixingRef.current = false;
    setAutoFixMessage(null);
    setPreviewReloadCount((n) => n + 1);
  }, [cancelPendingReload]);

  const scheduleReloadSettlementRef = useRef(null);

  const handleSyntaxError = useCallback((errors) => {
    cancelPendingReload();

    if (chatMode !== 'build') return;
    if (isGeneratingRef.current) return;
    if (isAutoFixingRef.current) return;

    const errorList = Array.isArray(errors) ? errors : (errors?.errors || []);
    if (syntaxErrorRetriesRef.current >= 2) {
      console.warn('Syntax error auto-fix limit reached.');
      setIsAutoFixing(false);
      isAutoFixingRef.current = false;
      setAutoFixMessage(null);
      const formatted = formatSyntaxErrors(errorList);
      setError(`Syntax errors detected in code:\n${formatted}`);
      return;
    }

    syntaxErrorRetriesRef.current += 1;
    const errorDetails = formatSyntaxErrors(errorList) || 'JavaScript syntax error detected';
    const promptText = `Fix these JavaScript syntax errors in the app code:\n${errorDetails}`;
    setIsAutoFixing(true);
    isAutoFixingRef.current = true;
    setAutoFixMessage(errorDetails);
    setGenerationStatus(`Fixing syntax error: ${errorList[0]?.message || 'Syntax error'}`);
    handleGenerateRef.current?.(null, promptText, true, errorDetails);
  }, [cancelPendingReload, chatMode]);

  const confirmAndExecuteReload = useCallback(() => {
    reloadStateRef.current.timerId = null;
    if (!reloadStateRef.current.pending) return;
    if (isGeneratingRef.current || isAutoFixingRef.current) {
      scheduleReloadSettlementRef.current?.(400);
      return;
    }
    if (chatMode !== 'build') return;

    // Check syntax one more time to ensure code integrity
    if (generatedCode) {
      const syntax = checkSyntax(generatedCode);
      if (syntax.errors && syntax.errors.length > 0) {
        reloadStateRef.current.pending = false;
        if (!isAutoFixingRef.current && syntaxErrorRetriesRef.current < 2) {
          handleSyntaxError(syntax.errors);
        }
        return;
      }
    }

    // When auto-fixing was in progress and the settlement period passes with no
    // runtime errors, auto-fixing is confirmed complete.
    if (reloadStateRef.current.isAutoFix || runtimeErrorRetriesRef.current > 0 || syntaxErrorRetriesRef.current > 0) {
      runtimeErrorRetriesRef.current = 0;
      syntaxErrorRetriesRef.current = 0;
      setIsAutoFixing(false);
      isAutoFixingRef.current = false;
      setAutoFixMessage(null);
    }

    // Mark pending false BEFORE triggering the reload so the reloaded frame doesn't re-trigger.
    reloadStateRef.current.pending = false;
    handleReloadPreview();
  }, [chatMode, generatedCode, handleReloadPreview, handleSyntaxError]);

  const scheduleReloadSettlement = useCallback((delayMs = 400) => {
    if (reloadStateRef.current.timerId) {
      clearTimeout(reloadStateRef.current.timerId);
    }
    reloadStateRef.current.timerId = setTimeout(() => {
      confirmAndExecuteReload();
    }, delayMs);
  }, [confirmAndExecuteReload]);
  scheduleReloadSettlementRef.current = scheduleReloadSettlement;

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

    if (chatMode !== 'build') return;

    if (isGeneratingRef.current) {
      // If code generation is still in flight, only queue the error if we are
      // already evaluating the newly generated code (post-generateAppCode),
      // ensuring stale errors from prior versions are not auto-fixed.
      if (isEvaluatingNewCodeRef.current) {
        if (!pendingRuntimeErrorRef.current) {
          pendingRuntimeErrorRef.current = payload;
        }
      }
      return;
    }

    if (isAutoFixingRef.current) {
      // Already actively auto-fixing; prevent secondary error storms in the same broken preview
      // from incrementing retries or firing duplicate auto-fix jobs.
      return;
    }

    if (runtimeErrorRetriesRef.current >= 2) {
      console.warn('Runtime error auto-fix limit reached.');
      setIsAutoFixing(false);
      isAutoFixingRef.current = false;
      setAutoFixMessage(null);
      setError(`Runtime error in preview: ${payload?.message || 'Runtime error detected'}`);
      return;
    }

    runtimeErrorRetriesRef.current += 1;
    const errorDetails = payload?.message || 'Runtime error detected';
    const promptText = `Fix this runtime error:\n${errorDetails}${payload?.line ? ` at line ${payload.line}` : ''}`;
    setIsAutoFixing(true);
    isAutoFixingRef.current = true;
    setAutoFixMessage(errorDetails);
    setGenerationStatus(`Fixing runtime error: ${errorDetails}`);
    handleGenerateRef.current?.(null, promptText, true, errorDetails);
  }, [cancelPendingReload, chatMode]);

  const previewStorageRef = useRef({});

  useEffect(() => {
    previewStorageRef.current = loadPreviewStorage(currentProjectId);
  }, [currentProjectId]);

  const handleStorageChange = useCallback(
    (type, payload) => {
      const changed = applyStorageChange(previewStorageRef.current, type, payload);
      if (changed) {
        savePreviewStorage(currentProjectId, previewStorageRef.current);
      }
    },
    [currentProjectId]
  );

  const handleClearPreviewStorage = useCallback(() => {
    clearPreviewStorage(currentProjectId);
    previewStorageRef.current = {};
    handleReloadPreview();
  }, [currentProjectId, handleReloadPreview]);

  useEffect(() => {
    // Only bump preview storage version when switching between distinct existing projects,
    // avoiding spurious iframe reloads during initial project auto-save (null -> newId).
    if (currentProjectId && prevProjectIdRef.current && currentProjectId !== prevProjectIdRef.current) {
      setProjectStorageVersion((v) => v + 1);
    }
    prevProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  const { srcDoc: previewSrcDoc, token: previewToken } = useMemo(
    () =>
      generatedCode
        ? injectPreviewBridge(
            (!firebaseEnabled && aiEnabled)
              ? injectSelfHostedAiBridge(generatedCode, { mode: generatedAiMode, relayUrl: generatedAiRelayUrl })
              : generatedCode,
          {
            initialStorage: loadPreviewStorage(currentProjectId),
            // Baked into the bridge as its initial desiredEnabled so the
            // touch-scroll simulation + scrollbar hiding are live from the
            // frame's first paint. The configure push from usePreviewBridge
            // can lose the load race on a srcdoc navigation (heaviest right
            // when a generation completes), which before this left the fresh
            // frame unconfigured -- visible scrollbar, dead touch controls --
            // until a manual reload.
            touchEnabled: PREVIEW_MODES[previewMode].isTouchChrome,
            aiEnabled: firebaseEnabled && aiEnabled,
          })
        : { srcDoc: '', token: '' },
    // previewReloadCount is intentionally "unused": bumping it re-runs the
    // injection so a fresh token forces the iframe to navigate (reload).
    // previewMode is intentionally read without being a dependency: a device
    // switch must NOT recompute srcDoc (that would reload the frame). It only
    // matters when a new document is produced, and every recompute picks up
    // the mode current at that moment; later mode switches are delivered to
    // the already-loaded frame via usePreviewBridge's configure push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedCode, previewReloadCount, projectStorageVersion, aiEnabled]
  );

  const { requestScreenshot } = usePreviewBridge({
    iframeRef,
    previewSrcDoc,
    previewToken,
    previewMode,
    onRuntimeError: handleRuntimeError,
    onReady: handlePreviewReady,
    onStorageChange: handleStorageChange,
    aiEnabled: firebaseEnabled && aiEnabled,
  });

  const handleAttachScreenshot = useCallback(async () => {
    setAttachmentError(null);
    setIsCapturingScreenshot(true);
    try {
      const { dataUrl } = await requestScreenshot();
      const compressed = await compressImageDataUrl(dataUrl);
      setAttachment({ dataUrl: compressed, name: 'Preview screenshot', source: 'screenshot' });
    } catch (err) {
      setAttachmentError(err?.message || 'Failed to capture the preview screenshot.');
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [requestScreenshot]);

  const handleAttachFile = useCallback(async (file) => {
    if (!file) return;
    setAttachmentError(null);
    if (!file.type?.startsWith('image/')) {
      setAttachmentError('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setAttachmentError('Image must be smaller than 8MB.');
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read the image file.'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageDataUrl(dataUrl);
      setAttachment({ dataUrl: compressed, name: file.name, source: 'upload' });
    } catch (err) {
      setAttachmentError(err?.message || 'Failed to attach the image.');
    }
  }, []);

  const handleRemoveAttachment = useCallback(() => {
    setAttachment(null);
    setAttachmentError(null);
  }, []);

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

  // Rewrites the draft prompt in place via a quick non-streaming LLM call --
  // never submits it. Build mode only; ask mode has no app-idea to enhance.
  const handleEnhancePrompt = async () => {
    if (chatMode !== 'build' || isGenerating || isEnhancingPrompt || !prompt.trim()) return;

    setIsEnhancingPrompt(true);
    setError(null);
    enhanceAbortControllerRef.current = new AbortController();

    try {
      const enhanced = await enhancePrompt({
        prompt,
        currentCode: generatedCode || null,
        signal: enhanceAbortControllerRef.current.signal,
      });
      if (enhanced) setPrompt(enhanced);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message || 'Failed to enhance prompt.');
    } finally {
      setIsEnhancingPrompt(false);
      enhanceAbortControllerRef.current = null;
    }
  };

  const handleGenerate = async (e, overridePrompt, isAutoFix = false, autoFixError = null) => {
    e?.preventDefault();
    const currentPrompt = typeof overridePrompt === 'string' ? overridePrompt : prompt;
    if (!currentPrompt.trim()) return;

    if (!isAutoFix) {
      cancelPendingReload();
      runtimeErrorRetriesRef.current = 0;
      pendingRuntimeErrorRef.current = null;
      isEvaluatingNewCodeRef.current = false;
      setIsAutoFixing(false);
      isAutoFixingRef.current = false;
      setAutoFixMessage(null);
    } else {
      cancelPendingReload();
      pendingRuntimeErrorRef.current = null;
      isEvaluatingNewCodeRef.current = false;
      setIsAutoFixing(true);
      isAutoFixingRef.current = true;
      setAutoFixMessage(autoFixError || 'Runtime error detected');
    }

    if (!isSignedIn) {
      if (isAutoFix) {
        setIsAutoFixing(false);
        isAutoFixingRef.current = false;
        setAutoFixMessage(null);
        setGenerationStatus(null);
      }
      setIsAuthModalOpen(true);
      return;
    }

    // Require naming for transition from Untitled or New App. Skipped in ask
    // mode before any app exists -- a plain question shouldn't force naming a
    // project that may never contain generated code.
    if (chatMode !== 'ask' && (projectName === 'Untitled App' || !projectName.trim()) && !currentProjectId) {
      if (isAutoFix) {
        setIsAutoFixing(false);
        isAutoFixingRef.current = false;
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
    isGeneratingRef.current = true;
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
    const shouldAskClarifyingQuestions = !isAutoFix && chatMode !== 'ask' && askClarifyingQuestions && prevVersion?.editMode !== 'clarify';

    const isSyntaxAutoFix = isAutoFix && autoFixError?.toLowerCase().includes('syntax');
    setGenerationStatus(
      isAutoFix
        ? (isSyntaxAutoFix
            ? `Fixing syntax error${autoFixError ? `: ${autoFixError.slice(0, 80)}` : '…'}`
            : `Fixing runtime error${autoFixError ? `: ${autoFixError.slice(0, 80)}` : '…'}`)
        : shouldAskClarifyingQuestions
          ? (generatedCode ? "Analyzing requested changes..." : "Analyzing requirements...")
          : null
    );
    abortControllerRef.current = new AbortController();

    setPrompt(''); // Clear input so user can easily type their next refinement
    setPendingPrompt(currentPrompt);
    // Captured before clearing so this request still carries it -- the
    // attachment is ephemeral (never persisted onto the version/chat history).
    const attachmentForRequest = attachment;
    setAttachment(null);
    setAttachmentError(null);
    setPendingAttachment(attachmentForRequest);

    const chatHistory = updatedVersions.slice(chatContextStartIndex).flatMap(v => [
      { role: 'user', content: v.prompt },
      { role: 'assistant', content: v.reply || (v.editMode === 'clarify' ? '' : 'I have updated the code.') }
    ]);

    try {
      const generationResult = await generateAppCode(currentPrompt, generatedCode, chatHistory, (chunk, kind = 'content') => {
        if (kind === 'reasoning') {
          return;
        }
        if (kind === 'reply') {
          // Pre-generation acknowledgement, streamed before the model starts
          // reasoning/coding. Render it immediately and freeze it so the main
          // generation's own leading reply doesn't overwrite it.
          streamingReplyRef.current = `${streamingReplyRef.current}${chunk}`;
          setStreamingReply(streamingReplyRef.current);
          replyFrozenRef.current = true;
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
      }, 'both', abortControllerRef.current.signal, chatMode === 'ask', shouldAskClarifyingQuestions, attachmentForRequest, aiEnabled, generatedAiMode);
      isEvaluatingNewCodeRef.current = true;
      setGeneratedCode(generationResult.code);

      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        code: generationResult.code,
        timestamp: new Date().toLocaleTimeString(),
        editMode: generationResult.editMode,
        editSummary: generationResult.editSummary,
        reply: generationResult.reply || null,
        chatMode,
        sessionId: currentChatSessionId
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
      const syntaxErrors = (syntaxCheck.errors && syntaxCheck.errors.length > 0)
        ? syntaxCheck.errors
        : (generationResult.syntaxErrors && generationResult.syntaxErrors.length > 0)
          ? generationResult.syntaxErrors
          : [];
      const hasSyntaxErrors = syntaxErrors.length > 0;
      const syntaxAutoFixed = Boolean(
        (generationResult.syntaxAutoFixAttempted || generationResult.syntaxRepairCycles > 0) && !hasSyntaxErrors
      );

      if (hasSyntaxErrors) {
        cancelPendingReload();
        if (syntaxErrorRetriesRef.current < 2) {
          setTimeout(() => {
            handleSyntaxError(syntaxErrors);
          }, 0);
        } else {
          const formatted = formatSyntaxErrors(syntaxErrors);
          setError(`Syntax errors in generated code:\n${formatted}`);
          setIsAutoFixing(false);
          isAutoFixingRef.current = false;
          setAutoFixMessage(null);
        }
      } else {
        syntaxErrorRetriesRef.current = 0;
        if (generationResult.editMode !== 'clarify' && generationResult.editMode !== 'ask') {
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
      }

    } catch (err) {
      cancelPendingReload();
      pendingRuntimeErrorRef.current = null;
      isEvaluatingNewCodeRef.current = false;
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
      isGeneratingRef.current = false;
      isEvaluatingNewCodeRef.current = false;
      if (!isAutoFix && !pendingRuntimeErrorRef.current) {
        setIsAutoFixing(false);
        isAutoFixingRef.current = false;
        setAutoFixMessage(null);
      }
      setPendingPrompt('');
      setPendingAttachment(null);
      setGenerationStatus(null);
      clearStreamingState();

      if (pendingRuntimeErrorRef.current && chatMode === 'build') {
        const pendingError = pendingRuntimeErrorRef.current;
        pendingRuntimeErrorRef.current = null;
        setTimeout(() => {
          handleRuntimeError(pendingError);
        }, 0);
      }
    }
  };

  handleGenerateRef.current = handleGenerate;

  const handleCancelGeneration = () => {
    cancelPendingReload();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    runtimeErrorRetriesRef.current = 0;
    syntaxErrorRetriesRef.current = 0;
    setIsGenerating(false);
    isGeneratingRef.current = false;
    setIsAutoFixing(false);
    isAutoFixingRef.current = false;
    isEvaluatingNewCodeRef.current = false;
    pendingRuntimeErrorRef.current = null;
    setAutoFixMessage(null);
    setGenerationStatus(null);
    clearStreamingState();
  };

  // "New chat": starts a fresh chat session. The next prompt is sent with no
  // prior chat turns (the app code itself is still sent), while the versions
  // and chat history of earlier sessions stay untouched and grouped in version
  // history -- restoring one of their checkpoints re-activates that session.
  const handleStartNewChat = () => {
    if (isGenerating) {
      handleCancelGeneration();
    }
    const cutoff = currentVersionIndex + 1;
    const nextSessionId = newChatSessionId();
    setChatContextStartIndex(cutoff);
    setCurrentChatSessionId(nextSessionId);
    setPendingPrompt('');
    setPendingAttachment(null);
    setError(null);
    setPrompt('');
    setAttachment(null);
    setAttachmentError(null);
    clearStreamingState();
    if (currentProjectId) {
      saveProject({ chatContextStartToSave: cutoff, sessionIdToSave: nextSessionId });
    }
  };

  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const outputHtml = (!firebaseEnabled && aiEnabled)
      ? injectSelfHostedAiBridge(generatedCode, { mode: generatedAiMode, relayUrl: generatedAiRelayUrl })
      : generatedCode;
    const blob = new Blob([outputHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Self-hosted mode's stand-in for Deploy: no public-URL hosting without
  // Firebase Storage, so hand the user the raw file instead.
  const handleExportHtml = () => {
    if (!generatedCode) return;
    const outputHtml = (!firebaseEnabled && aiEnabled)
      ? injectSelfHostedAiBridge(generatedCode, { mode: generatedAiMode, relayUrl: generatedAiRelayUrl })
      : generatedCode;
    const blob = new Blob([outputHtml], { type: 'text/html' });
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
      setChatContextStartIndex(0);
      setCurrentChatSessionId(newChatSessionId());
      setDeployment(null);
      setAiEnabled(false);
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
      cancelPendingReload();
      runtimeErrorRetriesRef.current = 0;
      pendingRuntimeErrorRef.current = null;
      isEvaluatingNewCodeRef.current = false;
      setIsAutoFixing(false);
      isAutoFixingRef.current = false;
      setAutoFixMessage(null);
      clearStreamingState();
      // Restoring (or undoing to) a checkpoint re-activates the chat session it
      // was created in: the transcript and the LLM's chat context switch to
      // that session's turns, and its grouped history stays together. Restores
      // within the current session keep the context trimmed as before.
      const targetSessionId = versions[index].sessionId ?? null;
      const sessionStart = getChatSessionStartIndex(versions, index);
      setCurrentChatSessionId(targetSessionId);
      setChatContextStartIndex(sessionStart);
      setCurrentVersionIndex(index);
      // Ask-mode turns never changed the app, so restoring one rewinds only
      // the conversation: the preview keeps showing the current code and the
      // user can continue chatting where they left off. (An ask version's
      // stored `code` is just a snapshot from when it was asked -- empty if
      // nothing was built yet -- so restoring it would roll back or blank
      // the mockup for no reason.)
      if (versions[index].editMode !== 'ask') {
        setGeneratedCode(versions[index].code);
      }
      if (currentProjectId) {
        saveProject({
          indexToSave: index,
          chatContextStartToSave: sessionStart,
          sessionIdToSave: targetSessionId ?? undefined,
        });
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
    cancelPendingReload();
    runtimeErrorRetriesRef.current = 0;
    pendingRuntimeErrorRef.current = null;
    isEvaluatingNewCodeRef.current = false;
    isGeneratingRef.current = false;
    setIsAutoFixing(false);
    isAutoFixingRef.current = false;
    setAutoFixMessage(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    clearStreamingState();
    setGeneratedCode('');
    setPrompt('');
    setAttachment(null);
    setAttachmentError(null);
    setPendingPrompt('');
    setPendingAttachment(null);
    setHasSentFirstPrompt(false);
    setChatMode('build');
    setError(null);
    setVersions([]);
    setCurrentVersionIndex(-1);
    setChatContextStartIndex(0);
    setCurrentChatSessionId(newChatSessionId());
    setCurrentProjectId(null);
    setDeployment(null);
    setAiEnabled(false);
    setDeployError(null);
    setConfirmUndeploy(false);
    setIsDeployModalOpen(false);
    setTempProjectName('');
    setShouldGenerateAfterNaming(false);
    setIsNamingModalOpen(false);
    setProjectName('Untitled App');
    localStorage.removeItem('orion-current-project-id');
    clearPreviewStorage(null);
    previewStorageRef.current = {};
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

  const startTour = () => {
    tourLayoutRef.current = { mobileView, activeTab };
    setIsHelpOpen(false);
    setActiveTab('preview');
    setIsTourOpen(true);
  };
  const closeTour = () => {
    setIsTourOpen(false);
    if (tourLayoutRef.current) {
      setMobileView(tourLayoutRef.current.mobileView);
      setActiveTab(tourLayoutRef.current.activeTab);
    }
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
        onOpenAnalytics={() => openAnalytics()}
      />

      {/* Mobile Tab Toggle Bar (Sub-header) */}
      <div className="md:hidden shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 px-4 py-2 flex justify-center z-30">
        <div className="nav-segmented-group nav-segmented-compact w-full max-w-65" role="radiogroup" aria-label="Mobile View">
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

      <TourInvitation onStart={startTour} />
      {isTourOpen && (
        <GuidedTour onClose={closeTour} onViewChange={setMobileView} firebaseEnabled={firebaseEnabled} hasCode={Boolean(generatedCode)} showCodeView={showCodeView} />
      )}

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
        <HelpModal onClose={() => setIsHelpOpen(false)} onStartTour={startTour} />
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
          username={username}
          usernameLoading={usernameLoading}
          onClaimUsername={claimUsername}
          deployment={deployment}
          aiEnabled={aiEnabled}
          onAiEnabledChange={(enabled) => { setAiEnabled(enabled); saveProject({ aiEnabledToSave: enabled, force: true }); }}
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


      {isAnalyticsOpen && firebaseEnabled && isSignedIn && (
        <AnalyticsDashboardModal
          apps={myAnalyticsApps}
          appsLoading={analyticsAppsLoading}
          selectedSlug={analyticsSelectedSlug}
          onSelectApp={selectAnalyticsApp}
          range={analyticsRange}
          onRangeChange={changeAnalyticsRange}
          stats={analyticsStats}
          statsLoading={analyticsStatsLoading}
          error={analyticsError}
          onClose={closeAnalytics}
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
          username={username}
          usernameLoading={usernameLoading}
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
          chatSessions={chatSessions}
          currentVersionIndex={currentVersionIndex}
          onSwitchVersion={switchVersion}
          onCollapse={() => setIsHistoryOpen(false)}
          onExpand={() => setIsHistoryOpen(true)}
        />

        {/* Main Workspace */}
        <main className="flex-1 min-h-0 flex overflow-hidden relative">

          {/* Prompt/Chat Sidebar (Left) - Build Panel */}
          <div
            className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex h-full w-full md:w-[clamp(320px,35vw,420px)] flex-1 md:flex-none min-h-0 relative`}
          >
            <BuildPanel
              isChatActive={isChatActive}
              isResumingProject={isResumingProject}
              chatMode={chatMode}
              aiEnabled={aiEnabled}
              onAiEnabledChange={(enabled) => { setAiEnabled(enabled); saveProject({ aiEnabledToSave: enabled, force: true }); }}
              onChatModeChange={setChatMode}
              generatedCode={generatedCode}
              showStarterIdeas={showStarterIdeas}
              starterIdeas={chatMode === 'ask' ? ASK_STARTER_PRESETS : STARTER_PRESETS}
              onPickStarter={setPrompt}
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              chatContextStartIndex={chatContextStartIndex}
              pendingPrompt={pendingPrompt}
              pendingAttachment={pendingAttachment}
              streamingReply={streamingReply}
              isGenerating={isGenerating}
              generationStatus={generationStatus}
              isAutoFixing={isAutoFixing}
              error={error}
              prompt={prompt}
              onPromptChange={setPrompt}
              onSubmit={handleGenerate}
              onEnhancePrompt={handleEnhancePrompt}
              isEnhancingPrompt={isEnhancingPrompt}
              onCancelGeneration={handleCancelGeneration}
              attachment={attachment}
              attachmentError={attachmentError}
              isCapturingScreenshot={isCapturingScreenshot}
              onAttachScreenshot={handleAttachScreenshot}
              onAttachFile={handleAttachFile}
              onRemoveAttachment={handleRemoveAttachment}
              onNewChat={handleStartNewChat}
              chatBottomRef={chatBottomRef}
              interruptedJob={interruptedJob}
              onRetryInterruptedJob={handleRetryInterruptedJob}
              onDismissInterruptedJob={handleDismissInterruptedJob}
            />
          </div>

          {/* Preview/Device Area (Right) */}
          <div data-tour="preview" className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex h-full w-full flex-1 min-w-0 min-h-0`}>
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
              onClearStorage={handleClearPreviewStorage}
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
