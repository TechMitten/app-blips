import { BarChart3, X, Loader2, TriangleAlert, Globe } from 'lucide-react';
import Modal from './Modal';

// Read a Umami summary metric whether it comes back as `{value}` or a bare
// number -- kept defensive since the exact self-hosted response shape wasn't
// fully pinned down during planning.
const metricValue = (metric) => {
  if (metric == null) return 0;
  if (typeof metric === 'number') return metric;
  return metric.value ?? 0;
};

const formatNumber = (n) => new Intl.NumberFormat().format(Math.round(n || 0));

const formatDuration = (seconds) => {
  const s = Math.round(seconds || 0);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

// Small hand-rolled line chart -- no charting dependency in this repo, and a
// few dozen points don't need one.
function PageviewsChart({ series }) {
  const points = Array.isArray(series) ? series : [];
  if (points.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-slate-400">
        Not enough data yet.
      </div>
    );
  }

  const width = 600;
  const height = 160;
  const padding = 8;
  const values = points.map((p) => Number(p.y) || 0);
  const max = Math.max(...values, 1);

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - (values[i] / max) * (height - padding * 2);
    return [x, y];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height - padding} L${coords[0][0].toFixed(1)},${height - padding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40" preserveAspectRatio="none" role="img" aria-label="Pageviews over time">
      <path d={areaPath} fill="var(--color-brand, #6366f1)" opacity="0.08" />
      <path d={linePath} fill="none" stroke="var(--color-brand, #6366f1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TopList({ title, rows }) {
  const items = Array.isArray(rows) ? rows.slice(0, 6) : [];
  const max = Math.max(...items.map((r) => Number(r.y) || 0), 1);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-surface p-4">
      <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">No data yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((row, i) => (
            <div key={`${row.x}-${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-700 truncate">{row.x || '(direct)'}</span>
                <span className="text-slate-400 font-mono shrink-0">{formatNumber(row.y)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(4, (Number(row.y) / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

// Analytics dashboard: the user's opted-in deployed apps on the left, stats
// for the selected one on the right. Data comes from useAnalytics, which
// proxies to the self-hosted Umami instance via functions/_lib/umamiProxy.js
// -- this component only renders what it's handed.
export default function AnalyticsDashboardModal({
  apps,
  appsLoading,
  selectedSlug,
  onSelectApp,
  range,
  onRangeChange,
  stats,
  statsLoading,
  error,
  onClose,
}) {
  const selectedApp = apps.find((a) => a.slug === selectedSlug);
  const summary = stats?.summary;

  return (
    <Modal
      zIndex={60}
      scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in"
      cardClass="w-full max-w-5xl bg-surface rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[88vh] animate-scale-in"
      cardProps={{ onClick: (e) => e.stopPropagation() }}
    >
      <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex items-center justify-between gap-4 bg-slate-50/60">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 brand-gradient rounded-2xl flex items-center justify-center text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20">
            <BarChart3 size={20} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Analytics</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Stats for the apps you've enabled analytics on.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-200/70 transition-colors shrink-0"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col sm:flex-row min-h-0">
        {/* App list */}
        <div className="sm:w-64 shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-white/10 overflow-y-auto custom-scrollbar p-3 space-y-1">
          {appsLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : apps.length === 0 ? (
            <div className="text-center py-8 px-3">
              <Globe size={22} className="text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Enable analytics on a deployment to see it here.
              </p>
            </div>
          ) : (
            apps.map((app) => (
              <button
                key={app.slug}
                type="button"
                onClick={() => onSelectApp(app.slug)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  app.slug === selectedSlug
                    ? 'bg-brand/10 text-brand font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="truncate">{app.name || app.slug}</div>
                <div className="text-[11px] text-slate-400 truncate font-mono">{app.slug}</div>
              </button>
            ))
          )}
        </div>

        {/* Detail pane */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-sm text-rose-700 flex items-start gap-3">
              <TriangleAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!selectedSlug ? (
            <div className="text-center py-16 text-sm text-slate-400">
              Select an app to view its analytics.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900 truncate">{selectedApp?.name || selectedSlug}</h3>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                  {RANGES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => onRangeChange(r.value)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        range === r.value ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {statsLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatTile label="Pageviews" value={formatNumber(metricValue(summary?.pageviews))} />
                    <StatTile label="Visitors" value={formatNumber(metricValue(summary?.visitors))} />
                    <StatTile label="Visits" value={formatNumber(metricValue(summary?.visits))} />
                    <StatTile label="Avg. duration" value={formatDuration(metricValue(summary?.totaltime) / Math.max(1, metricValue(summary?.visits)))} />
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-surface p-4">
                    <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Pageviews over time</div>
                    <PageviewsChart series={stats?.pageviews?.pageviews || stats?.pageviews} />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <TopList title="Top pages" rows={stats?.urls} />
                    <TopList title="Top referrers" rows={stats?.referrers} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
