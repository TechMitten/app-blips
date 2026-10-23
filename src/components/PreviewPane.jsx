import { useState, useEffect } from 'react';
import {
  Play, TerminalSquare, FolderTree, Smartphone, Tablet, Monitor, RotateCcwSquare, Undo2, Redo2,
  ZoomIn, ZoomOut, Expand, ExternalLink, Download, FolderDown, Globe, MousePointerClick, Move, Loader2, Square, RotateCw
} from 'lucide-react';
import DeviceMockup from './DeviceMockup';
import CodeView from './CodeView';
import PreviewTools from './PreviewTools';
import BrowserBar from './BrowserBar';
import PagePicker from './PagePicker';
import ElementToolbar from './ElementToolbar';
import TextFormatToolbar from './TextFormatToolbar';
import { PREVIEW_MODES, STUDIO_MODES } from '../lib/constants';
import { SHORTCUT_HINTS } from '../lib/shortcuts';

// Icon-only in the bar; PREVIEW_MODES supplies the name and the viewport
// dimensions that the tooltip spells out.
const DEVICE_PRESETS = [
  { mode: 'mobile', Icon: Smartphone },
  { mode: 'tablet', Icon: Tablet },
  { mode: 'desktop', Icon: Monitor },
];

// Full size is a variant of Desktop (a toggle beside the presets, like
// Rotate for the touch devices), so the Desktop key stays lit while it's on.
const isPresetActive = (mode, previewMode) =>
  previewMode === mode || (mode === 'desktop' && PREVIEW_MODES[previewMode].isFill);

// Right-hand canvas studio: toolbar (tabs, device presets, undo/redo, zoom,
// open/export) and the preview surface or code view below it.
export default function PreviewPane({
  activeTab,
  onTabChange,
  showCodeView,
  versions,
  currentVersionIndex,
  previewMode,
  onPreviewModeChange,
  previewOrientation,
  onToggleOrientation,
  orientationFlipClass,
  onOrientationFlipEnd,
  zoomLevel,
  fillSize,
  isBareFill = false,
  isAutoZoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onUndo,
  onRedo,
  hasCode,
  hasSavedCode = hasCode,
  onOpenNewTab,
  onExportHtml,
  onExportReactProject = null,
  onPublish = null,
  containerRef,
  iframeRef,
  browserLockRef,
  shutterCount = 0,
  previewSrcDoc,
  browserToken,
  isBrowserTesting = false,
  onReloadPreview,
  isGenerating,
  generationStatus,
  thinkingSince = null,
  streamingReasoning = '',
  liveCodeRef,
  liveCodePage = null,
  isAutoFixing,
  onCancelGeneration,
  projectName = '',
  navState,
  onNavBack,
  onNavForward,
  code,
  copied,
  onCopyCode,
  autoFollowCode,
  studioMode = 'app',
  isEditMode = false,
  onToggleEditMode,
  isDragMode = false,
  onToggleDragMode,
  selectedElement = null,
  selectionKey = 0,
  textSession = null,
  onFormatText,
  onHoldText,
  onFinishText,
  onUndoText,
  onRedoText,
  elementEditError = null,
  isApplyingElementEdit = false,
  onApplyElementEdit,
  onElementAction,
  linkTargets = [],
  onElementEditWithAI,
  onCancelElementSelection,
  onSelectParentElement,
  pages = [],
  activePage = 'index.html',
  onSelectPage,
  codePages = [],
  codeActivePage = 'index.html',
  codeWritingPage = null,
  onSelectCodePage,
  // Imported codebases (studioMode 'codebase'): the preview shows a client
  // route instead of pages, and the code view lists the project's files.
  exportTip,
  route = null,
  onNavigateRoute = null,
  isPreviewBuilding = false,
  codeFiles = null,
  codeFile = null,
  codeFileIsBinary = false,
  onSelectCodeFile,
  codeFileChanges,
  codeEntryFile = null,
  codeProjectKey,
  codeAssetUrl = null,
}) {
  const [transitionState, setTransitionState] = useState({ 
    mode: previewMode, 
    orientation: previewOrientation, 
    isTransitioning: false 
  });

  if (transitionState.mode !== previewMode || transitionState.orientation !== previewOrientation) {
    setTransitionState({ mode: previewMode, orientation: previewOrientation, isTransitioning: true });
  }

  const { isTransitioning } = transitionState;

  const browserTitle = projectName?.trim() || STUDIO_MODES[studioMode]?.untitledName || 'Untitled App';
  const isFillMode = Boolean(PREVIEW_MODES[previewMode].isFill);
  const rotateLabel = `Rotate to ${previewOrientation === 'portrait' ? 'landscape' : 'portrait'}`;
  const zoomPercent = Math.round(zoomLevel * 100);

  useEffect(() => {
    if (isTransitioning) {
      const timer = setTimeout(() => {
        setTransitionState(prev => ({ ...prev, isTransitioning: false }));
      }, 550); // Slightly longer than 500ms CSS transition
      return () => clearTimeout(timer);
    }
  }, [isTransitioning]);

  return (
    <div className="preview-pane flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col relative z-0 inset-shadow-preview noise-texture">

      {/* Canvas studio toolbar. Three grid zones, read left to right: what you
          are looking at, what device it is drawn for, what you can do with it.
          The center cell is always rendered -- an empty one keeps the `auto`
          track from collapsing, which is what used to let the device presets
          drift sideways whenever a label changed beside them. */}
      <div className="preview-pane-header chrome-bar shrink-0 px-4 sm:px-6 border-b border-slate-200 dark:border-white/10 bg-surface/95 backdrop-blur-md z-10">

        {/* Zone 1 -- what you are looking at */}
        <div className="preview-tabs flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="nav-segmented-group" role="group" aria-label="View">
            <button
              onClick={() => onTabChange('preview')}
              aria-label="Preview"
              aria-pressed={activeTab === 'preview'}
              data-tip="Run the app"
              className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                activeTab === 'preview' ? 'nav-segmented-btn-active' : ''
              }`}
            >
              <Play size={16} />
              <span>Preview</span>
            </button>
            {showCodeView && (
              <button
                onClick={() => onTabChange('code')}
                aria-label={codeFiles ? 'Files' : 'Code'}
                aria-pressed={activeTab === 'code'}
                data-tip={codeFiles ? 'Browse the project\'s files' : 'Read the generated HTML'}
                className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                  activeTab === 'code' ? 'nav-segmented-btn-active' : ''
                }`}
              >
                {codeFiles ? <FolderTree size={16} /> : <TerminalSquare size={16} />}
                <span>{codeFiles ? 'Files' : 'Code'}</span>
              </button>
            )}
          </div>

          {/* Version stepper. The counter now rides the two keys that change
              it -- the pill and undo/redo used to sit at opposite ends of the
              bar. The disabled ends already say "nowhere to go from here", so
              this needs no separate versions.length > 1 gate. */}
          {versions.length > 0 && (
            <div data-tour="versions" className="preview-version nav-segmented-group" role="group" aria-label="Version history">
              <button
                onClick={onUndo}
                disabled={currentVersionIndex <= 0}
                className="nav-segmented-btn nav-segmented-btn-icon"
                aria-label="Previous version"
                data-tip="Previous version"
                data-tip-key={SHORTCUT_HINTS.undo}
              >
                <Undo2 size={16} />
              </button>
              <span className="preview-version-count" aria-live="polite">
                v{currentVersionIndex + 1}
                <span className="preview-version-total">/{versions.length}</span>
              </span>
              <button
                onClick={onRedo}
                disabled={currentVersionIndex >= versions.length - 1}
                className="nav-segmented-btn nav-segmented-btn-icon"
                aria-label="Next version"
                data-tip="Next version"
                data-tip-key={SHORTCUT_HINTS.redo}
              >
                <Redo2 size={16} />
              </button>
            </div>
          )}

          {/* Project pages are shared across device modes. The code view has
              its own file tabs. */}
          {pages.length > 1 && activeTab === 'preview' && !isBrowserTesting && (
            <PagePicker pages={pages} activePage={activePage} onSelectPage={onSelectPage} />
          )}

          {/* Lives here rather than in the browser bar, which the phone and
              tablet mockups don't show: the stop control must always be
              reachable. It takes the page picker's place while a test runs. */}
          {isBrowserTesting && (
            <div className="browser-testing-status" role="status">
              <Loader2 size={14} className="animate-spin" />
              <span>{generationStatus || 'Testing in browser…'}</span>
              <button type="button" className="nav-btn nav-ghost nav-btn-icon" aria-label="Stop browser testing" data-tip="Stop testing" onClick={onCancelGeneration}><Square size={13} /></button>
            </div>
          )}
        </div>

        {/* Zone 2 -- what device it is drawn for. Icon-only: the names moved
            into the tooltips, which now carry the viewport size too, and the
            group went from ~370px to ~120px. */}
        <div className="preview-center flex items-center gap-1.5 sm:gap-2">
          {activeTab === 'preview' && (
            <>
              <div data-tour="devices" className="preview-fold-device nav-segmented-group" role="group" aria-label="Device preset">
                {DEVICE_PRESETS.map(({ mode, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => onPreviewModeChange(mode)}
                    aria-label={PREVIEW_MODES[mode].label}
                    aria-pressed={isPresetActive(mode, previewMode)}
                    data-tip={`${PREVIEW_MODES[mode].label} \u2014 ${PREVIEW_MODES[mode].width} \u00d7 ${PREVIEW_MODES[mode].height}`}
                    className={`nav-segmented-btn nav-segmented-btn-icon ${isPresetActive(mode, previewMode) ? 'nav-segmented-btn-active' : ''}`}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
              {/* Device presets are shared across studios -- the studio
                  personality lives in the default (App -> Smartphone,
                  Website -> Desktop), not in a restricted picker.
                  Rotate, Full size and Reload are always drawn, and only
                  disabled where they don't apply, so switching devices never
                  shifts the keys around. */}
              <button
                onClick={onToggleOrientation}
                disabled={!PREVIEW_MODES[previewMode].isTouchChrome}
                className="preview-fold-device nav-btn nav-ghost nav-btn-icon"
                aria-label={rotateLabel}
                data-tip={rotateLabel}
              >
                <RotateCcwSquare
                  size={16}
                  className={previewOrientation === 'landscape' ? '-rotate-90' : ''}
                  style={{ transition: 'transform 0.2s ease' }}
                />
              </button>
              <button
                onClick={() => onPreviewModeChange(isFillMode ? 'desktop' : 'fill')}
                disabled={PREVIEW_MODES[previewMode].isTouchChrome}
                aria-pressed={isFillMode}
                className={`preview-fold-device nav-btn nav-ghost nav-btn-icon ${isFillMode ? 'nav-ghost-active' : ''}`}
                aria-label="Full size"
                data-tip={isFillMode ? 'Back to the desktop window' : 'Full size \u2014 fills the preview area'}
              >
                <Expand size={16} />
              </button>
              {/* The phone and tablet mockups have no browser bar, so this is
                  their only Reload key (desktop has a second one in its bar).
                  Not folded into the tools menu on narrow panes: reloading is
                  too common to bury. */}
              <button
                onClick={onReloadPreview}
                disabled={!hasCode || isBrowserTesting}
                className="nav-btn nav-ghost nav-btn-icon"
                aria-label="Reload preview"
                data-tip="Reload"
              >
                <RotateCw size={15} />
              </button>
            </>
          )}
        </div>

        {/* Zone 3 -- what you can do with it, quietest first. The Export key
            is the one filled action in this rank. */}
        <div className="preview-actions flex items-center gap-1.5 sm:gap-2 min-w-0">
          {/* Stands in for the presets once they fold away, so the two key
              groups still read as separate ranks. */}
          <span className="chrome-divider preview-header-divider" aria-hidden="true" />
          <PreviewTools {...{ activeTab, previewMode, onPreviewModeChange, onToggleOrientation, zoomLevel, isAutoZoom, onZoomOut, onZoomIn, onResetZoom, versions, currentVersionIndex, onUndo, onRedo }} />

          {/* Full size always shows the page at its real size, so there is
              nothing to zoom. The keys stay (disabled) so the bar doesn't shift. */}
          {activeTab === 'preview' && (
            <div className="preview-fold-zoom nav-segmented-group" role="group" aria-label="Zoom">
              <button
                onClick={() => onZoomOut(-0.1)}
                disabled={isFillMode || zoomLevel <= 0.2}
                className="nav-segmented-btn nav-segmented-btn-icon"
                aria-label="Zoom out"
                data-tip="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              {/* Reads out the live percentage rather than the word "Reset":
                  the number was previously only reachable through a title. */}
              <button
                onClick={onResetZoom}
                disabled={isFillMode}
                aria-pressed={isAutoZoom}
                aria-label={isAutoZoom ? 'Zoom: fit to pane' : `Zoom: ${zoomPercent}%. Reset to fit`}
                data-tip={isAutoZoom ? 'Fitting to the pane' : 'Reset to fit'}
                className={`nav-segmented-btn preview-zoom-value ${isAutoZoom ? 'nav-segmented-btn-active' : ''}`}
              >
                {isAutoZoom ? 'Auto' : `${zoomPercent}%`}
              </button>
              <button
                onClick={() => onZoomIn(0.1)}
                disabled={isFillMode || zoomLevel >= 3}
                className="nav-segmented-btn nav-segmented-btn-icon"
                aria-label="Zoom in"
                data-tip="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
          )}

          {/* Website Studio: click-to-edit picker toggle. While on, clicks in
              the preview select elements for the inline editor instead of
              interacting with the site. A lone toggle, so it is a key with an
              active rim -- a one-button segmented track would promise a set of
              choices that isn't there. */}
          {studioMode === 'website' && activeTab === 'preview' && hasCode && !isGenerating && (
            <button
              data-tour="edit"
              onClick={onToggleEditMode}
              aria-pressed={isEditMode}
              aria-label="Click-to-edit mode"
              data-tip={isEditMode ? 'Click elements in the preview to edit' : 'Turn on click-to-edit'}
              className={`nav-btn nav-ghost nav-btn-icon ${isEditMode ? 'nav-ghost-active' : ''}`}
            >
              <MousePointerClick size={16} />
            </button>
          )}

          {/* Drag mode: while it is on, dragging an element in the preview
              moves it, and a click selects without starting text editing. It
              is always shown beside click-to-edit (and turns click-to-edit on
              when needed): a key that appeared only in edit mode shifted the
              end-aligned rank under the pointer. */}
          {studioMode === 'website' && activeTab === 'preview' && hasCode && !isGenerating && (
            <button
              data-tour="drag"
              onClick={onToggleDragMode}
              aria-pressed={isDragMode}
              aria-label="Drag mode"
              data-tip={isDragMode ? 'Drag elements in the preview to move them' : 'Turn on drag mode to move elements'}
              className={`nav-btn nav-ghost nav-btn-icon ${isDragMode ? 'nav-ghost-active' : ''}`}
            >
              <Move size={16} />
            </button>
          )}

          {hasSavedCode && onOpenNewTab && (
            <button
              onClick={onOpenNewTab}
              disabled={isBrowserTesting}
              className="nav-btn nav-ghost nav-btn-icon"
              aria-label="Open site in new browser tab"
              data-tip="Open in a new tab"
            >
              <ExternalLink size={16} />
            </button>
          )}

          {hasSavedCode && <span className="chrome-divider preview-actions-divider" aria-hidden="true" />}

          {/* React apps can also leave as a Vite project to keep building with npm. */}
          {hasSavedCode && onExportReactProject && (
            <button
              onClick={onExportReactProject}
              disabled={isBrowserTesting}
              className="nav-btn nav-ghost nav-btn-icon"
              aria-label="Download React project"
              data-tip="Download as a React project (.zip)"
              data-tip-align="end"
            >
              <FolderDown size={16} />
            </button>
          )}

          {/* Puts the site online at a free surge.sh address (PublishDialog).
              The filled key when offered; Export steps down to an icon. */}
          {hasSavedCode && onPublish && (
            <button
              onClick={onPublish}
              disabled={isBrowserTesting}
              className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs"
              aria-label="Publish to the web"
              data-tip="Publish to the web (free surge.sh address)"
              data-tip-align="end"
            >
              <Globe size={16} />
              <span className="preview-key-label">Publish</span>
            </button>
          )}

          {/* Export the HTML file (also carries the tour anchor). Imported
              sites can't publish, so there it stays the filled key. */}
          {hasSavedCode && (
            <button
              data-tour="share"
              onClick={onExportHtml}
              disabled={isBrowserTesting}
              className={onPublish
                ? 'nav-btn nav-ghost nav-btn-icon'
                : 'nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs'}
              aria-label="Export app"
              data-tip={exportTip || 'Download this app as an HTML file'}
              data-tip-align="end"
            >
              <Download size={16} />
              {!onPublish && <span className="preview-key-label">Export</span>}
            </button>
          )}
        </div>
      </div>

      {/* Click-to-edit toolbar: a contextual second row that drops out from
          under the toolbar while an element is selected. It overlays the top
          of the canvas instead of taking layout space -- a bar that resized
          the canvas would re-fit the preview zoom on every selection. The dock
          persists while the selection changes (the bar inside remounts per
          element), so it animates in once. */}
      {studioMode === 'website' && activeTab === 'preview' && (textSession || selectedElement) && (
        <div className="element-bar-dock">
          {textSession ? (
            <TextFormatToolbar
              key={textSession.key}
              typography={textSession.typography}
              onFormat={onFormatText}
              onHold={onHoldText}
              onFinish={onFinishText}
              canUndo={Boolean(textSession.canUndo)}
              canRedo={Boolean(textSession.canRedo)}
              onUndo={onUndoText}
              onRedo={onRedoText}
            />
          ) : (
            <ElementToolbar
              key={selectionKey}
              element={selectedElement}
              isApplying={isApplyingElementEdit}
              error={elementEditError}
              onApply={onApplyElementEdit}
              onAction={onElementAction}
              linkTargets={linkTargets}
              onEditWithAI={onElementEditWithAI}
              onCancel={onCancelElementSelection}
              onSelectParent={onSelectParentElement}
              isDragMode={isDragMode}
            />
          )}
        </div>
      )}

      {/* A real phone or tablet has no desktop-style browser bar, so the
          touch mockups leave it out. */}
      {activeTab === 'preview' && !PREVIEW_MODES[previewMode].isTouchChrome && (
        <BrowserBar {...{ hasCode, navState, route, onNavigateRoute }} title={browserTitle}
          onBack={onNavBack} onForward={onNavForward} onReload={onReloadPreview}
          isTesting={isBrowserTesting} />
      )}

      {/* Container for Device or Code */}
      <div
        ref={containerRef}
        className={`preview-canvas flex-1 min-w-0 min-h-0 flex items-center-safe justify-center-safe p-6 relative custom-scrollbar ${isTransitioning || isAutoZoom ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        {/* Subtle workspace grid. It exists to read as a surface *behind* the
            device mockup; with the bare full-bleed preview there is no mockup
            to sit behind, so it would just tint the running app. */}
        {!isBareFill && <div className="absolute inset-0 opacity-50 pointer-events-none workspace-grid"></div>}



        {activeTab === 'preview' ? (
          <DeviceMockup
            mode={previewMode}
            orientation={previewOrientation}
            flipClass={orientationFlipClass}
            onFlipAnimationEnd={() => onOrientationFlipEnd('')}
            zoomLevel={zoomLevel}
            fillSize={fillSize}
            isBareFill={isBareFill}
            iframeRef={iframeRef}
            browserLockRef={browserLockRef}
            shutterCount={shutterCount}
            srcDoc={previewSrcDoc}
            browserToken={browserToken}
            isBrowserTesting={isBrowserTesting}
            isGenerating={(isGenerating || isPreviewBuilding) && !isBrowserTesting}
            generationStatus={generationStatus || (isPreviewBuilding ? 'Building the preview…' : null)}
            thinkingSince={thinkingSince}
            streamingReasoning={streamingReasoning}
            liveCodeRef={liveCodeRef}
            liveCodePage={liveCodePage}
            hasCode={hasCode}
            isAutoFixing={isAutoFixing && !isBrowserTesting}
            isTransitioning={isTransitioning}
            onCancelGeneration={onCancelGeneration}
            tabTitle={projectName}
            navState={navState}
            onNavBack={onNavBack}
            onNavForward={onNavForward}
            onReload={onReloadPreview}
            pages={pages}
            activePage={activePage}
            onSelectPage={onSelectPage}
          />
        ) : (
          <CodeView
            code={code}
            files={codeFiles}
            activeFile={codeFile}
            activeFileIsBinary={codeFileIsBinary}
            onSelectFile={onSelectCodeFile}
            fileChanges={codeFileChanges}
            entryFile={codeEntryFile}
            projectKey={codeProjectKey}
            assetUrl={codeAssetUrl}
            pages={codePages}
            activePage={codeActivePage}
            writingPage={codeWritingPage}
            onSelectPage={onSelectCodePage}
            isGenerating={isGenerating}
            copied={copied}
            onCopy={onCopyCode}
            autoFollow={autoFollowCode}
          />
        )}
      </div>
    </div>
  );
}
