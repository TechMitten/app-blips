import { SlidersHorizontal, Smartphone, Tablet, Monitor, Expand, RotateCcwSquare, ZoomOut, ZoomIn, Undo2, Redo2 } from 'lucide-react';
import { PREVIEW_MODES } from '../lib/constants';
import useDetailsDismiss from '../hooks/useDetailsDismiss';

export default function PreviewTools({ activeTab, previewMode, onPreviewModeChange, onToggleOrientation, zoomLevel, isAutoZoom, onZoomOut, onZoomIn, onResetZoom, versions, currentVersionIndex, onUndo, onRedo }) {
  const toolsRef = useDetailsDismiss();

  return (
    <details ref={toolsRef} className="preview-compact-tools">
      <summary role="button" data-tour="tools" className="nav-btn nav-btn-secondary nav-btn-icon" aria-label="Preview tools" data-tip="Preview tools">
        <SlidersHorizontal size={16} />
      </summary>
      <div className="preview-tools-menu bg-surface border border-slate-200 rounded-lg shadow-xl">
        {activeTab === 'preview' && (
          <>
            <div className="nav-segmented-group" role="group" aria-label="Preview device">
              {/* All three presets in every studio -- the studio's default
                  mode carries the device personality instead. */}
              {[
                { mode: 'mobile', label: 'Smartphone', Icon: Smartphone },
                { mode: 'tablet', label: 'Tablet', Icon: Tablet },
                { mode: 'desktop', label: 'Desktop', Icon: Monitor },
              ].map((option) => {
                const { mode, label, Icon } = option;
                // Full size is a variant of Desktop, so Desktop stays lit.
                const active = previewMode === mode || (mode === 'desktop' && PREVIEW_MODES[previewMode].isFill);
                return (
                <button key={mode} type="button" onClick={() => onPreviewModeChange(mode)} aria-label={label} title={label} aria-pressed={active} className={'nav-segmented-btn nav-segmented-btn-icon ' + (active ? 'nav-segmented-btn-active' : '')}>
                  <Icon size={16} />
                </button>
                );
              })}
              {/* Always drawn (disabled where they don't apply) so the keys
                  don't move when the device changes. */}
              <button type="button" onClick={onToggleOrientation} disabled={!PREVIEW_MODES[previewMode].isTouchChrome} className="nav-segmented-btn nav-segmented-btn-icon" aria-label="Rotate device" title="Rotate device"><RotateCcwSquare size={16} /></button>
              <button type="button" onClick={() => onPreviewModeChange(PREVIEW_MODES[previewMode].isFill ? 'desktop' : 'fill')} disabled={PREVIEW_MODES[previewMode].isTouchChrome} aria-pressed={Boolean(PREVIEW_MODES[previewMode].isFill)} className={'nav-segmented-btn nav-segmented-btn-icon ' + (PREVIEW_MODES[previewMode].isFill ? 'nav-segmented-btn-active' : '')} aria-label="Full size" title="Full size"><Expand size={16} /></button>
            </div>
            <div className="nav-segmented-group" role="group" aria-label="Preview zoom">
              <button type="button" onClick={() => onZoomOut(-0.1)} disabled={PREVIEW_MODES[previewMode].isFill || zoomLevel <= 0.2} className="nav-segmented-btn nav-segmented-btn-icon" aria-label="Zoom out" title="Zoom out"><ZoomOut size={16} /></button>
              <button type="button" onClick={onResetZoom} disabled={PREVIEW_MODES[previewMode].isFill} className="nav-segmented-btn" aria-label="Fit preview" title="Fit preview">{isAutoZoom ? 'Auto' : 'Reset'}</button>
              <button type="button" onClick={() => onZoomIn(0.1)} disabled={PREVIEW_MODES[previewMode].isFill || zoomLevel >= 3} className="nav-segmented-btn nav-segmented-btn-icon" aria-label="Zoom in" title="Zoom in"><ZoomIn size={16} /></button>
            </div>
          </>
        )}
        <div className="nav-segmented-group" role="group" aria-label="Version history">
          <button type="button" onClick={onUndo} disabled={currentVersionIndex <= 0} className="nav-segmented-btn nav-segmented-btn-icon" aria-label="Previous version" title="Previous version"><Undo2 size={16} /></button>
          <span className="preview-version-count">
            {versions.length ? (<>v{currentVersionIndex + 1}<span className="preview-version-total">/{versions.length}</span></>) : 'None'}
          </span>
          <button type="button" onClick={onRedo} disabled={currentVersionIndex >= versions.length - 1} className="nav-segmented-btn nav-segmented-btn-icon" aria-label="Next version" title="Next version"><Redo2 size={16} /></button>
        </div>
      </div>
    </details>
  );
}
