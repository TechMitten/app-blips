import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'orion-build-panel-width';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;

export default function useBuildPaneResize() {
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val >= MIN_WIDTH) return val;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  const startResize = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [panelWidth]);

  const resetWidth = useCallback(() => {
    setPanelWidth(DEFAULT_WIDTH);
    try {
      localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const maxWidth = Math.min(Math.round(window.innerWidth * 0.55), 720);
      const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidthRef.current + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      setPanelWidth((curr) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(curr));
        } catch {
          /* ignore */
        }
        return curr;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return {
    panelWidth,
    isResizing,
    startResize,
    resetWidth,
  };
}
