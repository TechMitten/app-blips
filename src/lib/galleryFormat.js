// Pure gallery helpers: number/time formatting, generated avatars, and the
// `?gallery` / `?app=<id>` deep-link format. No Supabase or React imports, so
// node tests (testing/testGallery.js) can load this directly.

export const GALLERY_SORTS = ['hot', 'new', 'top', 'mine'];
export const COMMENT_MAX = 1000;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 500;

// 950 -> "950", 1234 -> "1.2k", 45000 -> "45k", 2_100_000 -> "2.1M".
export const formatCount = (value) => {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1000) return String(Math.floor(n));
  const [div, suffix] = n < 1e6 ? [1e3, 'k'] : [1e6, 'M'];
  const scaled = n / div;
  // Floors, so a count is never overstated (999_999 -> "999k").
  const rounded = scaled < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled);
  return `${String(rounded).replace(/\.0$/, '')}${suffix}`;
};

const UNITS = [
  ['y', 365 * 24 * 3600], ['mo', 30 * 24 * 3600], ['w', 7 * 24 * 3600],
  ['d', 24 * 3600], ['h', 3600], ['m', 60],
];

// Compact relative time: "just now", "5m", "3h", "2d", "4w", "1y" (+ " ago").
export const timeAgo = (value, now = Date.now()) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  const seconds = Math.max(0, Math.floor((now - t) / 1000));
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
};

// Mirrors gallery_feed's "hot" ordering (supabase/migrations/*_gallery.sql).
export const hotScore = ({ likes_count = 0, comments_count = 0, views_count = 0, created_at }, now = Date.now()) => {
  const ageHours = Math.max(0, (now - new Date(created_at).getTime()) / 3600000);
  return (likes_count * 3 + comments_count * 2 + views_count * 0.05 + 1) / Math.pow(ageHours + 2, 1.5);
};

// Stable per-username gradient for the generated avatar (there are no uploaded
// avatars). Hue pairs stay saturated enough to read in both themes.
export const avatarGradient = (username = '') => {
  let hash = 0;
  for (const ch of username) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 50) % 360} 80% 48%))`;
};

export const avatarInitial = (username = '') => (username.trim()[0] || '?').toUpperCase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `?gallery` opens the gallery, `?app=<uuid>` opens it on one post. Anything
// else (including a malformed id) is "closed".
export const parseGalleryRoute = (search = '') => {
  const params = new URLSearchParams(search);
  const postId = params.get('app');
  if (postId && UUID_RE.test(postId)) return { open: true, postId: postId.toLowerCase() };
  return { open: params.has('gallery'), postId: null };
};

// Rewrites only the gallery params of `href`, keeping everything else.
export const buildGalleryHref = (href, { open, postId }) => {
  const url = new URL(href);
  url.searchParams.delete('gallery');
  url.searchParams.delete('app');
  if (postId) url.searchParams.set('app', postId);
  else if (open) url.searchParams.set('gallery', '');
  // URLSearchParams writes `gallery=`; the bare flag reads better in a link.
  return url.toString().replace(/([?&])gallery=(?=&|$|#)/, '$1gallery');
};

export const galleryShareUrl = (origin, postId) => `${origin.replace(/\/+$/, '')}/?app=${postId}`;
