import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { injectPreviewBridge } from './previewBridge';
import { firebaseEnabled } from './firebase';
import { isDesktop, desktopBridge } from './lib/desktop';

import Header from './components/Header';
import HistorySidebar from './components/HistorySidebar';
import BuildPanel from './components/BuildPanel';
import PreviewPane from './components/PreviewPane';
import SettingsModal from './components/SettingsModal';
import GuidedTour, { TourInvitation } from './components/GuidedTour';
import HeroLanding from './components/HeroLanding';
import ProjectsListModal from './components/ProjectsListModal';
import DeployModal from './components/DeployModal';
import AnalyticsDashboardModal from './components/AnalyticsDashboardModal';
import NamingModal from './components/NamingModal';
import AuthModal from './components/AuthModal';
import AuthToast from './components/AuthToast';
import ConfirmModal from './components/ConfirmModal';

import SplashScreen from './components/SplashScreen';
import StudioChoice from './components/StudioChoice';
import ShowcaseView from './components/showcase/ShowcaseView';
import DesktopStorageNotice from './components/DesktopStorageNotice';
import UpdateNotice from './components/UpdateNotice';
import { TriangleAlert, Loader2, LogOut } from 'lucide-react';

import { generateAppCode } from './lib/llm';
import { compressImageDataUrl } from './lib/attachments';
import { slugifyName } from './lib/deploy';
import authProvider from './lib/auth';
import { savePendingJob, clearPendingJob, loadPendingJob } from './lib/pendingJob';
import { applyDirectEdit, buildElementEditPrompt, describeDirectEditFailure } from './lib/directEdits';
import {
  loadPreviewStorage,
  savePreviewStorage,
  clearPreviewStorage,
  applyStorageChange,
} from './lib/previewStorage';
import { sanitizeHtmlResponse, extractLeadingReply } from './lib/edits';
import { extractStreamedEditCode } from './lib/helpers';
import { LANDING_PAGE, collectLinkTargets, getLanding, mapPages, pageNames, versionFiles } from './lib/pages';
import { formatSyntaxErrors } from './lib/syntaxCheck';
import { checkSyntaxFiles } from './lib/pageTools';
import {
  newChatSessionId, groupVersionsByChatSession, getChatSessionStartIndex
} from './lib/chatSessions';
import {
  STARTER_PRESETS, ASK_STARTER_PRESETS, WEBSITE_STARTER_PRESETS, GAME_STARTER_PRESETS, STARTER_SAMPLE_SIZE, HTML_STREAM_START_RE, PREVIEW_MODES, STUDIO_MODES, DOCS_URL
} from './lib/constants';
import { loadShowCodeView, SHOW_CODE_VIEW_KEY, loadAskClarifyingQuestions, ASK_CLARIFYING_QUESTIONS_KEY, loadSkipSplash, SKIP_SPLASH_KEY, isSplashDue, loadAutoFollowCode, AUTO_FOLLOW_CODE_KEY, loadLiveCodePreview, LIVE_CODE_PREVIEW_KEY, loadReasoningEffort, BUILD_REASONING_EFFORT_KEY, loadChatMode, saveChatMode, loadBuildPaneSide, BUILD_PANE_SIDE_KEY, markStartFresh, clearStartFresh, isStartFresh, activeUserProvider, markPlansPrompted, wasPlansPrompted } from './lib/config';

import useTheme from './hooks/useTheme';
import useVisualViewport from './hooks/useVisualViewport';
import useChatFont from './hooks/useChatFont';
import useAuth from './hooks/useAuth';
import useBilling from './hooks/useBilling';
import PlansModal from './components/PlansModal';
import { PLANS } from '../functions/_lib/plans.js';
import useProjects from './hooks/useProjects';
import useDeployment from './hooks/useDeployment';
import useShowcaseRoute from './hooks/useShowcaseRoute';
import { fetchRemixSource, showcaseProjects } from './lib/showcase';
import useAnalytics from './hooks/useAnalytics';
import usePreviewViewport from './hooks/usePreviewViewport';
import usePreviewBridge from './hooks/usePreviewBridge';
import usePageNavigation from './hooks/usePageNavigation';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
import { buildNewTabShell } from './lib/newTabShell';
import { createZip } from './lib/zip';
import { injectLoopProtection } from './lib/loopProtection';
import { maintenanceMode, MAINTENANCE_MESSAGE } from './lib/maintenance';

// App owns the workspace/generation state (prompt, versions, streaming) and
// composes everything else from hooks (src/hooks) and components
// (src/components). See CLAUDE.md for the module map.

// Shown on the plans screen when someone on Free tries to attach an image.
const IMAGES_LOCKED_REASON = 'Image attachments are part of Plus and Pro.';

export default function App() {
  useVisualViewport();
  // --- Layout / chrome state ---
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'code'
  const [showCodeView, setShowCodeView] = useState(loadShowCodeView);
  const [askClarifyingQuestions, setAskClarifyingQuestions] = useState(loadAskClarifyingQuestions);
  const [skipSplash, setSkipSplash] = useState(loadSkipSplash);
  // Read once per page load: SplashScreen stamps the time as soon as it shows,
  // so re-reading would hide it mid-play.
  const [splashDue] = useState(isSplashDue);
  const [autoFollowCode, setAutoFollowCode] = useState(loadAutoFollowCode);
  const [liveCodePreview, setLiveCodePreview] = useState(loadLiveCodePreview);
  const [buildPaneSide, setBuildPaneSide] = useState(loadBuildPaneSide);
  const [buildReasoningEffort, setBuildReasoningEffort] = useState(() => loadReasoningEffort());
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('orion-history-open');

    return window.matchMedia('(min-width: 1280px)').matches && stored !== null ? stored === 'true' : false;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);
  // Desktop first run: nothing can be built until an AI provider is set, so
  // open Settings → AI when neither it nor environment variables provide one.
  useEffect(() => {
    if (!isDesktop) return undefined;
    let cancelled = false;
    desktopBridge.provider.get().then((info) => {
      const ready = info.envConfigured || (info.enabled && info.id && info.model && info.hasKey);
      if (cancelled || ready) return;
      setSettingsInitialTab('ai');
      setIsSettingsOpen(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const tourLayoutRef = useRef(null);

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

  // --- Billing (only on instances that bill; see functions/_lib/billing.js) ---
  const billing = useBilling({ isSignedIn });
  // { reason } when the plans screen is open; reason says why it opened. It
  // also opens on its own when Stripe Checkout sends the user back.
  const [plansModal, setPlansModal] = useState(null);
  // No trial or subscription: the hosted AI is off until one starts. The
  // user's own provider key (Settings → AI) isn't billed, so it still works.
  const needsPlan = billing.billingOn && billing.plan === 'none' && !activeUserProvider();
  const imagesLocked = billing.billingOn && !PLANS[billing.plan]?.images;

  // A new account starts with no plan: show the plans (and the free trial)
  // right after sign-up, once per account in this browser. Not when coming
  // back from Checkout, which opens the plans screen on its own.
  const newAccountId = user?.isNewAccount ? user.id : null;
  useEffect(() => {
    if (!newAccountId || !billing.billingOn || billing.plan !== 'none' || billing.checkoutResult) return;
    if (wasPlansPrompted(newAccountId)) return;
    markPlansPrompted(newAccountId);
    setPlansModal({ welcome: true });
  }, [newAccountId, billing.billingOn, billing.plan, billing.checkoutResult]);

  // --- Workspace state (the generation flow owns these) ---
  const [prompt, setPrompt] = useState('');
  // Which studio the workspace is in: 'app', 'website' or 'game'. Drives
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
  // Drag mode lives inside click-to-edit: on, dragging an element in the
  // preview moves it; off, click-to-edit never drags.
  const [isDragMode, setIsDragMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [elementEditError, setElementEditError] = useState(null);
  // Live in-place text session (bridge inline-edit-started .. -ended): the
  // element snapshot plus its current typography, for the text toolbar.
  const [textSession, setTextSession] = useState(null);
  // Pending image attachment for the next prompt -- a screenshot of the
  // preview or a manually-picked file. Ephemeral: sent with the one request
  // and never written into `versions`/localStorage/Firestore (keeps saved
  // projects small and applySurgicalEdits/history untouched). { dataUrl, name, source }
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
  // Date.now() when the model started reasoning, until its first output
  // token; null when it isn't thinking (drives the "Thinking" indicators).
  const [thinkingSince, setThinkingSince] = useState(null);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [, setAutoFixMessage] = useState(null);
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

  // --- Interrupted build job (persisted across page reloads) ---
  const [interruptedJob, setInterruptedJob] = useState(null);

  // --- Streaming state ---
  const [streamingGeneratedCode, setStreamingGeneratedCode] = useState('');
  // Reasoning is display-only build progress. It is kept separately from the
  // streamed HTML so it can appear in the small live peek without ever being
  // included in generatedCode or the large Code view.
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  // Full text of the code as the model writes it. A ref, not state: the build
  // overlay's live peek polls it on animation frames and paces the reveal itself.
  const liveCodeRef = useRef('');
  // Which page the live code peek is writing: { page, step?, total? } or null.
  const [liveCodePage, setLiveCodePage] = useState(null);
  // Whether the current live code stream has finished
  const [liveCodeStreamDone, setLiveCodeStreamDone] = useState(false);
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
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);
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
  const streamingCodeStartedRef = useRef(false);
  const thinkingEndedRef = useRef(false);
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
    setThinkingSince(null);
    setStreamingGeneratedCode('');
    setStreamingReasoning('');
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
    streamingCodeStartedRef.current = false;
    thinkingEndedRef.current = false;
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
      versions, currentVersionIndex, chatContextStartIndex, currentChatSessionId, projectName, currentProjectId, deployment, studioMode,
      setProjectName, setVersions, setCurrentVersionIndex, setChatContextStartIndex, setCurrentChatSessionId, setDeployment, setStudioMode,
      setFiles, setActivePage, setCurrentProjectId, setHasSentFirstPrompt,
      setIsResumingProject, clearStreamingState,
      // Sign-out (hosted): back to the studio-choice gate with nothing loaded.
      // Lazy so it can reference resetCurrentWorkspace, defined further down.
      resetWorkspace: () => resetCurrentWorkspace(null),
    },
  });

  // --- Deployment ---
  const currentVersionId = versions[currentVersionIndex]?.id ?? null;
  const {
    isDeployModalOpen, setIsDeployModalOpen, isDeploying, deployError, setDeployError,
    deployCopied, confirmUndeploy, setConfirmUndeploy, isDeployStale, deploymentUrl,
    openDeployModal, closeDeployModal, handleDeploy, handleUndeploy, handleCopyDeployUrl,
  } = useDeployment({
    files, isSignedIn, user, username, projectName, currentProjectId,
    currentVersionId, deployment, setDeployment, saveProject,
  });

  // --- Showcase (curated projects; `?showcase` / `?showcase=<id>` deep links) ---
  const {
    isShowcaseOpen, activeProjectId: activeShowcaseProjectId,
    openShowcase, openProject: openShowcaseProject, closeProject: closeShowcaseProject, closeShowcase,
  } = useShowcaseRoute();
  // Id of a just-remixed project awaiting its first save (see the effect
  // below handleRemixFromShowcase).
  const remixSaveRef = useRef(null);

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
    orientationFlipClass, setOrientationFlipClass, zoomLevel, fillSize, isBareFill, isAutoZoom,
    handleManualZoom, resetZoom,
  } = usePreviewViewport({ activeTab, isHistoryOpen, fillDesktop: studioMode === 'website' });

  // Website workspaces live on the desktop preset (a site's primary
  // viewport); the user can still switch devices per-preview. Re-fires when
  // a project loads so opening a website project reasserts it. App and game
  // studios offer no desktop preset (they are touch-device mockups), so a
  // desktop choice persisted from a website workspace snaps back to mobile.
  useEffect(() => {
    if (studioMode === 'website') {
      setPreviewMode('desktop');
    } else if (studioMode) {
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
    // An in-flight auto-fix is already covered by isGenerating (handleRuntimeError
    // sets both flags before calling handleGenerate). Do NOT also gate on
    // isAutoFixing here: that flag stays true for the whole settlement window and
    // is only cleared below, so checking it would reschedule this settlement
    // forever and leave the "Auto-fixing..." overlay up permanently.
    if (isGeneratingRef.current) {
      scheduleReloadSettlementRef.current?.(400);
      return;
    }
    if (chatMode !== 'build') return;

    // Check syntax one more time to ensure code integrity
    if (generatedCode) {
      const syntax = checkSyntaxFiles(filesRef.current);
      if (syntax.errors && syntax.errors.length > 0) {
        reloadStateRef.current.pending = false;
        if (syntaxErrorRetriesRef.current < 2) {
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
  const restoreScrollRef = useRef(null);
  const pageNavRef = useRef(null);
  const handlePreviewReady = useCallback(() => {
    const hash = pageNavRef.current?.pendingHashRef.current;
    if (hash) {
      pageNavRef.current.pendingHashRef.current = '';
      scrollToHashRef.current?.(hash);
    }
    // An in-place text edit reloads the frame from the edited source; put it
    // back at the offset the user was working at.
    if (pendingScrollRef.current && restoreScrollRef.current) {
      const { x, y } = pendingScrollRef.current;
      pendingScrollRef.current = null;
      restoreScrollRef.current(x, y);
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
    // The frame reports lines of the preview document, which has the bridge
    // and shims spliced in above the app's own code; translate back to the
    // source the model edits, or it hunts for line 2483 in a 400-line file.
    const sourceLine = payload?.line ? payload.line - previewLineOffsetRef.current : 0;
    const promptText = `Fix this runtime error${errorPage !== LANDING_PAGE ? ` on the page ${errorPage} (pass file: "${errorPage}" when editing it)` : ''}:\n${errorDetails}${sourceLine > 0 ? ` at line ${sourceLine}` : ''}`;
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
        ? injectPreviewBridge(activeCode, {
            initialStorage: loadPreviewStorage(currentProjectId),
            // Baked into the bridge as its initial desiredEnabled so the
            // touch-scroll simulation + scrollbar hiding are live from the
            // frame's first paint. The configure push from usePreviewBridge
            // can lose the load race on a srcdoc navigation (heaviest right
            // when a generation completes), which before this left the fresh
            // frame unconfigured -- visible scrollbar, dead touch controls --
            // until a manual reload.
            touchEnabled: PREVIEW_MODES[previewMode].isTouchChrome,
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
    [activeCode, previewReloadCount, projectStorageVersion]
  );
  // Every injection (AI shim, loop-check helper, bridge) lands right after
  // <head> and loop protection adds no newlines, so the app's lines are
  // shifted by exactly the difference in line count.
  const previewLineOffsetRef = useRef(0);
  useEffect(() => {
    previewLineOffsetRef.current = previewSrcDoc && activeCode
      ? previewSrcDoc.split('\n').length - activeCode.split('\n').length
      : 0;
  }, [previewSrcDoc, activeCode]);

  // Website studio: the picker is armed only while editing is toggled on in a
  // website workspace. Selections/deselections arrive from the frame; the
  // imperative senders walk or clear the frame's current selection.
  // `pendingScrollRef` carries the frame's scroll offset from an in-place
  // text edit commit to the next preview-ready, where it is re-sent.
  const pendingScrollRef = useRef(null);
  // The committed-text handler is defined below `usePreviewBridge` (it needs
  // the hook's senders); this trampoline keeps the wiring order-free.
  const elementTextCommittedRef = useRef(null);
  const handleElementTextCommittedTrampoline = useCallback((payload) => {
    elementTextCommittedRef.current?.(payload);
  }, []);
  // Same for the frame's keyboard shortcuts (handleElementAction below).
  const elementActionRef = useRef(null);
  const handleElementShortcutTrampoline = useCallback((action) => {
    elementActionRef.current?.(action);
  }, []);
  const elementDropRef = useRef(null);
  const handleElementDropTrampoline = useCallback((drop) => {
    elementDropRef.current?.(drop);
  }, []);

  const handleElementSelected = useCallback((payload) => {
    setSelectedElement(payload);
    setElementEditError(null);
    setSelectionKey((n) => n + 1);
  }, []);

  const handleInlineEditStarted = useCallback((payload) => {
    setSelectedElement(null);
    setElementEditError(null);
    setTextSession((prev) => ({ element: payload, typography: payload?.typography || null, key: (prev?.key || 0) + 1 }));
  }, []);
  const handleInlineTypography = useCallback((typography) => {
    setTextSession((prev) => (prev ? { ...prev, typography } : prev));
  }, []);
  const handleInlineHistory = useCallback((history) => {
    setTextSession((prev) => (prev ? { ...prev, canUndo: !!history?.canUndo, canRedo: !!history?.canRedo } : prev));
  }, []);
  const handleInlineEditEnded = useCallback(() => setTextSession(null), []);

  const handleElementDeselected = useCallback(() => {
    setSelectedElement(null);
    setElementEditError(null);
  }, []);

  const isPreviewEditing = studioMode === 'website' && isEditMode;

  const pageNav = usePageNavigation({ files, activePage, setActivePage });
  pageNavRef.current = pageNav;

  const {
    requestScreenshot, selectParentElement, deselectElement,
    replyInlineEditResult, restoreScroll,
    formatInlineText, holdInlineText, finishInlineText, undoInlineText, redoInlineText,
    navState: frameNavState, goBack: frameGoBack, goForward: frameGoForward, scrollToHash,
  } = usePreviewBridge({
    iframeRef,
    previewSrcDoc,
    previewToken,
    previewMode,
    frameMounted: activeTab === 'preview',
    onRuntimeError: handleRuntimeError,
    onReady: handlePreviewReady,
    onStorageChange: handleStorageChange,
    editingEnabled: isPreviewEditing,
    dragEnabled: isPreviewEditing && isDragMode,
    onElementSelected: handleElementSelected,
    onElementDeselected: handleElementDeselected,
    onElementTextCommitted: handleElementTextCommittedTrampoline,
    onInlineEditStarted: handleInlineEditStarted,
    onInlineTypography: handleInlineTypography,
    onInlineEditEnded: handleInlineEditEnded,
    onInlineHistory: handleInlineHistory,
    onElementShortcut: handleElementShortcutTrampoline,
    onElementDrop: handleElementDropTrampoline,
    onNavigatePage: pageNav.navigateToHref,
  });
  scrollToHashRef.current = scrollToHash;
  restoreScrollRef.current = restoreScroll;

  // Back/forward walk the frame's own history (hash jumps) first, then pages.
  const navState = {
    canGoBack: frameNavState.canGoBack || pageNav.canPageBack,
    canGoForward: frameNavState.canGoForward || pageNav.canPageForward,
  };
  const goBack = frameNavState.canGoBack ? frameGoBack : pageNav.pageBack;
  const goForward = frameNavState.canGoForward ? frameGoForward : pageNav.pageForward;

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((on) => !on);
    setIsDragMode(false);
    setSelectedElement(null);
    setTextSession(null);
    setElementEditError(null);
    pendingScrollRef.current = null;
  }, []);

  // The Code tab unmounts the preview iframe, so any selection or in-place
  // text session dies with it; drop the parent's copy so the toolbar does not
  // come back pointing at an element the new frame never selected.
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    if (tab !== 'preview') {
      setSelectedElement(null);
      setTextSession(null);
      setElementEditError(null);
      pendingScrollRef.current = null;
    }
  }, []);

  // Switching drag mode keeps the selection (so a container picked with
  // select-parent can be dragged next) but ends any in-place text session,
  // which the frame aborts on its side.
  const handleToggleDragMode = useCallback(() => {
    setIsDragMode((on) => !on);
    setTextSession(null);
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

  // Deterministic click-to-edit: apply the change straight to the active
  // page's source (see lib/directEdits.js) and push the result as a normal
  // version, so undo/redo, history and project persistence all work
  // unchanged. When the anchor can't be matched unambiguously the edit
  // falls back to the AI path. Shared by the panel's Apply button and the
  // in-place text-edit commit.
  const applyElementChangesToSource = useCallback((element, changes) => {
    if (!element || !activeCode) return { ok: false, reason: 'invalid' };
    const result = applyDirectEdit(activeCode, element, changes);
    if (!result.ok) return result;
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
    saveProject({
      versionsToSave: finalVersions,
      indexToSave: updatedVersions.length,
    });
    // The frame reloads from the edited source; put it back where the user
    // was working instead of at the top of the page.
    if (element.scroll && typeof element.scroll.y === 'number') {
      pendingScrollRef.current = { x: element.scroll.x || 0, y: element.scroll.y || 0 };
    }
    return result;
  }, [activeCode, activePage, files, versions, currentVersionIndex, currentChatSessionId, saveProject]);

  const handleApplyElementEdit = useCallback((changes) => {
    if (!selectedElement || isGeneratingRef.current) return;
    const result = applyElementChangesToSource(selectedElement, changes);
    if (!result.ok) {
      if (result.reason === 'no-op' || result.reason === 'no-changes') {
        // Nothing to write (e.g. Apply with untouched fields): just close.
        deselectElement();
        setSelectedElement(null);
        setElementEditError(null);
        return;
      }
      setElementEditError(`${describeDirectEditFailure(result.reason)} Describe the change below to apply it with AI.`);
      setSelectionKey((n) => n + 1);
      return;
    }
    setElementEditError(null);
    setSelectedElement(null);
  }, [selectedElement, applyElementChangesToSource, deselectElement]);

  // Structure edits (toolbar keys or the frame's keyboard shortcuts) are
  // ordinary direct edits; undo/redo come from the frame because the global
  // shortcut cannot see keys while focus is inside it.
  const undoRedoRef = useRef(null);
  const handleElementAction = useCallback((action) => {
    if (action === 'undo' || action === 'redo') {
      if (!isGeneratingRef.current) undoRedoRef.current?.[action]?.();
      return;
    }
    const changes = {
      delete: { remove: true },
      duplicate: { duplicate: true },
      'move-up': { move: -1 },
      'move-down': { move: 1 },
    }[action];
    if (changes) handleApplyElementEdit(changes);
  }, [handleApplyElementEdit]);
  elementActionRef.current = handleElementAction;

  // Drag-to-move in the preview: a `moveTo` direct edit. The dragged
  // element need not be the selected one, so failures select it to offer
  // the AI path with the reason.
  const handleElementDrop = useCallback(({ element, target, position }) => {
    if (isGeneratingRef.current) return;
    const result = applyElementChangesToSource(element, { moveTo: { target, position } });
    if (result.ok || result.reason === 'no-op') {
      setSelectedElement(null);
      setElementEditError(null);
      return;
    }
    setSelectedElement(element);
    setElementEditError(`${describeDirectEditFailure(result.reason)} Describe where it should go below to move it with AI.`);
    setSelectionKey((n) => n + 1);
  }, [applyElementChangesToSource]);
  elementDropRef.current = handleElementDrop;

  // "Apply with AI" runs the edit straight away as a normal refinement; "Add
  // to chat" (or a chat box that already holds a draft or an attachment,
  // which a run would clear) only prefills. The prompt quotes the element's
  // exact source so the surgical edit can anchor on it.
  const handleElementEditWithAI = useCallback((instruction, { run = false } = {}) => {
    if (!selectedElement) return;
    const prefill = buildElementEditPrompt(selectedElement, instruction, {
      code: activeCode,
      page: activePage,
      multiPage: Object.keys(files).length > 1,
    });
    const canRun = run && String(instruction ?? '').trim() && chatMode !== 'ask'
      && !isGeneratingRef.current && !prompt.trim() && !attachment;
    deselectElement();
    setSelectedElement(null);
    setElementEditError(null);
    if (canRun) {
      handleGenerateRef.current?.(null, prefill);
      return;
    }
    setPrompt((current) => (current.trim() ? `${current}\n${prefill}` : prefill));
    setMobileView('chat');
  }, [selectedElement, activeCode, activePage, files, chatMode, prompt, attachment, deselectElement]);

  // In-place text editing: the bridge committed a typed edit on the page.
  // The payload carries the element snapshot captured BEFORE the typing
  // (its original text/outerHTML are the engine's match anchor), so this
  // applies exactly like a panel edit with `{ text: newText }` — then tells
  // the frame the outcome: success keeps the typed text (the reloaded
  // source shows it for real, at the remembered scroll offset), failure
  // makes the bridge revert and opens the panel with the AI path.
  const handleElementTextCommitted = useCallback((payload) => {
    if (!payload || !payload.newText) {
      replyInlineEditResult(false, payload?.editId);
      return;
    }
    const result = applyElementChangesToSource(payload, { text: payload.newText, style: payload.styles });
    if (result.ok) {
      // (applyElementChangesToSource queued the payload's scroll offset.)
      replyInlineEditResult(true, payload.editId);
      setSelectedElement(null);
      setElementEditError(null);
    } else {
      replyInlineEditResult(false, payload.editId);
      setSelectedElement(payload);
      setElementEditError(`${describeDirectEditFailure(result.reason)} Describe the change below and it will be applied with AI.`);
      setSelectionKey((n) => n + 1);
    }
  }, [replyInlineEditResult, applyElementChangesToSource]);
  elementTextCommittedRef.current = handleElementTextCommitted;

  // href suggestions for the element bar: only computed while a link or
  // button is selected, since it scans every page's markup.
  const selectedRole = selectedElement?.role;
  const linkTargets = useMemo(
    () => (selectedRole === 'link' || selectedRole === 'button' ? collectLinkTargets(files, activePage) : []),
    [selectedRole, files, activePage],
  );

  const handleAttachScreenshot = useCallback(async () => {
    setAttachmentError(null);
    if (imagesLocked) {
      setPlansModal({ reason: needsPlan ? null : IMAGES_LOCKED_REASON });
      return;
    }
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
  }, [requestScreenshot, imagesLocked, needsPlan]);

  const handleAttachFile = useCallback(async (file) => {
    if (!file) return;
    setAttachmentError(null);
    if (imagesLocked) {
      setPlansModal({ reason: needsPlan ? null : IMAGES_LOCKED_REASON });
      return;
    }
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
  }, [imagesLocked, needsPlan]);

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
  // The first-build screen stands in for the whole workspace until the first
  // prompt is submitted (which flips isChatActive), then it hands off to the
  // normal Header + build/preview layout for good.
  const showHero = !isChatActive;

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
    localStorage.setItem(BUILD_REASONING_EFFORT_KEY, buildReasoningEffort);
  }, [buildReasoningEffort]);

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
        setStudioMode(job.studioMode === 'website' ? 'website' : job.studioMode === 'game' ? 'game' : 'app');
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
    // Starter ideas, auto-fix and resumed jobs also land here, not only the
    // prompt box; the server refuses these requests anyway.
    if (maintenanceMode) {
      setError(MAINTENANCE_MESSAGE);
      return;
    }

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

    // Nothing to send without a trial or subscription: offer the trial
    // instead (the server refuses these requests anyway).
    if (needsPlan) {
      if (isAutoFix) {
        setIsAutoFixing(false);
        isAutoFixingRef.current = false;
        setAutoFixMessage(null);
        setGenerationStatus(null);
      } else {
        setPlansModal({});
      }
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
    if (window.innerWidth < 1024) {
      setActiveTab('preview');
    }
    clearStreamingState();
    setError(null);
    // The preview reloads for the new code; any live picker selection is
    // stale by then.
    setSelectedElement(null);
    setElementEditError(null);
    pendingScrollRef.current = null;
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
        if (kind === 'thinking_start') {
          setThinkingSince((prev) => prev ?? Date.now());
          return;
        }
        if (kind === 'thinking_end') {
          thinkingEndedRef.current = true;
          setThinkingSince(null);
          setStreamingReasoning('');
          return;
        }
        if (kind === 'reasoning') {
          // Some providers put content and reasoning deltas in the same SSE
          // chunk. Content is handled first, so ignore a reasoning delta that
          // arrives after actual code has begun.
          if (streamingCodeStartedRef.current || thinkingEndedRef.current) return;
          setStreamingReasoning((previous) => `${previous}${chunk}`);
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
          setLiveCodeStreamDone(false);
          return;
        }
        if (kind === 'page_stream') {
          // Plain streamed text for an additional page (see createMissingPages):
          // same handling as the landing page's stream, but into the page-code
          // state the code view's tab for that page reads.
          streamingCodeStartedRef.current = true;
          setStreamingReasoning('');
          pageStreamRef.current += chunk;
          const html = HTML_STREAM_START_RE.test(pageStreamRef.current) ? sanitizeHtmlResponse(pageStreamRef.current) : '';
          liveCodeRef.current = html || '';
          setStreamingPageCode(html || '');
          return;
        }
        if (kind === 'edit_stream_done') {
          setLiveCodeStreamDone(true);
          return;
        }
        if (kind === 'edit_stream_reset') {
          editStreamRef.current = '';
          liveCodeRef.current = '';
          setStreamingPageCode('');
          setLiveCodeStreamDone(false);
          return;
        }
        if (kind === 'edit_stream') {
          streamingCodeStartedRef.current = true;
          setStreamingReasoning('');
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
          streamingCodeStartedRef.current = true;
          setStreamingReasoning('');
          const sanitized = sanitizeHtmlResponse(streamingGeneratedCodeRef.current);
          setStreamingGeneratedCode(sanitized);
          liveCodeRef.current = sanitized;
          setGenerationStatus("Synthesizing your app from your prompt.");
        }
        if (!replyFrozenRef.current) {
          const boundaryMatch = streamingGeneratedCodeRef.current.match(HTML_STREAM_START_RE);
          if (boundaryMatch) {
            streamingReplyRef.current = extractLeadingReply(streamingGeneratedCodeRef.current);
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
      }, 'both', abortControllerRef.current.signal, chatMode === 'ask', shouldAskClarifyingQuestions, attachmentForRequest, isAutoFix, { build: buildReasoningEffort }, studioMode, files, projectName);
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
      // Over the plan's allowance, or an image on Free: offer the upgrade.
      if (err.billingCode) setPlansModal({ reason: err.message });
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
      if (billing.billingOn) billing.refresh();

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
    // A cancelled first build produced nothing, so the workspace drops back to
    // the empty hero. Discard the name chosen just before it started, or the
    // next prompt would silently build under that name instead of asking for a
    // new one.
    if (versions.length === 0 && !generatedCode) {
      setProjectName(STUDIO_MODES[studioModeRef.current]?.untitledName || 'Untitled App');
      setTempProjectName('');
      setHasSentFirstPrompt(false);
    }
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

  // Pages as they leave the app in an export: loop protection is added per
  // page here, never stored in `files`.
  const buildExportFiles = () => mapPages(files, (html) => injectLoopProtection(html));

  // The new tab is a blob: page with AppBlips' own origin, so the generated
  // code must not run in it directly: it would reach AppBlips' storage
  // (sign-in session, saved provider key) and /api/chat. The tab gets a
  // trusted shell instead, with the app in a sandboxed iframe like the preview
  // (lib/newTabShell.js).
  const handleOpenInNewTab = () => {
    if (!generatedCode) return;
    const shellHtml = buildNewTabShell({
      files,
      title: projectName || 'Preview',
      initialStorage: { ...previewStorageRef.current },
    });
    const url = URL.createObjectURL(new Blob([shellHtml], { type: 'text/html' }));
    window.open(url, '_blank');
  };

  // Hands the user the raw HTML file -- or, for a multi-page site, a .zip with
  // one file per page (links like about.html keep working when unzipped).
  // Self-hosted mode's stand-in for Deploy (no public-URL hosting without the
  // hosted backend); in hosted mode it sits alongside Deploy.
  const handleExportHtml = () => {
    if (!generatedCode) return;
    const outputFiles = buildExportFiles();
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
    // Confirmed: leaving the current app. Mark it so a reload before a studio
    // is picked lands on the picker instead of resuming the old project.
    markStartFresh();
    // The workspace is left untouched until a studio is chosen, so "Go back"
    // on the choice screen cancels cleanly.
    setIsStudioChoiceOpen(true);
  };

  const handleConfirmExit = () => {
    setIsExitConfirmOpen(false);
    // Same as "New": the workspace stays untouched until a studio is chosen,
    // so "Go back" on the picker returns to it.
    markStartFresh();
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
  undoRedoRef.current = { undo: handleUndo, redo: handleRedo };

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
    const jobStudioMode = interruptedJob.studioMode === 'website' ? 'website' : interruptedJob.studioMode === 'game' ? 'game' : 'app';
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
    setDeployError(null);
    setConfirmUndeploy(false);
    setIsDeployModalOpen(false);
    setTempProjectName('');
    setShouldGenerateAfterNaming(false);
    setIsNamingModalOpen(false);
    setIsEditMode(false);
    setIsDragMode(false);
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
    // The old project must not come back on the next reload -- in hosted mode
    // there is no last-open pointer to remove, so this marker is what
    // suppresses the resume-newest behavior.
    markStartFresh();
  };

  // The studio-choice screen. Forced on a fresh session (gate), or opened by
  // "New" once work was confirmed away. Picking seeds the untitled name and
  // the studio's default preview device.
  // Signing in from the picker must land back on the picker (or the picked
  // studio's hero), not resume the account's newest project: the resume in
  // useProjects runs on the signed-out -> signed-in flip unless the
  // start-fresh marker is set. Remember whether we set it so dismissing the
  // modal without signing in leaves storage as we found it.
  const pickerSetStartFreshRef = useRef(false);
  const openPickerSignIn = () => {
    pickerSetStartFreshRef.current = !isStartFresh();
    markStartFresh();
    setIsAuthModalOpen(true);
  };

  const handleChooseStudio = (mode) => {
    if (!STUDIO_MODES[mode]) return;
    // Hosted mode: a studio can't be entered signed out. Remember the pick,
    // open the sign-in modal, and the effect below resumes it once a session
    // lands. (Self-hosted is always signed in, so this never triggers there.)
    if (firebaseEnabled && !isSignedIn) {
      setPendingStudio(mode);
      openPickerSignIn();
      return;
    }
    resetCurrentWorkspace(mode);
    setIsStudioChoiceOpen(false);
  };

  // A remix is saved only once its project id and versions are committed, so
  // saveProject's closure sees the new project rather than the one it replaced
  // (which would otherwise hand the old project's preview storage to it).
  useEffect(() => {
    if (!remixSaveRef.current || remixSaveRef.current !== currentProjectId || versions.length === 0) return;
    remixSaveRef.current = null;
    saveProject({ force: true });
  }, [currentProjectId, versions, saveProject]);

  useEffect(() => {
    if (isSignedIn) pickerSetStartFreshRef.current = false;
    if (!pendingStudio || !isSignedIn) return;
    setPendingStudio(null);
    handleChooseStudio(pendingStudio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStudio, isSignedIn]);

  const handleCloseAuthModal = () => {
    setIsAuthModalOpen(false);
    setPendingStudio(null);
    if (pickerSetStartFreshRef.current) {
      pickerSetStartFreshRef.current = false;
      clearStartFresh();
    }
  };

  const handleCancelStudioChoice = () => {
    // Going back re-anchors the untouched workspace: a reload should resume
    // the previous project like it would before "New" was clicked.
    clearStartFresh();
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

  // Hosted only. Re-verify first (the server only deletes for a fresh
  // sign-in), then the server removes the account and everything it owns --
  // projects, published apps, usage, any subscription -- and the sign-out
  // that follows clears this browser's copy. Throws with a user-facing
  // message so the Settings dialog can show it.
  const handleDeleteAccount = async () => {
    if (!firebaseEnabled || !user?.id) return;
    await authProvider.reauthenticate();
    await authProvider.deleteAccount();
    setIsSettingsOpen(false);
  };

  // Copies a showcase project's source into a brand-new project of the
  // caller's own. The current project is already auto-saved, so switching away
  // loses nothing -- except a build still streaming, which must finish first.
  // Hosted mode needs an account to own the copy, so signed-out visitors are
  // sent to sign in first.
  const handleRemixFromShowcase = async (project) => {
    if (firebaseEnabled && !isSignedIn) {
      setIsAuthModalOpen(true);
      return;
    }
    if (isGenerating) throw new Error('Wait for the current build to finish before remixing.');
    const source = await fetchRemixSource(project);
    const sessionId = newChatSessionId();
    const name = `${project.title} (remix)`.slice(0, 80);
    const version = {
      id: Date.now(),
      prompt: `Remix “${project.title}”`,
      files: source.files,
      timestamp: new Date().toLocaleTimeString(),
      editMode: 'remix',
      editSummary: null,
      reply: `Here's your copy of “${project.title}”. Tell me what you'd like to change.`,
      chatMode: 'build',
      sessionId,
    };
    resetCurrentWorkspace(source.studioMode);
    const projectId = crypto.randomUUID();
    loadProject({
      id: projectId,
      name,
      versions: [version],
      currentVersionIndex: 0,
      chatContextStartIndex: 0,
      currentChatSessionId: sessionId,
      deployment: null,
      studioMode: source.studioMode,
    });
    remixSaveRef.current = projectId;
    setIsStudioChoiceOpen(false);
    closeShowcase();
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

  // Every sign-out affordance (studio picker, header menu, account settings)
  // asks first: signing out also clears this browser's copy of the workspace.
  const handleConfirmSignOut = () => {
    setIsSignOutConfirmOpen(false);
    handleSignOut();
  };
  // Shared by the studio picker and the workspace/hero, like signOutConfirmModal.
  const settingsModal = isSettingsOpen && (
        <SettingsModal
          onClose={() => { setIsSettingsOpen(false); setSettingsInitialTab(null); }}
          initialTab={settingsInitialTab}
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
          buildReasoningEffort={buildReasoningEffort}
          onBuildReasoningEffortChange={setBuildReasoningEffort}
          onDeleteAllProjects={handleDeleteAllProjects}
          projectCount={myProjects.length}
          onDeleteAccount={firebaseEnabled && isSignedIn ? handleDeleteAccount : null}
          user={user}
          username={username}
          usernameLoading={usernameLoading}
          onSignOut={() => setIsSignOutConfirmOpen(true)}
        />
  );

  const showcaseOverlay = isShowcaseOpen && (
    <ShowcaseView
      activeProjectId={activeShowcaseProjectId}
      onOpenProject={openShowcaseProject}
      onCloseProject={closeShowcaseProject}
      onClose={closeShowcase}
      onRemix={handleRemixFromShowcase}
    />
  );
  // Entry points stay hidden until there is something to show; `?showcase`
  // still opens the (empty) page.
  const onOpenShowcase = showcaseProjects.length > 0 ? openShowcase : undefined;

  // Shared by the studio picker and the workspace: Checkout's return lands on
  // whichever one a fresh page load shows.
  const plansOverlay = (plansModal || billing.checkoutResult) && billing.billingOn && (
    <PlansModal
      status={billing.status}
      reason={plansModal?.reason}
      welcome={Boolean(plansModal?.welcome)}
      checkoutResult={billing.checkoutResult}
      onRefresh={billing.refresh}
      onClose={() => { setPlansModal(null); billing.clearCheckoutResult(); }}
    />
  );

  const signOutConfirmModal = isSignOutConfirmOpen && (
    <ConfirmModal
      title="Sign out?"
      subtitle="You can sign back in any time."
      onClose={() => setIsSignOutConfirmOpen(false)}
      onConfirm={handleConfirmSignOut}
      confirmLabel="Sign out"
      icon={LogOut}
      confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
    >
      <p className="text-sm text-slate-600 leading-relaxed">
        Your projects stay saved to your account. This browser will be cleared of the current workspace until you sign in again.
      </p>
    </ConfirmModal>
  );

  // Fresh session with nothing to resume and no studio picked: the whole
  // workspace stays behind the studio choice. A project resume (or adopted
  // pending job) sets studioMode before the resume flag clears, so returning
  // users never see the gate. Mid-session, the same screen opens over "New".
  const showStudioChoice = isStudioChoiceOpen || (!isResumingProject && studioMode === null);
  if (showStudioChoice) {
    return (
      <div className="app-shell fixed inset-0 overflow-hidden bg-slate-50 flex flex-col font-sans">
        <SplashScreen skip={skipSplash || !splashDue} />
        <StudioChoice
          onSelectStudio={handleChooseStudio}
          onCancel={isStudioChoiceOpen && !isProjectsListOpen ? handleCancelStudioChoice : null}
          savedAppsCount={myProjects.length}
          onOpenProjects={() => setIsProjectsListOpen(true)}
          requireSignIn={firebaseEnabled}
          isSignedIn={isSignedIn}
          onSignIn={openPickerSignIn}
          onSignOut={() => setIsSignOutConfirmOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenShowcase={onOpenShowcase}
          billingPlan={billing.plan}
          billingTrialing={billing.trialing}
          onOpenPlans={() => setPlansModal({})}
        />
        {showcaseOverlay}
        {settingsModal}
        {plansOverlay}
        <AuthToast kind={authToast} onDismiss={dismissAuthToast} />
        {isDesktop && <DesktopStorageNotice />}
        {!firebaseEnabled && <UpdateNotice />}
        {isAuthModalOpen && firebaseEnabled && (
          <AuthModal onClose={handleCloseAuthModal} />
        )}
        {signOutConfirmModal}
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
      <SplashScreen skip={skipSplash || !splashDue} />
      {!showHero && !isResumingProject && (
      <Header
        projectName={projectName}
        onNewApp={handleNewApp}
        onExit={() => setIsExitConfirmOpen(true)}
        savedAppsCount={myProjects.length}
        versionsCount={versions.length}
        onOpenApps={() => setIsProjectsListOpen(true)}
        onOpenShowcase={onOpenShowcase}
        isHistoryOpen={isHistoryOpen}
        onToggleHistory={() => setIsHistoryOpen(!isHistoryOpen)}
        resolvedTheme={resolvedTheme}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onStartTour={startTour}
        authStatus={authStatus}
        isSignedIn={isSignedIn}
        userEmail={user?.email}
        onOpenAccountSettings={() => { setSettingsInitialTab('account'); setIsSettingsOpen(true); }}
        onSignIn={() => setIsAuthModalOpen(true)}
        onSignOut={() => setIsSignOutConfirmOpen(true)}
        billingPlan={billing.plan}
        billingTrialing={billing.trialing}
        onOpenPlans={() => setPlansModal({})}
        firebaseEnabled={firebaseEnabled}
        onOpenAnalytics={() => openAnalytics()}
        studioMode={studioMode}
        mobileView={mobileView}
        onMobileViewChange={setMobileView}
        onNewChat={handleStartNewChat}
        canNewChat={isChatActive && versions.length > 0 && !isGenerating}
      />
      )}

      {!showHero && !isResumingProject && <TourInvitation onStart={startTour} />}
      {isTourOpen && (
        <GuidedTour onClose={closeTour} onViewChange={setMobileView} firebaseEnabled={firebaseEnabled} hasCode={Boolean(generatedCode)} showCodeView={showCodeView} studioMode={studioMode} />
      )}

      {settingsModal}

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

      {signOutConfirmModal}

      {isExitConfirmOpen && (
        <ConfirmModal
          title="Exit to the studio picker?"
          subtitle="You'll choose between building an app or a website."
          onClose={() => setIsExitConfirmOpen(false)}
          onConfirm={handleConfirmExit}
          confirmLabel="Exit"
          confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
        >
          <div className="rounded-xl border border-amber-100 bg-amber-50 dark:border-slate-200 dark:bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 dark:text-slate-900 shrink-0 mt-0.5" />
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
          <div className="rounded-xl border border-amber-100 bg-amber-50 dark:border-slate-200 dark:bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 dark:text-slate-900 shrink-0 mt-0.5" />
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
          <div className="rounded-xl border border-amber-100 bg-amber-50 dark:border-slate-200 dark:bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 dark:text-slate-900 shrink-0 mt-0.5" />
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



      {plansOverlay}

      <AuthToast kind={authToast} onDismiss={dismissAuthToast} />
      {isDesktop && <DesktopStorageNotice />}
      {!firebaseEnabled && <UpdateNotice />}

      {showcaseOverlay}

      {isAuthModalOpen && firebaseEnabled && (
        <AuthModal onClose={handleCloseAuthModal} />
      )}

      {isResumingProject ? null : showHero ? (
        <HeroLanding
          studioMode={studioMode}
          chatMode={chatMode}
          onChatModeChange={setChatMode}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={handleGenerate}
          onCancelGeneration={handleCancelGeneration}
          isGenerating={isGenerating}
          attachment={attachment}
          attachmentError={attachmentError}
          isCapturingScreenshot={isCapturingScreenshot}
          onAttachScreenshot={handleAttachScreenshot}
          onAttachFile={handleAttachFile}
          onRemoveAttachment={handleRemoveAttachment}
          starterIdeas={
            chatMode === 'ask'
              ? ASK_STARTER_PRESETS
              : studioMode === 'website'
                ? WEBSITE_STARTER_PRESETS
                : studioMode === 'game'
                  ? GAME_STARTER_PRESETS
                  : STARTER_PRESETS
          }
          starterSampleSize={chatMode !== 'ask' ? STARTER_SAMPLE_SIZE[studioMode] : undefined}
          onPickStarter={setPrompt}
          error={error}
          interruptedJob={interruptedJob}
          onRetryInterruptedJob={handleRetryInterruptedJob}
          onDismissInterruptedJob={handleDismissInterruptedJob}
          onNewApp={handleNewApp}
          onOpenApps={() => setIsProjectsListOpen(true)}
          onOpenShowcase={onOpenShowcase}
          savedAppsCount={myProjects.length}
          recents={myProjects}
          onLoadProject={loadProject}
          onOpenSettings={() => setIsSettingsOpen(true)}
          firebaseEnabled={firebaseEnabled}
          isSignedIn={isSignedIn}
          authStatus={authStatus}
          userEmail={user?.email}
          onOpenAnalytics={() => openAnalytics()}
          onOpenAccountSettings={() => { setSettingsInitialTab('account'); setIsSettingsOpen(true); }}
          onSignIn={() => setIsAuthModalOpen(true)}
        />
      ) : (
      <div className="workspace flex flex-1 min-w-0 min-h-0 overflow-hidden relative animate-fade-in">
        <HistorySidebar
          isOpen={isHistoryOpen}
          versions={versions}
          chatSessions={chatSessions}
          currentVersionIndex={currentVersionIndex}
          onSwitchVersion={switchVersion}
          onCollapse={() => setIsHistoryOpen(false)}
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
              onChatModeChange={setChatMode}
              onRewind={setRewindTargetIndex}
              generatedCode={generatedCode}
              showStarterIdeas={showStarterIdeas}
              starterIdeas={
                chatMode === 'ask'
                  ? ASK_STARTER_PRESETS
                  : studioMode === 'website'
                    ? WEBSITE_STARTER_PRESETS
                    : studioMode === 'game'
                      ? GAME_STARTER_PRESETS
                      : STARTER_PRESETS
              }
              starterSampleSize={chatMode !== 'ask' ? STARTER_SAMPLE_SIZE[studioMode] : undefined}
              onPickStarter={setPrompt}
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              chatContextStartIndex={chatContextStartIndex}
              pendingPrompt={pendingPrompt}
              pendingAttachment={pendingAttachment}
              streamingReply={streamingReply}
              isGenerating={isGenerating}
              generationStatus={generationStatus}
              thinkingSince={thinkingSince}
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
              isHistoryOpen={isHistoryOpen}
              onToggleHistory={() => setIsHistoryOpen((open) => !open)}
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
              onTabChange={handleTabChange}
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
              isBareFill={isBareFill}
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
              thinkingSince={thinkingSince}
              streamingReasoning={streamingReasoning}
              liveCodeRef={liveCodePreview ? liveCodeRef : null}
              liveCodeStreamDone={liveCodeStreamDone}
              liveCodePage={studioMode === 'website' ? liveCodePage : null}
              isAutoFixing={isAutoFixing}
              onCancelGeneration={handleCancelGeneration}
              code={codePanelCode}
              copied={copied}
              onCopyCode={handleCopyCode}
              autoFollowCode={autoFollowCode}
              studioMode={studioMode}
              isEditMode={isEditMode}
              isDragMode={isDragMode}
              onToggleDragMode={handleToggleDragMode}
              onToggleEditMode={handleToggleEditMode}
              selectedElement={selectedElement}
              selectionKey={selectionKey}
              textSession={textSession}
              onFormatText={formatInlineText}
              onHoldText={holdInlineText}
              onFinishText={finishInlineText}
              onUndoText={undoInlineText}
              onRedoText={redoInlineText}
              elementEditError={elementEditError}
              onApplyElementEdit={handleApplyElementEdit}
              onElementAction={handleElementAction}
              linkTargets={linkTargets}
              onElementEditWithAI={handleElementEditWithAI}
              onCancelElementSelection={handleCancelElementSelection}
              onSelectParentElement={handleSelectParentElement}
            />
          </div>
        </main>
      </div>
      )}
    </div>
  );
}
