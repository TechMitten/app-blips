import { useMemo, useState } from 'react';
import {
  BarChart3, X, Loader2, TriangleAlert, Globe, ArrowUp, ArrowDown,
  Monitor, Laptop, Smartphone, Tablet, AppWindow, ExternalLink, Activity,
} from 'lucide-react';
import Modal from './Modal';
import { deployUrlForSlug } from '../lib/deploy';

// Shared surface treatments. The modal card is already --color-surface, which
// in dark is the same #141414 as a nested bg-surface panel -- so inner cards
// lift with a translucent white wash instead (and recess on light, where the
// surface is white).
const CARD = 'rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.04]';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-500';

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

// Percent change vs. the previous period; null when there's no baseline.
const percentChange = (current, previous) => {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
};

// Small ▲/▼ pill. `neutral` skips the good/bad colouring (e.g. durations,
// where "up" isn't obviously good); `invert` flips it (bounce rate).
function DeltaChip({ change, invert = false, neutral = false }) {
  if (change == null || !Number.isFinite(change)) return null;
  const rounded = Math.round(Math.abs(change));
  if (rounded === 0) {
    return <span className="text-[11px] font-medium text-slate-400">—</span>;
  }
  const up = change > 0;
  const good = invert ? !up : up;
  const tone = neutral
    ? 'text-slate-500 bg-slate-500/10'
    : good
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
      : 'text-rose-600 dark:text-rose-400 bg-rose-500/10';
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${tone}`}>
      <Icon size={10} strokeWidth={3} />
      {rounded}%
    </span>
  );
}

function StatTile({ label, value, change, invert, neutral }) {
  return (
    <div className={`${CARD} px-4 py-3.5`}>
      <div className={`${SECTION_LABEL} truncate`} title={label}>{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="whitespace-nowrap text-2xl font-bold leading-none tracking-tight text-slate-900 tabular-nums">{value}</span>
        <DeltaChip change={change} invert={invert} neutral={neutral} />
      </div>
    </div>
  );
}

// The app's segmented-control idiom (see styles/app/buttons.css), reused here
// so the range / pages / tech switchers match the rest of the chrome instead
// of each rolling their own bordered button row.
function Segmented({ options, value, onChange, label, compact = false }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`nav-segmented-group shrink-0 ${compact ? 'nav-segmented-compact' : ''}`}
    >
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          type="button"
          onClick={() => onChange(optionValue)}
          aria-pressed={value === optionValue}
          className={`nav-segmented-btn ${value === optionValue ? 'nav-segmented-btn-active' : ''}`}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

// ISO 3166-1 alpha-2 -> display name. Flags are rendered as images (see
// TopList) because Windows browsers don't draw flag emoji -- they fall back
// to the bare letters ("US").
const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;
const withCountry = (rows) => (Array.isArray(rows) ? rows.map((r) => {
  const valid = typeof r.x === 'string' && /^[A-Za-z]{2}$/.test(r.x);
  const code = valid ? r.x.toLowerCase() : null;
  let name = r.x || 'Unknown';
  if (valid) {
    try { name = regionNames?.of(r.x.toUpperCase()) || r.x.toUpperCase(); } catch { name = r.x.toUpperCase(); }
  }
  return { ...r, x: name, flag: code };
}) : rows);

// Umami reports lowercase slugs ("chrome", "edge-chromium", "mac-os", "ios").
const TECH_NAMES = {
  'edge-chromium': 'Edge', edge: 'Edge', ios: 'iOS', 'chromium-webview': 'WebView', crios: 'Chrome (iOS)',
  fxios: 'Firefox (iOS)', 'mac-os': 'macOS', 'mac os': 'macOS', macos: 'macOS', 'windows-10': 'Windows 10',
  'windows-11': 'Windows 11', 'chrome-os': 'ChromeOS', 'android-os': 'Android',
};
const titleCase = (s) => {
  if (typeof s !== 'string' || !s) return 'Unknown';
  const key = s.toLowerCase();
  if (TECH_NAMES[key]) return TECH_NAMES[key];
  return key.split(/[-\s]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
};

// Brand icons come from Simple Icons (brand colour). Marks whose brand colour
// is black get `dark:invert` so they stay visible on the dark theme. Anything
// unknown, or that fails to load, falls back to a generic lucide icon.
const BRAND_ICON_SLUGS = {
  chrome: 'googlechrome', 'chromium-webview': 'googlechrome', crios: 'googlechrome', firefox: 'firefox', fxios: 'firefox',
  safari: 'safari', ios: 'apple', 'mac-os': 'apple', 'mac os': 'apple', macos: 'apple',
  edge: 'microsoftedge', 'edge-chromium': 'microsoftedge', 'edge-ios': 'microsoftedge', opera: 'opera',
  samsung: 'samsung', android: 'android', 'android-os': 'android', linux: 'linux', ubuntu: 'ubuntu',
  'chrome-os': 'googlechrome', 'windows-10': 'windows11', 'windows-11': 'windows11', 'windows 10': 'windows11',
  'windows 7': 'windows', 'windows 8.1': 'windows', 'windows xp': 'windows', 'windows vista': 'windows',
  'windows-7': 'windows', 'windows-8.1': 'windows', brave: 'brave', 'duckduckgo': 'duckduckgo',
};
const INVERT_IN_DARK = new Set(['apple', 'ubuntu']);
const DEVICE_ICONS = { desktop: Monitor, laptop: Laptop, mobile: Smartphone, tablet: Tablet };

function TechIcon({ kind, raw }) {
  const [failed, setFailed] = useState(false);
  const key = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (kind === 'devices') {
    const Icon = DEVICE_ICONS[key] || Monitor;
    return <Icon size={14} className="shrink-0 text-slate-400" />;
  }
  const slug = BRAND_ICON_SLUGS[key];
  if (!slug || failed) {
    const Fallback = kind === 'browsers' ? Globe : AppWindow;
    return <Fallback size={14} className="shrink-0 text-slate-400" />;
  }
  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      className={`h-3.5 w-3.5 shrink-0 ${INVERT_IN_DARK.has(slug) ? 'dark:invert' : ''}`}
      onError={() => setFailed(true)}
    />
  );
}

const withTechIcon = (rows, kind) => (Array.isArray(rows)
  ? rows.map((r) => ({ ...r, x: titleCase(r.x), icon: <TechIcon kind={kind} raw={r.x} /> }))
  : rows);

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const bucketMs = (unit) => (unit === 'hour' ? HOUR_MS : DAY_MS);

// Day buckets are UTC-stamped midnights, so they're formatted in UTC or they
// slide a day for anyone west of Greenwich. Hour buckets are instants and get
// shown on the viewer's own clock.
const formatBucketShort = (ms, unit) => (unit === 'hour'
  ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric' })
  : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }));

const formatBucketLong = (ms, unit) => (unit === 'hour'
  ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  : new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }));

// Umami day buckets come back as "2026-09-19 00:00:00" with no zone marker.
// Normalise to an explicit UTC instant so every browser reads them the same
// way (Safari rejects the space form outright, Chrome assumes local time).
const parseBucketTime = (x) => {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  const raw = String(x).trim();
  if (!raw) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : ms;
};

// Umami only returns buckets that have data, so a 30-day range with traffic on
// two days comes back as two points -- which plots as a meaningless two-point
// line. Re-expand it to one point per bucket (day, or hour for the Today
// range) across the requested window so the chart reads as an actual
// timeline. Falls back to the raw series if the bucket timestamps can't be
// parsed or none of them land inside the window.
const buildTimeline = (series, startAt, endAt, unit) => {
  const raw = Array.isArray(series) ? series : [];
  const fallback = raw.map((p) => ({ t: parseBucketTime(p.x), y: Number(p.y) || 0 }));
  if (!raw.length || !startAt || !endAt) return fallback;
  if (fallback.some((p) => p.t == null)) return fallback;

  const step = bucketMs(unit);
  const bucketStart = (ms) => Math.floor(ms / step) * step;
  const byBucket = new Map();
  fallback.forEach((p) => {
    const key = bucketStart(p.t);
    byBucket.set(key, (byBucket.get(key) || 0) + p.y);
  });

  const filled = [];
  for (let t = bucketStart(startAt); t <= bucketStart(endAt); t += step) {
    filled.push({ t, y: byBucket.get(t) || 0 });
  }
  const matched = filled.filter((p) => byBucket.has(p.t)).length;
  if (!matched) return fallback;
  // A range that has only just opened (Today, shortly after midnight) can
  // yield a single bucket; duplicate it so there's a segment to draw.
  return filled.length === 1 ? [filled[0], { ...filled[0] }] : filled;
};

function ChartEmptyState({ label }) {
  return (
    <div className="flex h-44 flex-col items-center justify-center gap-2 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5">
        <Activity size={16} className="text-slate-400" />
      </span>
      <p className="text-sm font-medium text-slate-600">No pageviews {label}</p>
      <p className="max-w-[16rem] text-xs text-slate-400">
        Traffic shows up here within a minute of someone opening your app.
      </p>
    </div>
  );
}

// Small hand-rolled area chart -- no charting dependency in this repo, and a
// few dozen points don't need one. Pointer tracking (not mouse) so the
// tooltip works under touch as well.
function PageviewsChart({ series, startAt, endAt, unit, emptyLabel }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const points = useMemo(() => buildTimeline(series, startAt, endAt, unit), [series, startAt, endAt, unit]);
  const total = points.reduce((sum, p) => sum + p.y, 0);

  if (points.length < 2 || total === 0) return <ChartEmptyState label={emptyLabel} />;

  const width = 600;
  const height = 168;
  const padding = 10;
  const values = points.map((p) => p.y);
  const max = Math.max(...values, 1);

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - (p.y / max) * (height - padding * 2);
    return [x, y];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height - padding} L${coords[0][0].toFixed(1)},${height - padding} Z`;
  const gridYs = [padding, height / 2, height - padding];

  const handlePointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.min(points.length - 1, Math.max(0, index)));
  };

  const axisStart = points[0].t ?? startAt ?? null;
  const axisEnd = points[points.length - 1].t ?? endAt ?? null;
  const hovered = hoverIndex == null ? null : points[hoverIndex];
  const hoverLeft = hoverIndex == null ? 0 : (coords[hoverIndex][0] / width) * 100;
  const hoverTop = hoverIndex == null ? 0 : (coords[hoverIndex][1] / height) * 100;

  return (
    <div>
      <div className="flex items-stretch gap-2">
        {/* Fixed-width axis gutter: the svg is x-stretched (preserveAspectRatio
            "none"), so labels inside it would distort. py matches the chart's
            10-unit padding at the h-44 render size. */}
        <div className="flex h-44 w-8 shrink-0 flex-col justify-between py-[5px] text-right text-[10px] font-medium leading-[10px] text-slate-400 tabular-nums">
          <span>{formatNumber(max)}</span>
          <span>{formatNumber(max / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="relative min-w-0 flex-1 touch-pan-y"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setHoverIndex(null)}
        >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-44 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label={axisStart != null && axisEnd != null
            ? `${formatNumber(total)} pageviews between ${formatBucketLong(axisStart, unit)} and ${formatBucketLong(axisEnd, unit)}`
            : `${formatNumber(total)} pageviews over the selected range`}
        >
          <defs>
            <linearGradient id="pageviews-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {gridYs.map((y) => (
            <line
              key={y}
              x1="0"
              x2={width}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeDasharray="3 4"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              className="text-slate-300 dark:text-white/10"
            />
          ))}
          <path d={areaPath} fill="url(#pageviews-fill)" />
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hoverIndex != null && (
            <line
              x1={coords[hoverIndex][0]}
              x2={coords[hoverIndex][0]}
              y1={padding}
              y2={height - padding}
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              className="text-slate-400 dark:text-white/25"
            />
          )}
        </svg>

        {hovered && (
          <>
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand"
              style={{ left: `${hoverLeft}%`, top: `${hoverTop}%` }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5 text-center shadow-lg dark:border-white/10"
              style={{ left: `${Math.min(88, Math.max(12, hoverLeft))}%`, top: `${hoverTop}%`, marginTop: '-0.6rem' }}
            >
              <div className="text-sm font-bold leading-none text-slate-900 tabular-nums">{formatNumber(hovered.y)}</div>
              <div className="mt-1 text-[10px] font-medium text-slate-400">
                {hovered.t != null ? formatBucketLong(hovered.t, unit) : 'pageviews'}
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      {axisStart != null && axisEnd != null && (
        <div className="ml-10 mt-2 flex justify-between text-[10px] font-medium text-slate-400">
          <span>{formatBucketShort(axisStart, unit)}</span>
          <span>{formatBucketShort(axisEnd, unit)}</span>
        </div>
      )}
    </div>
  );
}

// Plausible-style rows: the share bar sits BEHIND the label rather than on its
// own line below it, so each entry is one scannable line and six of them fit
// in the same height the old two-line rows needed for three.
function TopList({ title, rows, action, emptyText = 'No data yet.', limit = 6 }) {
  const all = Array.isArray(rows) ? rows : [];
  const items = all.slice(0, limit);
  const max = Math.max(...items.map((r) => Number(r.y) || 0), 1);
  const total = all.reduce((sum, r) => sum + (Number(r.y) || 0), 0);

  return (
    <div className={`${CARD} flex flex-col p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className={SECTION_LABEL}>{title}</h4>
        {action}
      </div>
      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((row, i) => {
            const value = Number(row.y) || 0;
            const share = total > 0 ? Math.round((value / total) * 100) : 0;
            return (
              <li
                key={`${row.x}-${i}`}
                className="relative flex items-center justify-between gap-3 overflow-hidden rounded-lg px-2 py-1.5 text-xs"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-lg bg-brand/10 dark:bg-brand/15"
                  style={{ width: `${Math.max(3, (value / max) * 100)}%` }}
                  aria-hidden="true"
                />
                <span className="relative flex min-w-0 items-center gap-2 font-medium text-slate-700">
                  {row.icon}
                  {row.flag && (
                    <img
                      src={`https://flagcdn.com/w40/${row.flag}.png`}
                      alt=""
                      width={16}
                      height={12}
                      loading="lazy"
                      className="h-3 w-4 shrink-0 rounded-[2px] object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <span className="truncate" title={row.x || '(direct)'}>{row.x || '(direct)'}</span>
                </span>
                <span className="relative flex shrink-0 items-center gap-2 tabular-nums">
                  <span className="font-semibold text-slate-800">{formatNumber(value)}</span>
                  <span className="w-8 text-right text-[11px] text-slate-400">{share}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {all.length > limit && (
        <p className="mt-2 text-[11px] text-slate-400">+{all.length - limit} more</p>
      )}
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-100 dark:bg-white/5 ${className}`} />;
}

function StatsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}
      </div>
      <Skeleton className="h-64" />
      <div className="grid gap-2.5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
      </div>
    </div>
  );
}

// `total` completes "<n> ...", `compare` completes "change vs. ...".
const RANGES = [
  { value: 'today', label: 'Today', total: 'today', compare: 'the same hours yesterday' },
  { value: '7d', label: '7 days', total: 'in the last 7 days', compare: 'the previous 7 days' },
  { value: '30d', label: '30 days', total: 'in the last 30 days', compare: 'the previous 30 days' },
  { value: '90d', label: '90 days', total: 'in the last 90 days', compare: 'the previous 90 days' },
];
const DEFAULT_RANGE = RANGES[2];

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
  activeVisitors,
  onClose,
}) {
  const [pagesView, setPagesView] = useState('all');
  const [techView, setTechView] = useState('devices');
  const selectedApp = apps.find((a) => a.slug === selectedSlug);
  const summary = stats?.summary;
  const prev = stats?.previous;
  const pageviews = metricValue(summary?.pageviews);
  const visitors = metricValue(summary?.visitors);
  const visits = metricValue(summary?.visits);
  const avgDuration = metricValue(summary?.totaltime) / Math.max(1, visits);
  const prevAvgDuration = prev ? metricValue(prev.totaltime) / Math.max(1, metricValue(prev.visits)) : null;
  // Bounce rate is derived; hidden when the instance doesn't report bounces.
  const rate = (s) => (s && s.bounces != null && metricValue(s.visits) > 0 ? (metricValue(s.bounces) / metricValue(s.visits)) * 100 : null);
  const bounceRate = rate(summary);
  const prevBounceRate = rate(prev);
  const activeRange = RANGES.find((r) => r.value === range) || DEFAULT_RANGE;

  const tiles = [
    { label: 'Pageviews', value: formatNumber(pageviews), change: percentChange(pageviews, prev && metricValue(prev.pageviews)) },
    { label: 'Visitors', value: formatNumber(visitors), change: percentChange(visitors, prev && metricValue(prev.visitors)) },
    { label: 'Visits', value: formatNumber(visits), change: percentChange(visits, prev && metricValue(prev.visits)) },
    ...(bounceRate != null ? [{
      label: 'Bounce rate',
      value: `${Math.round(bounceRate)}%`,
      change: prevBounceRate != null ? bounceRate - prevBounceRate : null,
      invert: true,
    }] : []),
    { label: 'Avg. visit', value: formatDuration(avgDuration), change: percentChange(avgDuration, prevAvgDuration), neutral: true },
  ];

  return (
    <Modal
      zIndex={60}
      scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in"
      cardClass="w-full max-w-6xl bg-surface rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[90vh] animate-scale-in"
      cardProps={{ onClick: (e) => e.stopPropagation() }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 bg-slate-50/60 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20 brand-gradient">
            <BarChart3 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Analytics</h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Stats for the apps you&apos;ve enabled analytics on.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        {/* App list -- a recessed rail on desktop, a horizontal strip on mobile
            (a stacked list there ate a third of the sheet before any stats). */}
        <aside className="flex min-h-0 shrink-0 flex-col border-b border-slate-200 bg-slate-50/80 dark:border-white/10 dark:bg-black/20 sm:w-56 sm:border-b-0 sm:border-r lg:w-64">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
            <h3 className={SECTION_LABEL}>Your apps</h3>
            {apps.length > 0 && (
              <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 dark:bg-white/10">
                {apps.length}
              </span>
            )}
          </div>
          <div className="custom-scrollbar flex min-h-0 flex-1 gap-1.5 overflow-x-auto px-3 pb-3 sm:flex-col sm:gap-1 sm:overflow-x-visible sm:overflow-y-auto">
            {appsLoading ? (
              <div className="flex w-full items-center justify-center py-8 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : apps.length === 0 ? (
              <div className="w-full px-3 py-6 text-center">
                <Globe size={22} className="mx-auto mb-2 text-slate-300" />
                <p className="text-xs leading-relaxed text-slate-500">
                  Enable analytics on a deployment to see it here.
                </p>
              </div>
            ) : (
              apps.map((app) => {
                const isActive = app.slug === selectedSlug;
                return (
                  <button
                    key={app.slug}
                    type="button"
                    onClick={() => onSelectApp(app.slug)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`relative w-44 shrink-0 rounded-xl px-3 py-2.5 text-left text-sm transition-colors sm:w-full ${
                      isActive
                        ? 'bg-brand/10 font-semibold text-brand'
                        : 'text-slate-600 hover:bg-slate-200/60 dark:hover:bg-white/5'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" aria-hidden="true" />
                    )}
                    <span className="block truncate">{app.name || app.slug}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] font-normal text-slate-400">{app.slug}</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Detail pane */}
        <div className="custom-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {!selectedSlug ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
              <BarChart3 size={24} className="text-slate-300" />
              <p className="text-sm text-slate-500">Select an app to view its analytics.</p>
            </div>
          ) : (
            <>
              {/* Sticky so the app you're looking at and the range it covers
                  stay on screen while the stats scroll under them. */}
              <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-surface/95 px-5 py-3.5 backdrop-blur dark:border-white/10 sm:px-6">
                <div className="flex min-w-0 items-center gap-2.5">
                  <h3 className="truncate text-base font-bold tracking-tight text-slate-900">{selectedApp?.name || selectedSlug}</h3>
                  <a
                    href={deployUrlForSlug(selectedSlug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5"
                    title="Open the live app"
                    aria-label="Open the live app in a new tab"
                  >
                    <ExternalLink size={14} />
                  </a>
                  {typeof activeVisitors === 'number' && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                      title="Visitors active in the last 5 minutes"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        {activeVisitors > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
                        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${activeVisitors > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      </span>
                      {activeVisitors} online
                    </span>
                  )}
                </div>
                <Segmented
                  options={RANGES.map((r) => [r.value, r.label])}
                  value={range}
                  onChange={onRangeChange}
                  label="Date range"
                  compact
                />
              </div>

              <div className="space-y-4 p-5 sm:p-6">
                {error && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-700">
                    <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                {statsLoading && !stats ? (
                  <StatsSkeleton />
                ) : (
                  // Keep the previous range's content mounted while a new range
                  // loads (dimmed) so the modal doesn't collapse to a spinner.
                  <div
                    className={`space-y-4 transition-opacity ${statsLoading ? 'pointer-events-none opacity-50' : ''}`}
                    aria-busy={statsLoading}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className={SECTION_LABEL}>Overview</h4>
                      {prev && (
                        <span className="text-[11px] text-slate-400">change vs. {activeRange.compare}</span>
                      )}
                    </div>

                    <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 ${tiles.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
                      {tiles.map((tile) => <StatTile key={tile.label} {...tile} />)}
                    </div>

                    <div className={`${CARD} p-4 sm:p-5`}>
                      <div className="mb-4 flex items-baseline justify-between gap-3">
                        <h4 className={SECTION_LABEL}>Pageviews</h4>
                        <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                          {formatNumber(pageviews)} {activeRange.total}
                        </span>
                      </div>
                      <PageviewsChart
                        series={stats?.pageviews?.pageviews || stats?.pageviews}
                        startAt={stats?.startAt}
                        endAt={stats?.endAt}
                        unit={stats?.unit}
                        emptyLabel={activeRange.value === 'today' ? 'today' : 'in this range'}
                      />
                    </div>

                    <div className="grid gap-2.5 lg:grid-cols-2">
                      <TopList
                        title={pagesView === 'entry' ? 'Entry pages' : 'Top pages'}
                        rows={pagesView === 'entry' ? stats?.entryPages : stats?.urls}
                        emptyText="No pages viewed yet."
                        action={(
                          <Segmented
                            options={[['all', 'All'], ['entry', 'Entry']]}
                            value={pagesView}
                            onChange={setPagesView}
                            label="Page metric"
                            compact
                          />
                        )}
                      />
                      <TopList
                        title="Top referrers"
                        rows={stats?.referrers}
                        emptyText="No referrers yet — visitors arrived directly."
                      />
                      <TopList
                        title="Countries"
                        rows={withCountry(stats?.countries)}
                        emptyText="No location data yet."
                      />
                      <TopList
                        title={{ devices: 'Devices', browsers: 'Browsers', os: 'Operating systems' }[techView]}
                        rows={withTechIcon(stats?.[techView], techView)}
                        emptyText="No device data yet."
                        action={(
                          <Segmented
                            options={[['devices', 'Device'], ['browsers', 'Browser'], ['os', 'OS']]}
                            value={techView}
                            onChange={setTechView}
                            label="Technology metric"
                            compact
                          />
                        )}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
