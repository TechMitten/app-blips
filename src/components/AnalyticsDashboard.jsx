import { Eye, Users, MousePointerClick, Timer, Loader2, TriangleAlert, Globe, FileText, Link2, TrendingUp, LogIn } from 'lucide-react';

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

// Umami's `country` metric returns ISO 3166-1 alpha-2 codes (e.g. "US"). A
// flag emoji is just the two matching Unicode regional-indicator symbols --
// no icon set or image asset needed -- and Intl.DisplayNames (built into
// every evergreen browser) turns the code into a human-readable name.
const countryFlag = (code) => {
  if (typeof code !== 'string' || code.length !== 2) return '\u{1F310}'; // globe -- unknown/unresolved
  const points = [...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
};

let regionDisplayNames;
const countryName = (code) => {
  if (typeof code !== 'string' || code.length !== 2) return 'Unknown';
  try {
    regionDisplayNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionDisplayNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
};

// Pulsing dot + live count, independent of the date-range selector (Umami's
// /active endpoint is always "visitors in the last 5 minutes").
function LiveBadge({ count }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold shrink-0">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      {count == null ? 'Live' : `${formatNumber(count)} online now`}
    </span>
  );
}

function StatTile({ icon, label, value }) {
  const Icon = icon;
  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-surface px-4 py-3.5 shadow-2xs">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon size={13} strokeWidth={2.25} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{value}</div>
    </div>
  );
}

// Small hand-rolled line chart -- no charting dependency in this repo, and a
// few dozen points don't need one.
function PageviewsChart({ series }) {
  const points = Array.isArray(series) ? series : [];
  if (points.length < 2) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2 text-slate-300">
        <TrendingUp size={22} strokeWidth={1.75} />
        <span className="text-xs font-medium text-slate-400">Not enough data yet</span>
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

function TopList({ icon, title, rows, emptyLabel, renderLabel }) {
  const Icon = icon;
  const items = Array.isArray(rows) ? rows.slice(0, 6) : [];
  const max = Math.max(...items.map((r) => Number(r.y) || 0), 1);
  const label = renderLabel || ((row) => row.x || '(direct)');

  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-surface p-4 shadow-2xs">
      <div className="flex items-center gap-1.5 text-slate-400 mb-3">
        <Icon size={13} strokeWidth={2.25} />
        <span className="text-[11px] font-bold uppercase tracking-wider">{title}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((row, i) => (
            <div key={`${row.x}-${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-700 truncate">{label(row)}</span>
                <span className="text-slate-400 font-mono shrink-0 tabular-nums">{formatNumber(row.y)}</span>
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

// Analytics dashboard content: the user's opted-in deployed apps on the left,
// stats for the selected one on the right. Data comes from useAnalytics,
// which proxies to the self-hosted Umami instance via
// functions/_lib/umamiProxy.js -- this component only renders what it's
// handed. Layout-only (no page chrome/shell) so it can be dropped into
// src/pages/AnalyticsPage.jsx.
export default function AnalyticsDashboard({
  apps,
  appsLoading,
  selectedSlug,
  onSelectApp,
  range,
  onRangeChange,
  stats,
  statsLoading,
  error,
  activeVisitors,
}) {
  const selectedApp = apps.find((a) => a.slug === selectedSlug);
  const summary = stats?.summary;

  return (
    <div className="flex-1 overflow-hidden">
      <div className="h-full max-w-6xl mx-auto flex flex-col lg:flex-row gap-4 lg:gap-5 p-4 sm:p-6">
        {/* App list */}
        <div className="lg:w-64 shrink-0 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-surface shadow-2xs overflow-hidden flex flex-col max-h-52 lg:max-h-none">
          <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-200/70 dark:border-white/10 shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Your apps</span>
          </div>
          <div className="overflow-y-auto custom-scrollbar p-2.5 space-y-1 flex-1">
            {appsLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : apps.length === 0 ? (
              <div className="text-center py-8 px-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-2.5 text-indigo-500">
                  <Globe size={18} />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Enable analytics on a deployment to see it here.
                </p>
              </div>
            ) : (
              apps.map((app) => {
                const isActive = app.slug === selectedSlug;
                const initial = (app.name || app.slug || 'A').trim()[0]?.toUpperCase() || 'A';
                return (
                  <button
                    key={app.slug}
                    type="button"
                    onClick={() => onSelectApp(app.slug)}
                    className={`w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-xl text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-50/80 dark:bg-indigo-500/10 ring-1 ring-indigo-500/20'
                        : 'hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${
                      isActive ? 'brand-gradient text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-500'
                    }`}>
                      {initial}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-semibold ${isActive ? 'text-brand' : 'text-slate-700'}`}>
                        {app.name || app.slug}
                      </span>
                      <span className="block text-[11px] text-slate-400 truncate font-mono">{app.slug}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-sm text-rose-700 flex items-start gap-3">
              <TriangleAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!selectedSlug ? (
            <div className="h-full flex items-center justify-center py-16 text-sm text-slate-400">
              Select an app to view its analytics.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-900 truncate">{selectedApp?.name || selectedSlug}</h2>
                    <LiveBadge count={activeVisitors} />
                  </div>
                  <p className="text-xs text-slate-400 font-mono truncate">{selectedSlug}</p>
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden shrink-0">
                  {RANGES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => onRangeChange(r.value)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        range === r.value ? 'brand-fill-text bg-brand text-white' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5'
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
                    <StatTile icon={Eye} label="Pageviews" value={formatNumber(metricValue(summary?.pageviews))} />
                    <StatTile icon={Users} label="Visitors" value={formatNumber(metricValue(summary?.visitors))} />
                    <StatTile icon={MousePointerClick} label="Visits" value={formatNumber(metricValue(summary?.visits))} />
                    <StatTile icon={Timer} label="Avg. duration" value={formatDuration(metricValue(summary?.totaltime) / Math.max(1, metricValue(summary?.visits)))} />
                  </div>

                  <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-surface p-4 shadow-2xs">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Pageviews over time</div>
                    <PageviewsChart series={stats?.pageviews?.pageviews || stats?.pageviews} />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <TopList
                      icon={LogIn}
                      title="Entrance pages"
                      rows={stats?.entryPages}
                      emptyLabel="No sessions yet."
                    />
                    <TopList
                      icon={Globe}
                      title="Top countries"
                      rows={stats?.countries}
                      emptyLabel="No visitors yet."
                      renderLabel={(row) => `${countryFlag(row.x)}  ${countryName(row.x)}`}
                    />
                    <TopList icon={FileText} title="Top pages" rows={stats?.urls} emptyLabel="No pages yet." />
                    <TopList icon={Link2} title="Top referrers" rows={stats?.referrers} emptyLabel="No referrers yet." />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
