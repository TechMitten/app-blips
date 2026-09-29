import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeed, PAGE_SIZE } from '../lib/gallery';

// One gallery feed (sort + search), paginated. `loading` is derived from
// whether the loaded result matches the current query, so switching tabs
// never shows another tab's rows. `patchPost`/`removePost` let the view keep
// every feed in sync with likes and edits made elsewhere.
export default function useGallery({ sort, search = '', userId = null, pageSize = PAGE_SIZE, enabled = true }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const key = `${sort}|${search.trim()}|${userId || ''}|${pageSize}|${refreshTick}`;
  const [result, setResult] = useState({ key: null, posts: [], hasMore: false, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  // Lets an in-flight loadMore notice the query changed under it.
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetchFeed({ sort, search, limit: pageSize, offset: 0 })
      .then((rows) => { if (!cancelled) setResult({ key, posts: rows, hasMore: rows.length === pageSize, error: null }); })
      .catch((err) => { if (!cancelled) setResult({ key, posts: [], hasMore: false, error: err.message }); });
    return () => { cancelled = true; };
  }, [enabled, key, sort, search, pageSize]);

  const loading = enabled && result.key !== key;

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !result.hasMore) return;
    const requestKey = key;
    setLoadingMore(true);
    try {
      const rows = await fetchFeed({ sort, search, limit: pageSize, offset: result.posts.length });
      if (keyRef.current !== requestKey) return;
      setResult((prev) => {
        // Hot ordering can shift between pages; drop rows we already show.
        const seen = new Set(prev.posts.map((p) => p.id));
        return { ...prev, posts: [...prev.posts, ...rows.filter((r) => !seen.has(r.id))], hasMore: rows.length === pageSize };
      });
    } catch (err) {
      if (keyRef.current === requestKey) setResult((prev) => ({ ...prev, error: err.message }));
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, result.hasMore, result.posts.length, key, sort, search, pageSize]);

  const patchPost = useCallback((postId, patch) => {
    setResult((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => (p.id === postId ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)),
    }));
  }, []);

  const removePost = useCallback((postId) => {
    setResult((prev) => ({ ...prev, posts: prev.posts.filter((p) => p.id !== postId) }));
  }, []);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  return {
    posts: result.key === key ? result.posts : [],
    loading,
    loadingMore,
    hasMore: result.key === key && result.hasMore,
    error: result.key === key ? result.error : null,
    loadMore,
    refresh,
    patchPost,
    removePost,
  };
}
