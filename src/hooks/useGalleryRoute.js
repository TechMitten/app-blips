import { useCallback, useEffect, useState } from 'react';
import { parseGalleryRoute, buildGalleryHref } from '../lib/galleryFormat';

// Gallery open/post state mirrored into the URL (`?gallery`, `?app=<id>`) so
// posts can be shared and the browser Back button closes the post, then the
// gallery. No router: each entry we push carries `galleryDepth` (how many
// gallery entries sit on top of the page the user came from) and `fromGrid`
// (the post was opened over the grid, so Back returns to it).
const historyState = () => window.history.state || {};

export default function useGalleryRoute(enabled) {
  const [route, setRoute] = useState(() =>
    (enabled ? parseGalleryRoute(window.location.search) : { open: false, postId: null }));

  useEffect(() => {
    if (!enabled) return undefined;
    const onPopState = () => setRoute(parseGalleryRoute(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [enabled]);

  const push = useCallback((next, extra = {}) => {
    const depth = historyState().galleryDepth || 0;
    window.history.pushState(
      { ...historyState(), galleryDepth: depth + 1, fromGrid: false, ...extra },
      '',
      buildGalleryHref(window.location.href, next),
    );
    setRoute(next);
  }, []);

  const replace = useCallback((next) => {
    window.history.replaceState({ ...historyState(), fromGrid: false }, '', buildGalleryHref(window.location.href, next));
    setRoute(next);
  }, []);

  const openGallery = useCallback(() => {
    if (!route.open) push({ open: true, postId: null });
  }, [route.open, push]);

  const openPost = useCallback((postId) => {
    if (route.postId === postId) return;
    push({ open: true, postId }, { fromGrid: route.open && !route.postId });
  }, [route.open, route.postId, push]);

  const closePost = useCallback(() => {
    if (!route.postId) return;
    if (historyState().fromGrid) window.history.back();
    else replace({ open: true, postId: null });
  }, [route.postId, replace]);

  // Pops every gallery entry we pushed, returning to where the user started;
  // arriving straight on a shared link has none, so the URL is just cleaned.
  const closeGallery = useCallback(() => {
    const depth = historyState().galleryDepth || 0;
    if (depth > 0) window.history.go(-depth);
    else replace({ open: false, postId: null });
  }, [replace]);

  return { isGalleryOpen: route.open, activePostId: route.postId, openGallery, openPost, closePost, closeGallery };
}
