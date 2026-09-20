import { useCallback, useEffect, useRef, useState } from 'react';
import { getHash, resolvePageLink } from '../lib/pages';

// Page-level history for multi-page projects. Every page swap replaces the
// preview frame's srcDoc, which resets the frame's own history, so back/forward
// between pages has to live in the parent. The frame's in-page history (hash
// jumps) is still handled by the frame; App combines both for the nav buttons.
export default function usePageNavigation({ files, activePage, setActivePage }) {
  const [history, setHistoryState] = useState({ stack: [activePage], index: 0 });
  const historyRef = useRef(history);
  const setHistory = useCallback((next) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  // Hash to scroll to once the newly-loaded page reports ready.
  const pendingHashRef = useRef('');
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; });

  // activePage can change from outside (project load, reset, version restore,
  // page picker). Entries that no longer match it are treated as a fresh
  // single-entry history, so back/forward never point at a stale page.
  const activePageRef = useRef(activePage);
  useEffect(() => { activePageRef.current = activePage; });
  const liveHistory = useCallback(() => {
    const h = historyRef.current;
    return h.stack[h.index] === activePageRef.current ? h : { stack: [activePageRef.current], index: 0 };
  }, []);
  const inSync = history.stack[history.index] === activePage;

  const goToPage = useCallback((page, hash = '') => {
    if (!(page in filesRef.current)) return false;
    pendingHashRef.current = hash;
    const h = liveHistory();
    if (h.stack[h.index] !== page) {
      const stack = [...h.stack.slice(0, h.index + 1), page];
      setHistory({ stack, index: stack.length - 1 });
    }
    setActivePage(page);
    return true;
  }, [liveHistory, setActivePage, setHistory]);

  // Entry point for links clicked inside the preview frame.
  const navigateToHref = useCallback((href) => {
    const page = resolvePageLink(href);
    return page ? goToPage(page, getHash(href)) : false;
  }, [goToPage]);

  const stepHistory = useCallback((delta) => {
    const h = liveHistory();
    const index = h.index + delta;
    if (index < 0 || index >= h.stack.length) return;
    pendingHashRef.current = '';
    setHistory({ ...h, index });
    setActivePage(h.stack[index]);
  }, [liveHistory, setActivePage, setHistory]);

  const pageBack = useCallback(() => stepHistory(-1), [stepHistory]);
  const pageForward = useCallback(() => stepHistory(1), [stepHistory]);

  return {
    goToPage,
    navigateToHref,
    pageBack,
    pageForward,
    canPageBack: inSync && history.index > 0,
    canPageForward: inSync && history.index < history.stack.length - 1,
    pendingHashRef,
  };
}
