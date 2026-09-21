import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
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
// Media-query store for useSyncExternalStore. Kept at module scope so the
// MediaQueryList is created once and getSnapshot stays referentially stable --
// React calls it during render, so it must not allocate.
const NARROW_QUERY = '(max-width: 1023px)';
const narrowMql = typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY) : null;
const subscribeNarrow = (onChange) => {
  if (!narrowMql) return () => {};
  narrowMql.addEventListener('change', onChange);
  return () => narrowMql.removeEventListener('change', onChange);
};
const getNarrowSnapshot = () => (narrowMql ? narrowMql.matches : false);
const getNarrowServerSnapshot = () => false;

export default function usePreviewViewport({ activeTab, isHistoryOpen, fillDesktop = false }) {
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
  // On a phone the workspace is already the size of the device being
  // simulated, so drawing a phone inside a phone spends ~45% of the width on
  // bezel and backdrop. Below lg the default `mobile` preset therefore renders
  // bare and edge-to-edge; picking Tablet or Desktop still shows the mockup,
  // because those are genuinely a different viewport from the one in hand.
  const isNarrowViewport = useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getNarrowServerSnapshot);

  // Bare only for the phone preset: Tablet/Desktop stay framed so the user can
  // still see what those viewports look like from a phone.
  const isBareFill = isNarrowViewport && previewMode === 'mobile';

  const [orientationFlipClass, setOrientationFlipClass] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isAutoZoom, setIsAutoZoom] = useState(true);
  // When set, the desktop viewport is the container's own size at 100% zoom
  // instead of the fixed preset scaled to fit (see `fillDesktop`).
  const [fillSize, setFillSize] = useState(null);

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
      if (!isAutoZoom) setFillSize(null);
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
      if ((fillDesktop && previewMode === 'desktop') || isBareFill) {
        // Fill the whole section: no letterboxing, and the page renders at its
        // real pixel size rather than a shrunken 1468px canvas. The desktop
        // mockup keeps a small inset so its shadow has room; the bare phone
        // preview has no frame to cast one, so it goes fully edge to edge.
        const inset = isBareFill ? 0 : 8;
        const width = Math.max(320, Math.floor(el.clientWidth - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) - inset * 2));
        const height = Math.max(240, Math.floor(el.clientHeight - (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) - inset * 2));
        setZoomLevel(1);
        setFillSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
        return;
      }
      setFillSize(null);
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

      // Auto-fit may go below manual zoom limits on small or short screens.
      const clampedZoom = Math.max(0.05, Math.min(newZoom, 2.5));
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
  }, [isAutoZoom, activeTab, previewMode, previewOrientation, isHistoryOpen, containerNode, fillDesktop, isBareFill]);

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
    fillSize,
    isBareFill,
    isAutoZoom,
    handleManualZoom,
    resetZoom,
  };
}
