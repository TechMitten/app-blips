import { useEffect } from 'react';
import '../App.css';
import { BarChart3, ChevronLeft, Loader2, LogIn, Lock } from 'lucide-react';
import { firebaseEnabled } from '../firebase';
import useTheme from '../hooks/useTheme';
import useAuth from '../hooks/useAuth';
import useAnalytics from '../hooks/useAnalytics';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import AuthModal from '../components/AuthModal';

// Centered icon-badge + message, matching the empty-state language used
// elsewhere (e.g. ProjectsListModal's "No saved apps yet").
function GateState({ icon, title, description, action }) {
  const Icon = icon;
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-500">
          <Icon size={22} />
        </div>
        <h2 className="text-slate-900 font-bold text-base">{title}</h2>
        {description && <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{description}</p>}
        {action}
      </div>
    </div>
  );
}

// Standalone route (see src/main.jsx) for the analytics dashboard, previously
// an in-app modal (AnalyticsDashboardModal). It's hosted-mode-only and needs
// its own sign-in gate since it no longer lives inside <App>'s tree -- it
// mounts useAuth/useTheme itself rather than sharing App's instances.
export default function AnalyticsPage() {
  useTheme();
  const { authStatus, isSignedIn, user, isAuthModalOpen, setIsAuthModalOpen } = useAuth();
  const {
    openAnalytics,
    myAnalyticsApps, appsLoading,
    selectedSlug, selectApp,
    range, changeRange,
    stats, statsLoading, error,
    activeVisitors,
  } = useAnalytics({ isSignedIn, user });

  useEffect(() => {
    if (isSignedIn) openAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-50 flex flex-col font-sans">
      {/* Plain border, no drop-shadow: header-shadow (used on the main app
          chrome) blurs ~20px below the header, which read as an overlap
          artifact smeared across the app-list card and range pills that sit
          immediately below it on this page. */}
      <header className="dark force-dark shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 dark:border-white/10 px-3 sm:px-6 2xl:px-8 py-2.5 2xl:py-3 flex items-center gap-3 sticky top-0 z-40">
        <a
          href="/"
          className="nav-btn nav-btn-secondary nav-btn-icon group shrink-0"
          title="Back to app"
          aria-label="Back to app"
        >
          <ChevronLeft size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          <span className="hidden sm:inline">Back to app</span>
        </a>
        <div className="flex items-center gap-2.5 min-w-0 pl-1 border-l border-slate-200/70 dark:border-white/10">
          <div className="w-8 h-8 brand-gradient rounded-xl flex items-center justify-center text-white shrink-0 shadow-2xs">
            <BarChart3 size={16} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900 truncate leading-tight">Analytics</h1>
            <p className="hidden sm:block text-[11px] text-slate-400 truncate leading-tight">Stats for your deployed apps</p>
          </div>
        </div>
      </header>

      {!firebaseEnabled ? (
        <GateState
          icon={Lock}
          title="Not available in self-hosted mode"
          description="Analytics tracks apps deployed to a public URL, which needs the hosted (Firebase) setup."
        />
      ) : authStatus === 'loading' ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </div>
      ) : !isSignedIn ? (
        <GateState
          icon={LogIn}
          title="Sign in required"
          description="Sign in to view analytics for the apps you've deployed."
          action={
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl brand-gradient text-white text-sm font-semibold shadow-premium-sm hover:shadow-premium-md transition-all"
            >
              <LogIn size={15} />
              Sign in
            </button>
          }
        />
      ) : (
        <AnalyticsDashboard
          apps={myAnalyticsApps}
          appsLoading={appsLoading}
          selectedSlug={selectedSlug}
          onSelectApp={selectApp}
          range={range}
          onRangeChange={changeRange}
          stats={stats}
          statsLoading={statsLoading}
          error={error}
          activeVisitors={activeVisitors}
        />
      )}

      {isAuthModalOpen && <AuthModal onClose={() => setIsAuthModalOpen(false)} />}
    </div>
  );
}
