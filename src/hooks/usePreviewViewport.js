import { useState, useEffect, useCallback } from 'react';
import { PREVIEW_MODES } from '../lib/constants';
import { getEffectivePreviewBox } from '../lib/helpers';

// Device viewport state for the preview area: mode preset, orientation (with
// flip animation), zoom (auto-fit or manual), all persisted to localStorage.
// `activeTab`/`isHistoryOpen` gate the auto-fit recalculation exactly like the
// original inline effect did.
//
// The container ref is created here as a callback ref mirrored into state:
// the workspace (and thus the container) mounts only after the auth loading
// screen unmounts, and a plain ref object would leave this effect's deps
// unchanged when that happens -- the effect would run once with a null node,
// never attach its ResizeObserver, and auto-zoom would stay stuck at its
// initial value until the user manually switched device mode.
export default function usePreviewViewport({ activeTab, isHistoryOpen }) {
  const [containerNode, setContainerNode] = useState(null);
  const containerRef = useCallback((node) => setContainerNode(node), []);
  const [previewMode, setPreviewMode] = useState(() => {
    const stored = localStorage.getItem('orion-preview-mode');
    return stored && PREVIEW_MODES[stored] ? stored : 'mobile';
  });
  const [previewOrientation, setPreviewOrientation] = useState(() => {
    const stored = localStorage.getItem('orion-preview-orientation');
    return stored === 'landscape' ? 'landscape' : 'portrait';
  });
  const [orientationFlipClass, setOrientationFlipClass] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isAutoZoom, setIsAutoZoom] = useState(true);

  const handleToggleOrientation = () => {
    setOrientationFlipClass(previewOrientation === 'portrait' ? 'device-flip-to-landscape' : 'device-flip-to-portrait');
    setPreviewOrientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');
  };

  useEffect(() => {
    localStorage.setItem('orion-preview-mode', previewMode);
  }, [previewMode]);

  useEffect(() => {
    localStorage.setItem('orion-preview-orientation', previewOrientation);
  }, [previewOrientation]);

  // --- Dynamic Zoom Logic ---
  useEffect(() => {
    if (!containerNode) return;

    const calculateZoom = () => {
      if (!isAutoZoom || activeTab !== 'preview') return;

      const el = containerNode;
      // Zoom fits inside the container's *content* box. clientWidth/Height
      // include the container's own padding (p-6), so subtract it first --
      // zoomPadding is breathing room on top of that, not a replacement.
      // Skipping this leaves the mockup overflowing the content box by the
      // padding delta, clipping the bottom edge and forcing a scrollbar.
      const cs = getComputedStyle(el);
      const box = getEffectivePreviewBox(previewMode, previewOrientation);
      const { h: horizontalPadding, v: verticalPadding } = box.zoomPadding;
      const availableWidth = Math.max(
        100,
        el.clientWidth - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) - horizontalPadding
      );
      const availableHeight = Math.max(
        100,
        el.clientHeight - (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) - verticalPadding
      );
      const baseHeight = box.height;
      const baseWidth = box.width;

      const scaleH = availableHeight / baseHeight;
      const scaleW = availableWidth / baseWidth;

      let newZoom = Math.min(scaleH, scaleW);

      // A rotated phone/tablet is still the same physical device -- its
      // shorter landscape height leaves more headroom to "fit" into the
      // container, which would otherwise zoom it up well past how large its
      // own portrait orientation renders in that same space. Cap it there so
      // rotating never makes the mockup look bigger, only differently shaped.
      if (PREVIEW_MODES[previewMode].isTouchChrome && previewOrientation === 'landscape') {
        const portraitPreset = PREVIEW_MODES[previewMode];
        const portraitZoom = Math.min(availableHeight / portraitPreset.height, availableWidth / portraitPreset.width);
        newZoom = Math.min(newZoom, portraitZoom);
      }

      // Fluid zoom ranging from 0.25x up to 2.5x to fill large 1440p / 4K / UHD screens
      const clampedZoom = Math.max(0.25, Math.min(newZoom, 2.5));
      setZoomLevel(Number(clampedZoom.toFixed(3)));
    };

    calculateZoom();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        calculateZoom();
      });
      resizeObserver.observe(containerNode);
    }

    window.addEventListener('resize', calculateZoom);
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', calculateZoom);
    };
  }, [isAutoZoom, activeTab, previewMode, previewOrientation, isHistoryOpen, containerNode]);

  const handleManualZoom = (multiplier) => {
    setIsAutoZoom(false);
    setZoomLevel(prev => {
      const next = prev + multiplier;
      return Math.max(0.2, Math.min(next, 3));
    });
  };

  const resetZoom = () => {
    setIsAutoZoom(true);
  };

  return {
    containerRef,
    previewMode,
    setPreviewMode,
    previewOrientation,
    handleToggleOrientation,
    orientationFlipClass,
    setOrientationFlipClass,
    zoomLevel,
    isAutoZoom,
    handleManualZoom,
    resetZoom,
  };
}
