import { useState, useEffect } from 'react';
import {
  Play, TerminalSquare, Smartphone, Tablet, Monitor, RotateCcwSquare, Undo2, Redo2,
  ZoomIn, ZoomOut, ExternalLink, Rocket, Download, RefreshCw, MousePointerClick
} from 'lucide-react';
import { pageLabel } from '../lib/pages';
import DeviceMockup from './DeviceMockup';
import CodeView from './CodeView';
import PreviewTools from './PreviewTools';
import ElementEditor from './ElementEditor';
import { PREVIEW_MODES } from '../lib/constants';

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
  liveCodeRef,
  liveCodePage = null,
  isAutoFixing,
  autoFixMessage,
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

      {/* Canvas Studio Header Bar */}
      <div className="preview-pane-header h-14 sm:h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-slate-200 dark:border-white/10 bg-surface/95 backdrop-blur-md z-10">
        {/* Left: View Tabs */}
        <div className="preview-tabs flex items-center gap-2 sm:gap-2.5">
          <div className="nav-segmented-group -ml-1 sm:-ml-1.25">
            <button
              onClick={() => onTabChange('preview')}
              aria-label="Preview"
              aria-pressed={activeTab === 'preview'}
              className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                activeTab === 'preview' ? 'nav-segmented-btn-active' : ''
              }`}
            >
              <Play size={14} />
              <span>Preview</span>
            </button>
            {showCodeView && (
              <button
                onClick={() => onTabChange('code')}
                aria-label="Code"
                aria-pressed={activeTab === 'code'}
                className={`nav-segmented-btn px-3.5 py-1.5 text-xs sm:text-sm font-semibold ${
                  activeTab === 'code' ? 'nav-segmented-btn-active' : ''
                }`}
              >
                <TerminalSquare size={14} />
                <span>Code</span>
              </button>
            )}
          </div>

          {/* Version indicator pill */}
          {versions.length > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs sm:text-sm font-bold border border-slate-200 dark:bg-black/30 dark:border-white/[0.07]">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              v{currentVersionIndex + 1}
            </span>
          )}
        </div>

        {/* Phone-only rule between the view tabs and the action keys. It sits
            in the center slot of this justify-between row, so it lands in the
            gap the hidden device presets leave behind; CSS hides it again as
            soon as those presets come back. */}
        <span className="preview-header-divider" aria-hidden="true" />

        {/* Center: Device Presets (when in preview tab) */}
        {activeTab === 'preview' && (
          <div className="preview-wide-tools hidden sm:flex items-center gap-1.5 sm:gap-2">
            <div className="nav-segmented-group" title="Device Viewport Preset">
              <button
                onClick={() => onPreviewModeChange('mobile')}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'mobile' ? 'nav-segmented-btn-active' : ''}`}
                title={`${PREVIEW_MODES.mobile.label} View (${PREVIEW_MODES.mobile.width} × ${PREVIEW_MODES.mobile.height})`}
              >
                <Smartphone size={14} />
                <span className="hidden sm:inline">Smartphone</span>
              </button>
              <button
                onClick={() => onPreviewModeChange('tablet')}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'tablet' ? 'nav-segmented-btn-active' : ''}`}
                title={`${PREVIEW_MODES.tablet.label} View (${PREVIEW_MODES.tablet.width} × ${PREVIEW_MODES.tablet.height})`}
              >
                <Tablet size={14} />
                <span className="hidden sm:inline">Tablet</span>
              </button>
              {/* Device presets are shared across studios -- the studio
                  personality lives in the default (App -> Smartphone,
                  Website -> Desktop), not in a restricted picker. */}
              <button
                onClick={() => onPreviewModeChange('desktop')}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'desktop' ? 'nav-segmented-btn-active' : ''}`}
                title={`${PREVIEW_MODES.desktop.label} View (${PREVIEW_MODES.desktop.width} × ${PREVIEW_MODES.desktop.height})`}
              >
                <Monitor size={14} />
                <span className="hidden sm:inline">Desktop</span>
              </button>
            </div>
            {PREVIEW_MODES[previewMode].isTouchChrome && (
              <div className="nav-segmented-group" title="Device Orientation">
                <button
                  onClick={onToggleOrientation}
                  className="nav-segmented-btn nav-segmented-btn-icon"
                  title={`Rotate to ${previewOrientation === 'portrait' ? 'Landscape' : 'Portrait'}`}
                >
                  <RotateCcwSquare size={14} className={previewOrientation === 'landscape' ? '-rotate-90' : ''} style={{ transition: 'transform 0.2s ease' }} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Right: Studio Actions (Zoom, Undo/Redo, Pop-out) */}
        <div className="preview-actions flex items-center gap-1.5 sm:gap-2">
          <PreviewTools {...{ activeTab, previewMode, onPreviewModeChange, onToggleOrientation, zoomLevel, isAutoZoom, onZoomOut, onZoomIn, onResetZoom, versions, currentVersionIndex, onUndo, onRedo }} />
          {/* Undo/Redo when versions > 1 */}
          {versions.length > 1 && (
            <div className="preview-wide-tools hidden md:flex nav-segmented-group" title="Undo / Redo Version">
              <button
                onClick={onUndo}
                disabled={currentVersionIndex <= 0}
                className="nav-segmented-btn nav-segmented-btn-icon"
                title="Previous Version"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={onRedo}
                disabled={currentVersionIndex >= versions.length - 1}
                className="nav-segmented-btn nav-segmented-btn-icon"
                title="Next Version"
              >
                <Redo2 size={14} />
              </button>
            </div>
          )}

          {/* Zoom Controls (when in preview tab) */}
          {activeTab === 'preview' && (
            <div className="preview-wide-tools hidden sm:flex nav-segmented-group" title="Zoom Controls">
              <button
                onClick={() => onZoomOut(-0.1)}
                disabled={zoomLevel <= 0.2}
                className="nav-segmented-btn nav-segmented-btn-icon"
                title="Zoom Out (-10%)"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={onResetZoom}
                className={`nav-segmented-btn text-xs sm:text-sm font-semibold px-2.5 ${isAutoZoom ? 'nav-segmented-btn-active' : ''}`}
                title={isAutoZoom ? "Auto-Zoom active (click to reset)" : `${Math.round(zoomLevel * 100)}% — click to reset to Auto-Zoom`}
              >
                {isAutoZoom ? 'Auto' : 'Reset'}
              </button>
              <button
                onClick={() => onZoomIn(0.1)}
                disabled={zoomLevel >= 3}
                className="nav-segmented-btn nav-segmented-btn-icon"
                title="Zoom In (+10%)"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          )}

          {/* Website Studio: click-to-edit picker toggle. While on, clicks in
              the preview select elements for the inline editor instead of
              interacting with the site. */}
          {studioMode === 'website' && activeTab === 'preview' && hasCode && !isGenerating && (
            <div className="nav-segmented-group" title="Click-to-edit mode">
              <button
                onClick={onToggleEditMode}
                aria-pressed={isEditMode}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${isEditMode ? 'nav-segmented-btn-active' : ''}`}
                title={isEditMode ? 'Editing: click elements in the preview to edit them' : 'Turn on click-to-edit (click elements in the preview)'}
              >
                <MousePointerClick size={14} />
                <span className="hidden sm:inline">Edit</span>
              </button>
            </div>
          )}

          {/* Reload preview (when in preview tab and code generated) */}
          {activeTab === 'preview' && hasCode && (
            <div className="nav-segmented-group" title="Preview Controls">
              <button
                onClick={onReloadPreview}
                className="nav-segmented-btn nav-segmented-btn-icon"
                title="Reload the app preview"
                aria-label="Reload the app preview"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          )}

          {/* Open in new tab (when code generated) */}
          {hasCode && (
            <button
              onClick={onOpenNewTab}
              className="nav-btn nav-btn-secondary font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group"
              title="Open preview in new browser tab"
              aria-label="Open preview in new browser tab"
            >
              <ExternalLink size={14} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
              <span className="hidden lg:inline">Open</span>
            </button>
          )}

          {/* Export the HTML file (both modes; the primary action when self-hosted) */}
          {hasCode && (
            <button
              {...(!firebaseEnabled && { 'data-tour': 'share' })}
              onClick={onExportHtml}
              className={firebaseEnabled
                ? 'nav-btn nav-btn-secondary font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group'
                : 'nav-btn brand-fill-text bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group'}
              title="Download this app as an HTML file"
              aria-label="Export app"
            >
              <Download size={14} className={firebaseEnabled ? 'text-slate-500 group-hover:text-indigo-600 transition-colors' : undefined} />
              <span className="hidden md:inline">Export</span>
            </button>
          )}

          {/* Deploy to a public URL (hosted mode only) */}
          {hasCode && firebaseEnabled && (
            <button
              data-tour="share"
              aria-label="Manage deployment"
              onClick={onOpenDeployModal}
              className="nav-btn brand-fill-text relative bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group"
              title={deployment ? (isDeployStale && isSignedIn ? 'Deployment is out of date' : 'Manage deployment') : 'Deploy to a public URL'}
            >
              <Rocket size={14} />
              <span className="hidden md:inline">
                {deployment ? (isDeployStale && isSignedIn ? 'Update' : 'Deployed') : 'Deploy'}
              </span>
              {isDeployStale && isSignedIn && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-brand" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Container for Device or Code */}
      <div
        ref={containerRef}
        className={`preview-canvas flex-1 min-w-0 min-h-0 flex items-center-safe justify-center-safe p-6 relative custom-scrollbar ${isTransitioning ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        {/* Subtle workspace grid */}
        <div className="absolute inset-0 opacity-50 pointer-events-none workspace-grid"></div>

        {/* Click-to-edit inspector. Docked (not coordinate-anchored) on
            purpose: the mockup is scaled by a CSS transform, so mapping the
            frame's inner bounding box to parent coordinates reliably is a
            rabbit hole; a docked card sidesteps it entirely. */}
        {/* Desktop preview shows pages as browser tabs (DeviceMockup) and the code
            view has its own file tabs; only the tablet/phone preview uses this
            strip. */}
        {pages.length > 1 && activeTab === 'preview' && previewMode !== 'desktop' && (
          <div
            className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full border border-black/10 bg-white/90 p-1 shadow-md backdrop-blur dark:border-white/10 dark:bg-zinc-900/90"
            role="tablist"
            aria-label="Site pages"
          >
            {pages.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={name === activePage}
                onClick={() => onSelectPage?.(name)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  name === activePage
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10'
                }`}
              >
                {pageLabel(name)}
              </button>
            ))}
          </div>
        )}

        {studioMode === 'website' && activeTab === 'preview' && selectedElement && (
          <div className="absolute top-4 right-4 z-20 w-[300px] max-w-[calc(100%-2rem)] animate-fade-in">
            <ElementEditor
              key={selectionKey}
              element={selectedElement}
              isApplying={isApplyingElementEdit}
              error={elementEditError}
              onApply={onApplyElementEdit}
              onEditWithAI={onElementEditWithAI}
              onCancel={onCancelElementSelection}
              onSelectParent={onSelectParentElement}
            />
          </div>
        )}

        {activeTab === 'preview' ? (
          <DeviceMockup
            mode={previewMode}
            orientation={previewOrientation}
            flipClass={orientationFlipClass}
            onFlipAnimationEnd={() => onOrientationFlipEnd('')}
            zoomLevel={zoomLevel}
            fillSize={fillSize}
            iframeRef={iframeRef}
            srcDoc={previewSrcDoc}
            isGenerating={isGenerating}
            generationStatus={generationStatus}
            liveCodeRef={liveCodeRef}
            liveCodePage={liveCodePage}
            hasCode={hasCode}
            isAutoFixing={isAutoFixing}
            autoFixMessage={autoFixMessage}
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
