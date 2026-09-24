import { useState, useEffect } from 'react';
import {
  Play, TerminalSquare, Smartphone, Tablet, Monitor, RotateCcwSquare, Undo2, Redo2,
  ZoomIn, ZoomOut, ExternalLink, Rocket, Download, RefreshCw, MousePointerClick
} from 'lucide-react';
import DeviceMockup from './DeviceMockup';
import CodeView from './CodeView';
import PreviewTools from './PreviewTools';
import PagePicker from './PagePicker';
import ElementToolbar from './ElementToolbar';
import TextFormatToolbar from './TextFormatToolbar';
import { PREVIEW_MODES } from '../lib/constants';
import { SHORTCUT_HINTS } from '../lib/shortcuts';

// Icon-only in the bar; PREVIEW_MODES supplies the name and the viewport
// dimensions that the tooltip spells out.
const DEVICE_PRESETS = [
  { mode: 'mobile', Icon: Smartphone },
  { mode: 'tablet', Icon: Tablet },
  { mode: 'desktop', Icon: Monitor },
];

// Right-hand canvas studio: toolbar (tabs, device presets, undo/redo, zoom,
// open/deploy) and the preview surface or code view below it.
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
  onOpenNewTab,
  deployment,
  isDeployStale,
  isSignedIn,
  onOpenDeployModal,
  firebaseEnabled,
  onExportHtml,
  containerRef,
  iframeRef,
  previewSrcDoc,
  onReloadPreview,
  isGenerating,
  generationStatus,
  thinkingSince = null,
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
                aria-label="Code"
                aria-pressed={activeTab === 'code'}
                data-tip="Read the generated HTML"
                className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                  activeTab === 'code' ? 'nav-segmented-btn-active' : ''
                }`}
              >
                <TerminalSquare size={16} />
                <span>Code</span>
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

          {/* Page switcher for multi-page sites, in every device mode (on
              desktop it sits alongside the mockup's browser tabs). The code
              view has its own file tabs. */}
          {pages.length > 1 && activeTab === 'preview' && (
            <PagePicker pages={pages} activePage={activePage} onSelectPage={onSelectPage} />
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
                    aria-pressed={previewMode === mode}
                    data-tip={`${PREVIEW_MODES[mode].label} \u2014 ${PREVIEW_MODES[mode].width} \u00d7 ${PREVIEW_MODES[mode].height}`}
                    className={`nav-segmented-btn nav-segmented-btn-icon ${previewMode === mode ? 'nav-segmented-btn-active' : ''}`}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
              {/* Device presets are shared across studios -- the studio
                  personality lives in the default (App -> Smartphone,
                  Website -> Desktop), not in a restricted picker. */}
              {PREVIEW_MODES[previewMode].isTouchChrome && (
                <button
                  onClick={onToggleOrientation}
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
              )}
            </>
          )}
        </div>

        {/* Zone 3 -- what you can do with it, quietest first. Exactly one key
            in this rank is filled: Deploy when hosted, Export when not. */}
        <div className="preview-actions flex items-center gap-1.5 sm:gap-2 min-w-0">
          {/* Stands in for the presets once they fold away, so the two key
              groups still read as separate ranks. */}
          <span className="chrome-divider preview-header-divider" aria-hidden="true" />
          <PreviewTools {...{ activeTab, previewMode, onPreviewModeChange, onToggleOrientation, zoomLevel, isAutoZoom, onZoomOut, onZoomIn, onResetZoom, versions, currentVersionIndex, onUndo, onRedo }} />

          {activeTab === 'preview' && (
            <div className="preview-fold-zoom nav-segmented-group" role="group" aria-label="Zoom">
              <button
                onClick={() => onZoomOut(-0.1)}
                disabled={zoomLevel <= 0.2}
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
                aria-pressed={isAutoZoom}
                aria-label={isAutoZoom ? 'Zoom: fit to pane' : `Zoom: ${zoomPercent}%. Reset to fit`}
                data-tip={isAutoZoom ? 'Fitting to the pane' : 'Reset to fit'}
                className={`nav-segmented-btn preview-zoom-value ${isAutoZoom ? 'nav-segmented-btn-active' : ''}`}
              >
                {isAutoZoom ? 'Auto' : `${zoomPercent}%`}
              </button>
              <button
                onClick={() => onZoomIn(0.1)}
                disabled={zoomLevel >= 3}
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

          {activeTab === 'preview' && hasCode && (
            <button
              onClick={onReloadPreview}
              className="nav-btn nav-ghost nav-btn-icon"
              aria-label="Reload the app preview"
              data-tip="Reload the preview"
            >
              <RefreshCw size={16} />
            </button>
          )}

          {hasCode && (
            <button
              onClick={onOpenNewTab}
              className="nav-btn nav-ghost nav-btn-icon"
              aria-label="Open preview in new browser tab"
              data-tip="Open in a new tab"
            >
              <ExternalLink size={16} />
            </button>
          )}

          {hasCode && <span className="chrome-divider preview-actions-divider" aria-hidden="true" />}

          {/* Export the HTML file (both modes; the primary action when
              self-hosted, where it also carries the tour anchor). */}
          {hasCode && (
            <button
              {...(!firebaseEnabled && { 'data-tour': 'share' })}
              onClick={onExportHtml}
              className={firebaseEnabled
                ? 'nav-btn nav-btn-secondary preview-key'
                : 'nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs'}
              aria-label="Export app"
              data-tip="Download this app as an HTML file"
              data-tip-align="end"
            >
              <Download size={16} />
              {/* Hosted mode already has a labelled filled key (Deploy), and a
                  rank with two of them has no primary. Export is the secondary
                  action there, so it keeps the icon and the tooltip only. */}
              {!firebaseEnabled && <span className="preview-key-label">Export</span>}
            </button>
          )}

          {/* Deploy to a public URL (hosted mode only) */}
          {hasCode && firebaseEnabled && (
            <button
              data-tour="share"
              aria-label="Manage deployment"
              onClick={onOpenDeployModal}
              className="nav-btn brand-fill-text preview-key relative bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs"
              data-tip={deployment ? (isDeployStale && isSignedIn ? 'Deployment is out of date' : 'Manage deployment') : 'Deploy to a public URL'}
              data-tip-align="end"
            >
              <Rocket size={16} />
              <span className="preview-key-label">
                {deployment ? (isDeployStale && isSignedIn ? 'Update' : 'Deployed') : 'Deploy'}
              </span>
              {isDeployStale && isSignedIn && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-brand" />
              )}
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
              onEditWithAI={onElementEditWithAI}
              onCancel={onCancelElementSelection}
              onSelectParent={onSelectParentElement}
            />
          )}
        </div>
      )}

      {/* Container for Device or Code */}
      <div
        ref={containerRef}
        className={`preview-canvas flex-1 min-w-0 min-h-0 flex items-center-safe justify-center-safe p-6 relative custom-scrollbar ${isTransitioning ? 'overflow-hidden' : 'overflow-auto'}`}
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
            srcDoc={previewSrcDoc}
            isGenerating={isGenerating}
            generationStatus={generationStatus}
            thinkingSince={thinkingSince}
            liveCodeRef={liveCodeRef}
            liveCodePage={liveCodePage}
            hasCode={hasCode}
            isAutoFixing={isAutoFixing}
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
