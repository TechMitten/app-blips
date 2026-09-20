import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import GuidedTour, { TourInvitation } from './components/GuidedTour';
import ProjectsListModal from './components/ProjectsListModal';
import DeployModal from './components/DeployModal';
import AnalyticsDashboardModal from './components/AnalyticsDashboardModal';
import NamingModal from './components/NamingModal';
import AuthModal from './components/AuthModal';
import AuthToast from './components/AuthToast';
import ConfirmModal from './components/ConfirmModal';
import AccountSettingsModal from './components/AccountSettingsModal';
import SplashScreen from './components/SplashScreen';
import StudioChoice from './components/StudioChoice';
import { TriangleAlert, Loader2 } from 'lucide-react';

import { generateAppCode } from './lib/llm';
import { compressImageDataUrl } from './lib/attachments';
import { slugifyName, sweepUserDeployments } from './lib/deploy';
import authProvider from './lib/auth';
import { deleteUserProfile } from './lib/username';
import { savePendingJob, clearPendingJob, loadPendingJob } from './lib/pendingJob';
import { applyDirectEdit, buildElementEditPrompt } from './lib/directEdits';
import {
  loadPreviewStorage,
  savePreviewStorage,
  clearPreviewStorage,
  applyStorageChange,
} from './lib/previewStorage';
import { sanitizeHtmlResponse } from './lib/edits';
import { extractStreamedEditCode } from './lib/helpers';
import { LANDING_PAGE, getLanding, mapPages, pageNames, versionFiles } from './lib/pages';
import { formatSyntaxErrors } from './lib/syntaxCheck';
import { checkSyntaxFiles } from './lib/pageTools';
import {
  newChatSessionId, groupVersionsByChatSession, getChatSessionStartIndex
} from './lib/chatSessions';
import {
  STARTER_PRESETS, ASK_STARTER_PRESETS, WEBSITE_STARTER_PRESETS, HTML_STREAM_START_RE, PREVIEW_MODES, STUDIO_MODES, DOCS_URL
} from './lib/constants';
import { loadShowCodeView, SHOW_CODE_VIEW_KEY, loadAskClarifyingQuestions, ASK_CLARIFYING_QUESTIONS_KEY, loadSkipSplash, SKIP_SPLASH_KEY, loadAutoFollowCode, AUTO_FOLLOW_CODE_KEY, loadLiveCodePreview, LIVE_CODE_PREVIEW_KEY, loadReasoningEffort, REASONING_EFFORT_KEY, loadChatMode, saveChatMode, loadBuildPaneSide, BUILD_PANE_SIDE_KEY } from './lib/config';

import useTheme from './hooks/useTheme';
import useVisualViewport from './hooks/useVisualViewport';
import useChatFont from './hooks/useChatFont';
import useAuth from './hooks/useAuth';
import useProjects from './hooks/useProjects';
import useDeployment from './hooks/useDeployment';
import useAnalytics from './hooks/useAnalytics';
import usePreviewViewport from './hooks/usePreviewViewport';
import usePreviewBridge from './hooks/usePreviewBridge';
import usePageNavigation from './hooks/usePageNavigation';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
import { buildSiteShell } from './lib/siteRouter';
import { createZip } from './lib/zip';

// App owns the workspace/generation state (prompt, versions, streaming) and
// composes everything else from hooks (src/hooks) and components
// (src/components). See CLAUDE.md for the module map.


export default function App() {
  useVisualViewport();
  // --- Layout / chrome state ---
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [showCodeView, setShowCodeView] = useState(loadShowCodeView);
  const [askClarifyingQuestions, setAskClarifyingQuestions] = useState(loadAskClarifyingQuestions);
  const [skipSplash, setSkipSplash] = useState(loadSkipSplash);
  const [autoFollowCode, setAutoFollowCode] = useState(loadAutoFollowCode);
  const [liveCodePreview, setLiveCodePreview] = useState(loadLiveCodePreview);
  const [buildPaneSide, setBuildPaneSide] = useState(loadBuildPaneSide);
  const [reasoningEffort, setReasoningEffort] = useState(loadReasoningEffort);
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('orion-history-open');

    return window.matchMedia('(min-width: 1280px)').matches && stored !== null ? stored === 'true' : false;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const tourLayoutRef = useRef(null);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rewindTargetIndex, setRewindTargetIndex] = useState(null);

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
    handleSignOut,
  } = useAuth();

  // --- Workspace state (the generation flow owns these) ---
  const [prompt, setPrompt] = useState('');
  // Which studio the workspace is in: 'app' or 'website'. Drives
  // prompt selection, starter ideas, preview defaults and copy; persisted
  // per-project so reopening restores it. Starts null: a fresh session must
  // pick a studio first (StudioChoice gate) -- a project resume or an
  // adopted pending job fills it before the gate can show. Once picked, the
  // choice is never re-litigated inside the header; the other studio is only
  // ever reached through "New", which asks again.
  const [studioMode, setStudioMode] = useState(null);
  const studioModeRef = useRef(null);
  studioModeRef.current = studioMode;
  // Website studio's click-to-edit picker state. `selectedElement` is the
  // bridge's element-selected payload; `selectionKey` remounts the editor on
  // every new selection so its local form state resets.
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [elementEditError, setElementEditError] = useState(null);
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
  // Every version stores `files` (page filename -> HTML); `index.html` is the
  // landing page. `generatedCode` is the landing page's HTML, which the
  // generation and deploy paths still treat as "the app"; `activeCode` is
  // whichever page the preview/code pane is showing.
  const [files, setFiles] = useState({});
  const [activePage, setActivePage] = useState(LANDING_PAGE);
  const generatedCode = getLanding(files);
  const activeCode = files[activePage] ?? generatedCode;
  // Read by long-lived callbacks (reload settlement, runtime-error auto-fix).
  const filesRef = useRef(files);
  const activePageRef = useRef(activePage);
  useEffect(() => {
    filesRef.current = files;
    activePageRef.current = activePage;
  });
  const clearFiles = useCallback(() => {
    setFiles({});
    setActivePage(LANDING_PAGE);
  }, []);
  const [chatMode, setChatMode] = useState(loadChatMode); // 'build' or 'ask'
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
    () => (firebaseEnabled ? true : Boolean(localStorage.getItem('orion-current-project-id')))
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
  // Full text of the code as the model writes it. A ref, not state: the build
  // overlay's live peek polls it on animation frames and paces the reveal itself.
  const liveCodeRef = useRef('');
  // Which page the live code peek is writing: { page, step?, total? } or null.
  const [liveCodePage, setLiveCodePage] = useState(null);
  // Body of a page being created (not in `files` yet), for the code view's tab.
  const [streamingPageCode, setStreamingPageCode] = useState('');
  // Pages finished during the CURRENT build ({ 'index.html': html, ... }). The
  // first build only commits `files` when the whole run ends, so without this
  // the code view could not show earlier pages as tabs while later ones write.
  const [builtPages, setBuiltPages] = useState({});
  const pageStreamRef = useRef('');
  // Tab the user picked in the code view mid-build; overrides auto-follow.
  const [codeTabOverride, setCodeTabOverride] = useState(null);
  const liveCodePageRef = useRef(null);

  // --- Naming / new-app flow ---
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');
  const [shouldGenerateAfterNaming, setShouldGenerateAfterNaming] = useState(false);
  const [isNewChatConfirmOpen, setIsNewChatConfirmOpen] = useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  // Mid-session studio pick: opened by "New" once any work has been confirmed
  // away (or when there is none). Cancelable -- unlike the forced gate.
  const [isStudioChoiceOpen, setIsStudioChoiceOpen] = useState(false);
  // Studio picked while signed out (hosted mode); entered after sign-in.
  const [pendingStudio, setPendingStudio] = useState(null);

  // --- Mobile Layout ---
  const [mobileView, setMobileView] = useState('chat'); // 'chat' | 'preview'

  const chatBottomRef = useRef(null);
  const iframeRef = useRef(null);
  const handleGenerateRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingGeneratedCodeRef = useRef('');
  const streamingReplyRef = useRef('');
  const editStreamRef = useRef('');
  const replyFrozenRef = useRef(false);
  const abortControllerRef = useRef(null);
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
    liveCodeRef.current = '';
    setLiveCodePage(null);
    liveCodePageRef.current = null;
    setStreamingPageCode('');
    setBuiltPages({});
    pageStreamRef.current = '';
    setCodeTabOverride(null);
    editStreamRef.current = '';
    streamingBufferRef.current = '';
    streamingGeneratedCodeRef.current = '';
    streamingReplyRef.current = '';
    replyFrozenRef.current = false;
  }, []);

  // --- Projects (list / persistence) ---
  const {
    myProjects, isProjectsListOpen, setIsProjectsListOpen,
    loadProject, saveProject, renameProject, deleteProject, deleteAllProjects,
  } = useProjects({
    authStatus,
    isSignedIn,
    user,
    workspace: {
      versions, currentVersionIndex, chatContextStartIndex, currentChatSessionId, projectName, currentProjectId, deployment, aiEnabled, studioMode,
      setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setDeployment, setAiEnabled, setStudioMode,
      setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt,
      setIsResumingProject, clearStreamingState,
      // Sign-out (hosted): back to the studio-choice gate with nothing loaded.
      // Lazy so it can reference resetCurrentWorkspace, defined further down.
      resetWorkspace: () => resetCurrentWorkspace(null),
    },
  });

  // Toggling generated-app AI from the prompt footer.
  const handleAiEnabledChange = useCallback((enabled) => {
    setAiEnabled(enabled);
    saveProject({ aiEnabledToSave: enabled, force: true });
  }, [saveProject]);

  // --- Deployment ---
  const currentVersionId = versions[currentVersionIndex]?.id ?? null;
  const {
    isDeployModalOpen, setIsDeployModalOpen, isDeploying, deployError, setDeployError,
    deployCopied, confirmUndeploy, setConfirmUndeploy, isDeployStale, deploymentUrl,
    openDeployModal, closeDeployModal, handleDeploy, handleUndeploy, handleCopyDeployUrl,
  } = useDeployment({
    files, isSignedIn, user, username, projectName, currentProjectId,
    currentVersionId, deployment, setDeployment, saveProject, aiEnabled,
  });

  // --- Analytics dashboard ---
  const {
    isAnalyticsOpen, openAnalytics, closeAnalytics,
    myAnalyticsApps, appsLoading: analyticsAppsLoading,
    selectedSlug: analyticsSelectedSlug, selectApp: selectAnalyticsApp,
    range: analyticsRange, changeRange: changeAnalyticsRange,
    stats: analyticsStats, statsLoading: analyticsStatsLoading, error: analyticsError,
    activeVisitors: analyticsActiveVisitors,
  } = useAnalytics({ isSignedIn, user });

  // --- Preview viewport (mode / orientation / zoom) ---
  const {
    containerRef: previewContainerRef,
    previewMode, setPreviewMode, previewOrientation, handleToggleOrientation,
    orientationFlipClass, setOrientationFlipClass, zoomLevel, fillSize, isAutoZoom,
    handleManualZoom, resetZoom,
  } = usePreviewViewport({ activeTab, isHistoryOpen, fillDesktop: studioMode === 'website' });

  // Website workspaces live on the desktop preset (a site's primary
  // viewport); the user can still switch devices per-preview. Re-fires when
  // a project loads so opening a website project reasserts it. App studios
  // offer no desktop preset (apps are touch-device mockups), so a desktop
  // choice persisted from a website workspace snaps back to mobile.
  useEffect(() => {
    if (studioMode === 'website') {
      setPreviewMode('desktop');
    } else if (studioMode === 'app') {
      setPreviewMode((mode) => (mode === 'desktop' ? 'mobile' : mode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, currentProjectId]);

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
      const syntax = checkSyntaxFiles(filesRef.current);
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

  const scrollToHashRef = useRef(null);
  const pageNavRef = useRef(null);
  const handlePreviewReady = useCallback(() => {
    const hash = pageNavRef.current?.pendingHashRef.current;
    if (hash) {
      pageNavRef.current.pendingHashRef.current = '';
      scrollToHashRef.current?.(hash);
    }
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
    const errorPage = activePageRef.current;
    const promptText = `Fix this runtime error${errorPage !== LANDING_PAGE ? ` on the page ${errorPage} (pass file: "${errorPage}" when editing it)` : ''}:\n${errorDetails}${payload?.line ? ` at line ${payload.line}` : ''}`;
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
      activeCode
        ? injectPreviewBridge(
            // The AI shim is always present in the preview so flipping the AI
            // reel stop never recomputes srcDoc (which would reload the frame
            // and lose app state). Hosted requests are gated live in
            // usePreviewBridge; export/deploy paths still honor aiEnabled.
            !firebaseEnabled
              ? injectSelfHostedAiBridge(activeCode, { mode: generatedAiMode, relayUrl: generatedAiRelayUrl })
              : activeCode,
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
            aiEnabled: firebaseEnabled,
          })
        : { srcDoc: '', token: '' },
    // previewReloadCount is intentionally "unused": bumping it re-runs the
    // injection so a fresh token forces the iframe to navigate (reload).
    // previewMode is intentionally read without being a dependency: a device
    // switch must NOT recompute srcDoc (that would reload the frame). It only
    // matters when a new document is produced, and every recompute picks up
    // the mode current at that moment; later mode switches are delivered to
    // the already-loaded frame via usePreviewBridge's configure push.
    // aiEnabled is likewise intentionally not a dependency (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCode, previewReloadCount, projectStorageVersion]
  );

  // Website studio: the picker is armed only while editing is toggled on in a
  // website workspace. Selections/deselections arrive from the frame; the
  // imperative senders walk or clear the frame's current selection.
  const handleElementSelected = useCallback((payload) => {
    setSelectedElement(payload);
    setElementEditError(null);
    setSelectionKey((n) => n + 1);
  }, []);

  const handleElementDeselected = useCallback(() => {
    setSelectedElement(null);
    setElementEditError(null);
  }, []);

  const isPreviewEditing = studioMode === 'website' && isEditMode;

  const pageNav = usePageNavigation({ files, activePage, setActivePage });
  pageNavRef.current = pageNav;

  const {
    requestScreenshot, selectParentElement, deselectElement,
    navState: frameNavState, goBack: frameGoBack, goForward: frameGoForward, scrollToHash,
  } = usePreviewBridge({
    iframeRef,
    previewSrcDoc,
    previewToken,
    previewMode,
    onRuntimeError: handleRuntimeError,
    onReady: handlePreviewReady,
    onStorageChange: handleStorageChange,
    aiEnabled: firebaseEnabled && aiEnabled,
    editingEnabled: isPreviewEditing,
    onElementSelected: handleElementSelected,
    onElementDeselected: handleElementDeselected,
    onNavigatePage: pageNav.navigateToHref,
  });
  scrollToHashRef.current = scrollToHash;

  // Back/forward walk the frame's own history (hash jumps) first, then pages.
  const navState = {
    canGoBack: frameNavState.canGoBack || pageNav.canPageBack,
    canGoForward: frameNavState.canGoForward || pageNav.canPageForward,
  };
  const goBack = frameNavState.canGoBack ? frameGoBack : pageNav.pageBack;
  const goForward = frameNavState.canGoForward ? frameGoForward : pageNav.pageForward;

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((on) => !on);
    setSelectedElement(null);
    setElementEditError(null);
  }, []);

  const handleCancelElementSelection = useCallback(() => {
    deselectElement();
    setSelectedElement(null);
    setElementEditError(null);
  }, [deselectElement]);

  const handleSelectParentElement = useCallback(() => {
    selectParentElement();
  }, [selectParentElement]);

  // Deterministic click-to-edit: apply the change straight to `generatedCode`
  // (see lib/directEdits.js) and push the result as a normal version, so
  // undo/redo, history and project persistence all work unchanged. When the
  // anchor can't be matched unambiguously the edit falls back to the chat.
  const handleApplyElementEdit = useCallback((changes) => {
    if (!selectedElement || !activeCode) return;
    const result = applyDirectEdit(activeCode, selectedElement, changes);
    if (!result.ok) {
      setElementEditError('Could not apply this edit directly (the element could not be matched uniquely in the source). Try "Edit with AI" below.');
      return;
    }
    setElementEditError(null);
    const updatedVersions = versions.slice(0, currentVersionIndex + 1);
    const newVersion = {
      id: Date.now(),
      prompt: result.summary,
      files: { ...files, [activePage]: result.code },
      timestamp: new Date().toLocaleTimeString(),
      editMode: 'surgical',
      editSummary: result.summary,
      reply: null,
      chatMode: 'build',
      sessionId: currentChatSessionId,
    };
    const finalVersions = [...updatedVersions, newVersion];
    setFiles(newVersion.files);
    setVersions(finalVersions);
    setCurrentVersionIndex(updatedVersions.length);
    setSelectedElement(null);
    saveProject({
      versionsToSave: finalVersions,
      indexToSave: updatedVersions.length,
    });
  }, [selectedElement, activeCode, activePage, files, versions, currentVersionIndex, currentChatSessionId, saveProject]);

  const handleElementEditWithAI = useCallback((instruction) => {
    if (!selectedElement) return;
    const prefill = buildElementEditPrompt(selectedElement, instruction);
    setPrompt((current) => (current.trim() ? `${current}\n${prefill}` : prefill));
    setSelectedElement(null);
    setElementEditError(null);
    setMobileView('chat');
  }, [selectedElement]);

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

  // Code view tabs: one per page. While building, the tab follows the page the
  // model is writing (unless the user picked one), and a page that is still
  // being created gets a tab before it exists in `files`.
  const writingPage = isGenerating && studioMode === 'website' ? (liveCodePage?.page ?? null) : null;
  const codeTabs = (() => {
    if (!isGenerating || studioMode !== 'website') return pageNames(files);
    const all = { ...builtPages, ...files };
    if (writingPage && !(writingPage in all)) all[writingPage] = '';
    // The landing page is always first, even while it is the one streaming in.
    if (writingPage === LANDING_PAGE || Object.keys(all).length > 0) all[LANDING_PAGE] ??= '';
    return pageNames(all);
  })();
  const codeViewPage = isGenerating
    ? (codeTabOverride && codeTabs.includes(codeTabOverride) ? codeTabOverride : (autoFollowCode && writingPage) || activePage)
    : activePage;
  const codePanelCode = isGenerating
    ? ((codeViewPage === writingPage && (codeViewPage === LANDING_PAGE ? streamingGeneratedCode : streamingPageCode))
      || files[codeViewPage] || builtPages[codeViewPage]
      || (codeViewPage === LANDING_PAGE ? streamingGeneratedCode : '') || '')
    : activeCode;
  const handleSelectCodePage = (page) => {
    // Mid-build this only changes what the code view shows; otherwise it is
    // the same page switch as the preview's tabs.
    if (isGenerating) setCodeTabOverride(page);
    else pageNav.goToPage(page);
  };
  // The chat view is active only when it has something to show. A bare
  // `hasSentFirstPrompt` / `versions.length > 0` is not enough: a cancelled or
  // failed first turn (common in Ask mode, which never produces code), or a
  // "New chat" cutoff past the last version, leaves an empty transcript, and
  // hiding the intro + starter ideas then strands the user on a blank pane.
  const hasVisibleTranscript = versions.length > 0 && currentVersionIndex >= chatContextStartIndex;
  const isChatActive = hasVisibleTranscript || Boolean(generatedCode) || Boolean(pendingPrompt) || isResumingProject || (hasSentFirstPrompt && isGenerating);
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
    localStorage.setItem(AUTO_FOLLOW_CODE_KEY, autoFollowCode);
  }, [autoFollowCode]);

  useEffect(() => {
    localStorage.setItem(LIVE_CODE_PREVIEW_KEY, liveCodePreview);
  }, [liveCodePreview]);

  useEffect(() => {
    localStorage.setItem(BUILD_PANE_SIDE_KEY, buildPaneSide);
  }, [buildPaneSide]);

  useEffect(() => {
    localStorage.setItem(SKIP_SPLASH_KEY, skipSplash);
  }, [skipSplash]);

  useEffect(() => {
    saveChatMode(chatMode);
  }, [chatMode]);

  useEffect(() => {
    localStorage.setItem(REASONING_EFFORT_KEY, reasoningEffort);
  }, [reasoningEffort]);

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
    const resumedId = firebaseEnabled
      ? currentProjectId
      : localStorage.getItem('orion-current-project-id') || null;
    const jobBelongsHere =
      (job.projectId ?? null) === (resumedId ?? null);
    if (jobBelongsHere) {
      setInterruptedJob(job);
      // A pending build pins its studio: reopen straight into the workspace
      // the build started in (its retry banner lives there) instead of
      // stopping at the studio-choice gate.
      if (!studioModeRef.current) {
        setStudioMode(job.studioMode === 'website' ? 'website' : 'app');
      }
    }
    // If the job belongs to a different project, leave the record intact but
    // don't surface it — the user can encounter it by opening that project.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per resume; currentProjectId is already settled then
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
    // project that may never contain generated code. This deliberately does
    // not check currentProjectId: an earlier Ask turn auto-saves the chat as a
    // project under the untitled name, and the first Build prompt must still
    // name it (handleConfirmNaming then renames that project in place).
    const untitledName = STUDIO_MODES[studioMode]?.untitledName || 'Untitled App';
    if (chatMode !== 'ask' && (projectName === untitledName || !projectName.trim())) {
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
    // The preview reloads for the new code; any live picker selection is
    // stale by then.
    setSelectedElement(null);
    setElementEditError(null);
    // Persist the in-flight job so a page close/reload can offer to resume it.
    setInterruptedJob(null);
    savePendingJob({
      projectId: currentProjectId,
      prompt: currentPrompt,
      chatMode,
      studioMode,
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
        if (kind === 'live_page') {
          try {
            const next = JSON.parse(chunk);
            // The stream reports the page name alone; keep the step/total the
            // page-creation pass announced for the same page.
            if (next?.page) {
              // A new page starts a fresh text stream.
              if (liveCodePageRef.current?.page !== next.page) {
                pageStreamRef.current = '';
                setStreamingPageCode('');
              }
              const merged = { ...(liveCodePageRef.current?.page === next.page ? liveCodePageRef.current : null), ...next };
              liveCodePageRef.current = merged;
              setLiveCodePage(merged);
            }
          } catch { /* malformed marker: ignore */ }
          return;
        }
        if (kind === 'live_page_done') {
          try {
            const done = JSON.parse(chunk);
            if (done?.page && typeof done.html === 'string') setBuiltPages((prev) => ({ ...prev, [done.page]: done.html }));
          } catch { /* malformed marker: ignore */ }
          return;
        }
        if (kind === 'page_stream_reset') {
          pageStreamRef.current = '';
          liveCodeRef.current = '';
          setStreamingPageCode('');
          return;
        }
        if (kind === 'page_stream') {
          // Plain streamed text for an additional page (see createMissingPages):
          // same handling as the landing page's stream, but into the page-code
          // state the code view's tab for that page reads.
          pageStreamRef.current += chunk;
          const html = HTML_STREAM_START_RE.test(pageStreamRef.current) ? sanitizeHtmlResponse(pageStreamRef.current) : '';
          liveCodeRef.current = html || '';
          setStreamingPageCode(html || '');
          return;
        }
        if (kind === 'edit_stream_reset') {
          editStreamRef.current = '';
          liveCodeRef.current = '';
          setStreamingPageCode('');
          return;
        }
        if (kind === 'edit_stream') {
          editStreamRef.current = `${editStreamRef.current}${chunk}`;
          liveCodeRef.current = extractStreamedEditCode(editStreamRef.current);
          // A page that doesn't exist yet has no code to show except what is
          // streaming in, so the code view's tab for it needs it as state.
          const writing = liveCodePageRef.current?.page;
          if (writing && !(writing in filesRef.current)) setStreamingPageCode(liveCodeRef.current);
          return;
        }
        if (chatMode === 'ask') {
          // Ask replies are plain prose/markdown and never app code, so stream
          // every delta straight into the reply. Running the HTML-boundary
          // logic below would freeze the reply at the first ```html snippet.
          streamingReplyRef.current = `${streamingReplyRef.current}${chunk}`;
          setStreamingReply(streamingReplyRef.current);
          return;
        }
        streamingGeneratedCodeRef.current = `${streamingGeneratedCodeRef.current}${chunk}`;
        if (HTML_STREAM_START_RE.test(streamingGeneratedCodeRef.current)) {
          const sanitized = sanitizeHtmlResponse(streamingGeneratedCodeRef.current);
          setStreamingGeneratedCode(sanitized);
          liveCodeRef.current = sanitized;
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
      }, 'both', abortControllerRef.current.signal, chatMode === 'ask', shouldAskClarifyingQuestions, attachmentForRequest, aiEnabled, generatedAiMode, isAutoFix, reasoningEffort, studioMode, files);
      isEvaluatingNewCodeRef.current = true;
      const newFiles = generationResult.files ?? { ...files, [LANDING_PAGE]: generationResult.code };
      setFiles(newFiles);
      if (!(activePage in newFiles)) setActivePage(LANDING_PAGE);

      const newVersion = {
        id: Date.now(),
        prompt: currentPrompt,
        files: newFiles,
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
      const syntaxCheck = checkSyntaxFiles(newFiles);
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

  // Pages as they leave the app (new tab / export): the self-hosted AI bridge is
  // added per page here, never stored in `files`.
  const buildOutputFiles = () => (!firebaseEnabled && aiEnabled
    ? mapPages(files, (html) => injectSelfHostedAiBridge(html, { mode: generatedAiMode, relayUrl: generatedAiRelayUrl }))
    : files);

  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const outputFiles = buildOutputFiles();
    // Sibling pages have nothing to resolve against from a blob: URL, so a
    // multi-page site opens as one document that routes between its pages.
    const outputHtml = Object.keys(outputFiles).length > 1
      ? buildSiteShell(outputFiles, projectName)
      : getLanding(outputFiles);
    const blob = new Blob([outputHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Hands the user the raw HTML file -- or, for a multi-page site, a .zip with
  // one file per page (links like about.html keep working when unzipped).
  // Self-hosted mode's stand-in for Deploy (no public-URL hosting without
  // Firebase Storage); in hosted mode it sits alongside Deploy.
  const handleExportHtml = () => {
    if (!generatedCode) return;
    const outputFiles = buildOutputFiles();
    const baseName = slugifyName(projectName) || 'app';
    const names = pageNames(outputFiles);
    const blob = names.length > 1
      ? createZip(names.map((name) => ({ name, data: outputFiles[name] })))
      : new Blob([getLanding(outputFiles)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = names.length > 1 ? `${baseName}.zip` : `${baseName}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleNewApp = () => {
    if (generatedCode || versions.length > 0 || isGenerating || hasSentFirstPrompt) {
      setIsNewChatConfirmOpen(true);
    } else {
      // Nothing to lose -- go straight to the studio pick.
      setIsStudioChoiceOpen(true);
    }
  };

  const handleConfirmNewChat = () => {
    setIsNewChatConfirmOpen(false);
    // The workspace is left untouched until a studio is chosen, so "Go back"
    // on the choice screen cancels cleanly.
    setIsStudioChoiceOpen(true);
  };

  const handleConfirmExit = () => {
    setIsExitConfirmOpen(false);
    // Same as "New": the workspace stays untouched until a studio is chosen,
    // so "Go back" on the picker returns to it.
    setIsStudioChoiceOpen(true);
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

    // Naming an untitled project that already exists (created by earlier Ask
    // turns) renames it in place: keep its conversation and id.
    const isRenamingUntitledProject = shouldGenerateAfterNaming && Boolean(currentProjectId);
    if (isRenamingUntitledProject) {
      setProjectName(trimmedName);
      setTempProjectName('');
      setIsNamingModalOpen(false);
      return;
    }

    // If we are confirming a name for a new project triggered by a prompt,
    // or if we explicitly clicked "New App", clear the workspace.
    if (!shouldGenerateAfterNaming || (!currentProjectId && (projectName === 'Untitled App' || projectName === 'Untitled Website'))) {
      clearFiles();
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
        const restored = versionFiles(versions[index]);
        setFiles(restored);
        if (!(activePage in restored)) setActivePage(LANDING_PAGE);
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

  const handleConfirmRewind = () => {
    const target = rewindTargetIndex;
    setRewindTargetIndex(null);
    if (target !== null && !isGenerating) switchVersion(target);
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

  // Accelerators for chrome that is already on screen; the bindings and the
  // hints printed in each control's tooltip share one source (lib/shortcuts).
  useKeyboardShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onOpenApps: () => setIsProjectsListOpen(true),
    onOpenHelp: () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer'),
    isBusy: isGenerating,
  });

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
    const jobStudioMode = interruptedJob.studioMode === 'website' ? 'website' : 'app';
    setInterruptedJob(null);
    clearPendingJob();
    setChatMode(jobChatMode);
    setStudioMode(jobStudioMode);
    setPrompt(jobPrompt);
    // Use setTimeout so state setters flush before handleGenerate reads them.
    setTimeout(() => handleGenerateRef.current?.(null, jobPrompt), 0);
  }, [interruptedJob]);

  const handleDismissInterruptedJob = useCallback(() => {
    setInterruptedJob(null);
    clearPendingJob();
  }, []);

  const resetCurrentWorkspace = (nextStudioMode = studioModeRef.current) => {
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
    clearFiles();
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
    setIsEditMode(false);
    setSelectedElement(null);
    setElementEditError(null);
    setStudioMode(nextStudioMode);
    setProjectName(STUDIO_MODES[nextStudioMode]?.untitledName || 'Untitled App');
    if (nextStudioMode !== studioModeRef.current) {
      setPreviewMode(STUDIO_MODES[nextStudioMode]?.defaultPreviewMode || 'mobile');
    }
    localStorage.removeItem('orion-current-project-id');
    clearPreviewStorage(null);
    previewStorageRef.current = {};
    setInterruptedJob(null);
    clearPendingJob();
  };

  // The studio-choice screen. Forced on a fresh session (gate), or opened by
  // "New" once work was confirmed away. Picking seeds the untitled name and
  // the studio's default preview device.
  const handleChooseStudio = (mode) => {
    if (!STUDIO_MODES[mode]) return;
    // Hosted mode: a studio can't be entered signed out. Remember the pick,
    // open the sign-in modal, and the effect below resumes it once a session
    // lands. (Self-hosted is always signed in, so this never triggers there.)
    if (firebaseEnabled && !isSignedIn) {
      setPendingStudio(mode);
      setIsAuthModalOpen(true);
      return;
    }
    resetCurrentWorkspace(mode);
    setIsStudioChoiceOpen(false);
  };

  useEffect(() => {
    if (!pendingStudio || !isSignedIn) return;
    setPendingStudio(null);
    handleChooseStudio(pendingStudio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStudio, isSignedIn]);

  const handleCloseAuthModal = () => {
    setIsAuthModalOpen(false);
    setPendingStudio(null);
  };

  const handleCancelStudioChoice = () => {
    setIsStudioChoiceOpen(false);
  };

  // Opening a previous build straight from the choice screen: the project
  // carries its own studio, so loading one dismisses the choice.
  const handleLoadProjectFromChoice = (project) => {
    setIsStudioChoiceOpen(false);
    loadProject(project);
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

  const handleDeleteAllProjects = async () => {
    const ok = await deleteAllProjects();
    // The open project is gone too (or is being removed); clear the workspace.
    if (currentProjectId) resetCurrentWorkspace();
    clearPendingJob();
    return ok;
  };

  // Hosted only. Re-verify first (deleteUser rejects stale sign-ins, and by then
  // the data would already be gone), then wipe projects + deployments, the
  // profile doc, and finally the auth account itself. Throws with a
  // user-facing message so the Settings dialog can show it.
  const handleDeleteAccount = async ({ password } = {}) => {
    if (!firebaseEnabled || !user?.id) return;
    await authProvider.reauthenticate({ password });
    const ok = await handleDeleteAllProjects();
    if (!ok) throw new Error('Some of your apps could not be deleted, so your account was kept. Please try again.');
    await sweepUserDeployments(user.id);
    await deleteUserProfile(user.id);
    await authProvider.deleteAccount();
    setIsSettingsOpen(false);
  };

  const handleRequireSignInFromDeploy = () => {
    setIsDeployModalOpen(false);
    setIsAuthModalOpen(true);
  };

  const startTour = () => {
    tourLayoutRef.current = { mobileView, activeTab };
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

  // Fresh session with nothing to resume and no studio picked: the whole
  // workspace stays behind the studio choice. A project resume (or adopted
  // pending job) sets studioMode before the resume flag clears, so returning
  // users never see the gate. Mid-session, the same screen opens over "New".
  const showStudioChoice = isStudioChoiceOpen || (!isResumingProject && studioMode === null);
  if (showStudioChoice) {
    return (
      <div className="app-shell fixed inset-0 overflow-hidden bg-slate-50 flex flex-col font-sans">
        <SplashScreen skip={skipSplash} />
        <StudioChoice
          onSelectStudio={handleChooseStudio}
          onCancel={isStudioChoiceOpen && !isProjectsListOpen ? handleCancelStudioChoice : null}
          savedAppsCount={myProjects.length}
          onOpenProjects={() => setIsProjectsListOpen(true)}
          requireSignIn={firebaseEnabled}
          isSignedIn={isSignedIn}
          onSignIn={() => setIsAuthModalOpen(true)}
          onSignOut={handleSignOut}
        />
        {isAuthModalOpen && firebaseEnabled && (
          <AuthModal onClose={handleCloseAuthModal} />
        )}
        {isProjectsListOpen && (
          <ProjectsListModal
            projects={myProjects}
            currentProjectId={currentProjectId}
            onClose={() => setIsProjectsListOpen(false)}
            onLoadProject={handleLoadProjectFromChoice}
            onRenameProject={renameProject}
            onDeleteProject={handleDeleteProject}
          />
        )}
      </div>
    );
  }

  return (
    <div className="app-shell fixed inset-0 overflow-hidden bg-slate-50 flex flex-col font-sans">
      <SplashScreen skip={skipSplash} />
      <Header
        projectName={projectName}
        onNewApp={handleNewApp}
        onExit={() => setIsExitConfirmOpen(true)}
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
        firebaseEnabled={firebaseEnabled}
        onOpenAnalytics={() => openAnalytics()}
        studioMode={studioMode}
      />

      {/* Mobile Tab Toggle Bar (Sub-header) */}
      <div className="mobile-view-switch lg:hidden shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 px-4 py-2 flex justify-center z-30">
        <div className="nav-segmented-group nav-segmented-compact w-full max-w-65" role="group" aria-label="Workspace view">
          <button
            onClick={() => setMobileView('chat')}
            aria-pressed={mobileView === 'chat'}
            className={`nav-segmented-btn flex-1 py-1.5 text-xs uppercase tracking-wider font-bold ${mobileView === 'chat' ? 'nav-segmented-btn-active' : ''}`}
          >
            Chat
          </button>
          <button
            onClick={() => setMobileView('preview')}
            aria-pressed={mobileView === 'preview'}
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
          autoFollowCode={autoFollowCode}
          onAutoFollowCodeChange={setAutoFollowCode}
          liveCodePreview={liveCodePreview}
          onLiveCodePreviewChange={setLiveCodePreview}
          buildPaneSide={buildPaneSide}
          onBuildPaneSideChange={setBuildPaneSide}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          onDeleteAllProjects={handleDeleteAllProjects}
          projectCount={myProjects.length}
          onDeleteAccount={firebaseEnabled && isSignedIn ? handleDeleteAccount : null}
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

      {isExitConfirmOpen && (
        <ConfirmModal
          title="Exit to the studio picker?"
          subtitle="You'll choose between building an app or a website."
          onClose={() => setIsExitConfirmOpen(false)}
          onConfirm={handleConfirmExit}
          confirmLabel="Exit"
          confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
        >
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              Your current work stays as it is until you pick a studio. Choose &ldquo;Go back&rdquo; on the next screen to return to it, or pick a studio to start something new.
            </span>
          </div>
        </ConfirmModal>
      )}

      {isNewChatConfirmOpen && (
        <ConfirmModal
          title="Start something new?"
          subtitle="This will clear your current workspace."
          onClose={() => setIsNewChatConfirmOpen(false)}
          onConfirm={handleConfirmNewChat}
          confirmLabel="Continue"
          confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
        >
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              You have unsaved changes. Starting something new will discard your current work including any generated code and version history. You&apos;ll pick the studio on the next screen.
            </span>
          </div>
        </ConfirmModal>
      )}

      {rewindTargetIndex !== null && versions[rewindTargetIndex] && (
        <ConfirmModal
          title="Rewind project?"
          subtitle={`Return to version ${rewindTargetIndex + 1} of ${versions.length}.`}
          onClose={() => setRewindTargetIndex(null)}
          onConfirm={handleConfirmRewind}
          confirmLabel="Rewind"
          confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
        >
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              The project will go back to how it was after &ldquo;{versions[rewindTargetIndex].prompt}&rdquo;. Later messages are hidden from the chat but stay in version history until you send a new prompt, which replaces them.
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
          studioMode={studioMode}
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
          activeVisitors={analyticsActiveVisitors}
          onClose={closeAnalytics}
        />
      )}

      {isNamingModalOpen && (
        <NamingModal
          name={tempProjectName}
          onNameChange={setTempProjectName}
          onConfirm={handleConfirmNaming}
          onCancel={handleCancelNaming}
          studioMode={studioMode}
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

      <AuthToast kind={authToast} onDismiss={dismissAuthToast} />

      {isAuthModalOpen && firebaseEnabled && (
        <AuthModal onClose={handleCloseAuthModal} />
      )}

      <div className="workspace flex flex-1 min-w-0 min-h-0 overflow-hidden relative">
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
        <main className="flex-1 min-w-0 min-h-0 flex overflow-hidden relative">

          {/* Prompt/Chat Sidebar (left by default, right via Settings) - Build Panel */}
          <div
            className={`${mobileView === 'chat' ? 'flex' : 'hidden'} lg:flex h-full w-full lg:w-[clamp(320px,35vw,420px)] flex-1 lg:flex-none min-w-0 min-h-0 relative ${buildPaneSide === 'right' ? 'build-pane-right lg:order-2' : ''}`}
          >
            <BuildPanel
              isChatActive={isChatActive}
              isResumingProject={isResumingProject}
              chatMode={chatMode}
              studioMode={studioMode}
              aiEnabled={aiEnabled}
              onAiEnabledChange={handleAiEnabledChange}
              onChatModeChange={setChatMode}
              onRewind={setRewindTargetIndex}
              generatedCode={generatedCode}
              showStarterIdeas={showStarterIdeas}
              starterIdeas={
                chatMode === 'ask'
                  ? ASK_STARTER_PRESETS
                  : studioMode === 'website'
                    ? WEBSITE_STARTER_PRESETS
                    : STARTER_PRESETS
              }
              starterSampleSize={chatMode !== 'ask' && studioMode === 'website' ? 4 : undefined}
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

          {/* Preview/Device Area (opposite side) */}
          <div data-tour="preview" className={`${mobileView === 'preview' ? 'flex' : 'hidden'} lg:flex h-full w-full flex-1 min-w-0 min-h-0`}>
            <PreviewPane
              projectName={projectName}
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
              fillSize={fillSize}
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
              pages={pageNames(files)}
              codePages={codeTabs}
              codeActivePage={codeViewPage}
              codeWritingPage={writingPage}
              onSelectCodePage={handleSelectCodePage}
              activePage={activePage}
              onSelectPage={pageNav.goToPage}
              navState={navState}
              onNavBack={goBack}
              onNavForward={goForward}
              isGenerating={isGenerating && chatMode === 'build'}
              generationStatus={generationStatus}
              liveCodeRef={liveCodePreview ? liveCodeRef : null}
              liveCodePage={studioMode === 'website' ? liveCodePage : null}
              isAutoFixing={isAutoFixing}
              autoFixMessage={autoFixMessage}
              onCancelGeneration={handleCancelGeneration}
              code={codePanelCode}
              copied={copied}
              onCopyCode={handleCopyCode}
              autoFollowCode={autoFollowCode}
              studioMode={studioMode}
              isEditMode={isEditMode}
              onToggleEditMode={handleToggleEditMode}
              selectedElement={selectedElement}
              selectionKey={selectionKey}
              elementEditError={elementEditError}
              onApplyElementEdit={handleApplyElementEdit}
              onElementEditWithAI={handleElementEditWithAI}
              onCancelElementSelection={handleCancelElementSelection}
              onSelectParentElement={handleSelectParentElement}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
