import {
  Play, TerminalSquare, Smartphone, Tablet, Monitor, RotateCw, Undo2, Redo2,
  ZoomIn, ZoomOut, ExternalLink, Rocket
} from 'lucide-react';
import DeviceMockup from './DeviceMockup';
import CodeView from './CodeView';
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
  containerRef,
  iframeRef,
  previewSrcDoc,
  isGenerating,
  generationStatus,
  code,
  copied,
  onCopyCode,
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col relative z-0 inset-shadow-preview noise-texture">

      {/* Canvas Studio Header Bar */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 2xl:py-3.5 border-b border-slate-200 bg-surface/95 backdrop-blur-md z-10">
        {/* Left: View Tabs */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="nav-segmented-group -ml-1 sm:-ml-[5px]">
            <button
              onClick={() => onTabChange('preview')}
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
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs sm:text-sm font-bold border border-slate-200">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              v{currentVersionIndex + 1}
            </span>
          )}
        </div>

        {/* Center: Device Presets (when in preview tab) */}
        {activeTab === 'preview' && (
          <div className="hidden sm:flex items-center gap-1.5 sm:gap-2">
            <div className="nav-segmented-group" title="Device Viewport Preset">
              <button
                onClick={() => onPreviewModeChange('mobile')}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'mobile' ? 'nav-segmented-btn-active' : ''}`}
                title={`${PREVIEW_MODES.mobile.label} View (${PREVIEW_MODES.mobile.width} × ${PREVIEW_MODES.mobile.height})`}
              >
                <Smartphone size={14} />
                <span className="hidden sm:inline">Mobile</span>
              </button>
              <button
                onClick={() => onPreviewModeChange('tablet')}
                className={`nav-segmented-btn px-3 py-1.5 text-xs sm:text-sm font-semibold ${previewMode === 'tablet' ? 'nav-segmented-btn-active' : ''}`}
                title={`${PREVIEW_MODES.tablet.label} View (${PREVIEW_MODES.tablet.width} × ${PREVIEW_MODES.tablet.height})`}
              >
                <Tablet size={14} />
                <span className="hidden sm:inline">Tablet</span>
              </button>
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
                  <RotateCw size={14} className={previewOrientation === 'landscape' ? '-rotate-90' : ''} style={{ transition: 'transform 0.2s ease' }} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Right: Studio Actions (Zoom, Undo/Redo, Pop-out) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Undo/Redo when versions > 1 */}
          {versions.length > 1 && (
            <div className="hidden md:flex nav-segmented-group" title="Undo / Redo Version">
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
            <div className="hidden sm:flex nav-segmented-group" title="Zoom Controls">
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
                title={isAutoZoom ? "Auto-Zoom active (click to reset)" : "Reset to Auto-Zoom"}
              >
                {isAutoZoom ? 'Auto' : `${Math.round(zoomLevel * 100)}%`}
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

          {/* Open in new tab (when code generated) */}
          {hasCode && (
            <button
              onClick={onOpenNewTab}
              className="nav-btn bg-surface hover:bg-slate-50 text-slate-700 hover:text-indigo-600 border border-slate-200/90 shadow-2xs font-semibold text-xs sm:text-sm py-1.5 sm:py-2 px-3 group"
              title="Open preview in new browser tab"
            >
              <ExternalLink size={14} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
              <span className="hidden lg:inline">Open</span>
            </button>
          )}

          {/* Deploy to a public URL */}
          {hasCode && (
            <button
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
        className="flex-1 min-h-0 flex items-center-safe justify-center-safe p-6 overflow-auto relative custom-scrollbar"
      >
        {/* Subtle workspace grid */}
        <div className="absolute inset-0 opacity-50 pointer-events-none workspace-grid"></div>

        {activeTab === 'preview' ? (
          <DeviceMockup
            mode={previewMode}
            orientation={previewOrientation}
            flipClass={orientationFlipClass}
            onFlipAnimationEnd={() => onOrientationFlipEnd('')}
            zoomLevel={zoomLevel}
            iframeRef={iframeRef}
            srcDoc={previewSrcDoc}
            isGenerating={isGenerating}
            generationStatus={generationStatus}
            hasCode={hasCode}
          />
        ) : (
          <CodeView
            code={code}
            isGenerating={isGenerating}
            copied={copied}
            onCopy={onCopyCode}
          />
        )}
      </div>
    </div>
  );
}
