import { useState, useEffect, useCallback, useRef } from 'react';

const MIN_WIDTH = 320;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 480;

// Drag-to-resize state for the build (prompt/chat) pane, persisted to
// localStorage.
export default function useBuildPaneResize() {
  const [buildPaneWidth, setBuildPaneWidth] = useState(() => {
    const saved = Number(localStorage.getItem('orion-build-pane-width'));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const [isResizingBuildPane, setIsResizingBuildPane] = useState(false);
  const buildPaneResizeStartRef = useRef({ startX: 0, startWidth: DEFAULT_WIDTH });

  const handleBuildPaneResizeStart = useCallback((e) => {
    e.preventDefault();
    buildPaneResizeStartRef.current = { startX: e.clientX, startWidth: buildPaneWidth };
    setIsResizingBuildPane(true);
  }, [buildPaneWidth]);

  useEffect(() => {
    if (!isResizingBuildPane) return;

    const handleMouseMove = (e) => {
      const { startX, startWidth } = buildPaneResizeStartRef.current;
      const min = MIN_WIDTH;
      const max = Math.min(MAX_WIDTH, Math.max(min, window.innerWidth - 420));
      const next = Math.min(max, Math.max(min, startWidth + (e.clientX - startX)));
      setBuildPaneWidth(next);
    };
    const handleMouseUp = () => setIsResizingBuildPane(false);

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingBuildPane]);

  useEffect(() => {
    localStorage.setItem('orion-build-pane-width', String(buildPaneWidth));
  }, [buildPaneWidth]);

  return { buildPaneWidth, isResizingBuildPane, handleBuildPaneResizeStart };
}
