import { useState, useEffect } from 'react';
import { PREVIEW_MODES } from '../lib/constants';
import { getEffectivePreviewBox } from '../lib/helpers';

// Device viewport state for the preview area: mode preset, orientation (with
// flip animation), zoom (auto-fit or manual), all persisted to localStorage.
// `activeTab`/`isHistoryOpen` gate the auto-fit recalculation exactly like the
// original inline effect did.
export default function usePreviewViewport({ activeTab, isHistoryOpen, containerRef }) {
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
    const container = containerRef.current;
    if (!container) return;

    const calculateZoom = () => {
      if (!isAutoZoom || !containerRef.current || activeTab !== 'preview') return;

      const el = containerRef.current;
      const box = getEffectivePreviewBox(previewMode, previewOrientation);
      const { h: horizontalPadding, v: verticalPadding } = box.zoomPadding;
      const availableWidth = Math.max(100, el.clientWidth - horizontalPadding);
      const availableHeight = Math.max(100, el.clientHeight - verticalPadding);
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
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', calculateZoom);
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', calculateZoom);
    };
  }, [isAutoZoom, activeTab, previewMode, previewOrientation, isHistoryOpen, containerRef]);

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
