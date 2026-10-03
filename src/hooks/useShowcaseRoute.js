import { useCallback, useEffect, useState } from 'react';
import { parseShowcaseRoute, buildShowcaseHref } from '../lib/showcase';

// Showcase open/project state mirrored into the URL (`?showcase`,
// `?showcase=<id>`) so projects can be shared and the browser Back button
// closes the project, then the showcase. No router: each entry we push carries
// `showcaseDepth` (how many showcase entries sit on top of the page the user
// came from) and `fromGrid` (the project was opened over the grid, so Back
// returns to it).
const historyState = () => window.history.state || {};

export default function useShowcaseRoute() {
  const [route, setRoute] = useState(() => parseShowcaseRoute(window.location.search));

  useEffect(() => {
    const onPopState = () => setRoute(parseShowcaseRoute(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const push = useCallback((next, extra = {}) => {
    const depth = historyState().showcaseDepth || 0;
    window.history.pushState(
      { ...historyState(), showcaseDepth: depth + 1, fromGrid: false, ...extra },
      '',
      buildShowcaseHref(window.location.href, next),
    );
    setRoute(next);
  }, []);

  const replace = useCallback((next) => {
    window.history.replaceState({ ...historyState(), fromGrid: false }, '', buildShowcaseHref(window.location.href, next));
    setRoute(next);
  }, []);

  const openShowcase = useCallback(() => {
    if (!route.open) push({ open: true, projectId: null });
  }, [route.open, push]);

  const openProject = useCallback((projectId) => {
    if (route.projectId === projectId) return;
    push({ open: true, projectId }, { fromGrid: route.open && !route.projectId });
  }, [route.open, route.projectId, push]);

  const closeProject = useCallback(() => {
    if (!route.projectId) return;
    if (historyState().fromGrid) window.history.back();
    else replace({ open: true, projectId: null });
  }, [route.projectId, replace]);

  // Pops every showcase entry we pushed, returning to where the user started;
  // arriving straight on a shared link has none, so the URL is just cleaned.
  const closeShowcase = useCallback(() => {
    const depth = historyState().showcaseDepth || 0;
    if (depth > 0) window.history.go(-depth);
    else replace({ open: false, projectId: null });
  }, [replace]);

  return {
    isShowcaseOpen: route.open,
    activeProjectId: route.projectId,
    openShowcase,
    openProject,
    closeProject,
    closeShowcase,
  };
}
