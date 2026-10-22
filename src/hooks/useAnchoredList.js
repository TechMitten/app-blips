import { useCallback, useEffect, useState } from 'react';

const MAX_LIST_HEIGHT = 320;
const EDGE_GAP = 12;
const LIST_GAP = 4;

// Places a dropdown list portaled to <body> with fixed positioning under (or,
// when there's no room, above) its field, so a scrolling or overflow:hidden
// container can't clip it. Measured against the visual viewport so it stays
// put when a phone keyboard or pinch-zoom shrinks the visible area.
export default function useAnchoredList(anchorRef, listRef, open) {
  const [position, setPosition] = useState(null);

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportWidth = viewport?.width || window.innerWidth;
    const topEdge = viewportTop + EDGE_GAP;
    const bottomEdge = viewportTop + viewportHeight - EDGE_GAP;
    const belowTop = Math.min(bottomEdge, Math.max(topEdge, rect.bottom + LIST_GAP));
    const aboveBottom = Math.max(topEdge, Math.min(bottomEdge, rect.top - LIST_GAP));
    const below = Math.max(0, bottomEdge - belowTop);
    const above = Math.max(0, aboveBottom - topEdge);
    const openUp = below < MAX_LIST_HEIGHT && above > below;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - EDGE_GAP * 2));
    setPosition({
      left: Math.max(viewportLeft + EDGE_GAP, Math.min(rect.left, viewportLeft + viewportWidth - EDGE_GAP - width)),
      width,
      maxHeight: Math.min(MAX_LIST_HEIGHT, openUp ? above : below),
      boxSizing: 'border-box',
      ...(openUp ? { bottom: window.innerHeight - aboveBottom } : { top: belowTop }),
    });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) place(); };
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place, listRef]);

  return [position, place];
}
