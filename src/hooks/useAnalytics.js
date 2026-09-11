import { useState, useCallback, useEffect } from 'react';
import { db, firebaseEnabled } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { fetchAnalyticsStats } from '../lib/appAnalytics';

// How often to re-poll Umami's /active endpoint for the selected app. Umami's
// own "active" window is a rolling 5 minutes, so this is frequent enough to
// feel live without hammering the self-hosted instance.
const ACTIVE_VISITORS_POLL_MS = 15000;

// Analytics dashboard state: the list of the user's analytics-enabled
// deployments, plus stats for whichever one is currently selected. Hosted
// mode only -- self-hosted has no deployments collection to query.
export default function useAnalytics({ isSignedIn, user }) {
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [myAnalyticsApps, setMyAnalyticsApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [range, setRange] = useState('30d');
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeVisitors, setActiveVisitors] = useState(null);

  const loadMyAnalyticsApps = useCallback(async () => {
    if (!firebaseEnabled || !isSignedIn || !user?.id) return [];
    setAppsLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'deployments'), where('user_id', '==', user.id));
      const snapshot = await getDocs(q);
      const apps = snapshot.docs
        .map((d) => d.data())
        .filter((row) => row.analyticsEnabled && row.analyticsWebsiteId);
      setMyAnalyticsApps(apps);
      return apps;
    } catch (err) {
      setError(err.message || 'Failed to load your apps.');
      return [];
    } finally {
      setAppsLoading(false);
    }
  }, [isSignedIn, user?.id]);

  const rangeToWindow = (value) => {
    const days = value === '7d' ? 7 : value === '90d' ? 90 : 30;
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;
    return { startAt, endAt, unit: days > 30 ? 'day' : 'day' };
  };

  const loadStats = useCallback(async (slug, rangeValue = range) => {
    if (!slug) return;
    setStatsLoading(true);
    setError(null);
    try {
      const { startAt, endAt, unit } = rangeToWindow(rangeValue);
      const [summary, pageviews, urls, referrers, countries, entryPages] = await Promise.all([
        fetchAnalyticsStats(slug, { type: 'summary', startAt, endAt }),
        fetchAnalyticsStats(slug, { type: 'pageviews', startAt, endAt, unit }),
        fetchAnalyticsStats(slug, { type: 'urls', startAt, endAt }),
        fetchAnalyticsStats(slug, { type: 'referrers', startAt, endAt }),
        fetchAnalyticsStats(slug, { type: 'countries', startAt, endAt }),
        fetchAnalyticsStats(slug, { type: 'entryPages', startAt, endAt }),
      ]);
      setStats({ summary, pageviews, urls, referrers, countries, entryPages });
    } catch (err) {
      setError(err.message || 'Failed to load analytics.');
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [range]);

  const selectApp = useCallback((slug) => {
    setSelectedSlug(slug);
    if (slug) loadStats(slug, range);
  }, [loadStats, range]);

  const changeRange = useCallback((value) => {
    setRange(value);
    if (selectedSlug) loadStats(selectedSlug, value);
  }, [loadStats, selectedSlug]);

  const openAnalytics = useCallback(async (initialSlug = null) => {
    setIsAnalyticsOpen(true);
    const apps = await loadMyAnalyticsApps();
    const slugToSelect = initialSlug && apps.some((a) => a.slug === initialSlug)
      ? initialSlug
      : apps[0]?.slug || null;
    if (slugToSelect) selectApp(slugToSelect);
  }, [loadMyAnalyticsApps, selectApp]);

  const closeAnalytics = useCallback(() => {
    setIsAnalyticsOpen(false);
  }, []);

  // Realtime visitor count for whichever app is selected. Best-effort: a
  // failed poll just clears the badge rather than surfacing an error, since
  // the rest of the dashboard (loadStats above) already owns error display.
  useEffect(() => {
    if (!selectedSlug) {
      setActiveVisitors(null);
      return undefined;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchAnalyticsStats(selectedSlug, { type: 'active' });
        if (!cancelled) setActiveVisitors(typeof data?.visitors === 'number' ? data.visitors : null);
      } catch {
        if (!cancelled) setActiveVisitors(null);
      }
    };
    poll();
    const intervalId = setInterval(poll, ACTIVE_VISITORS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedSlug]);

  return {
    isAnalyticsOpen,
    openAnalytics,
    closeAnalytics,
    myAnalyticsApps,
    appsLoading,
    selectedSlug,
    selectApp,
    range,
    changeRange,
    stats,
    statsLoading,
    error,
    activeVisitors,
  };
}
