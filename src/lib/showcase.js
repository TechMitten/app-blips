// Showcase: a hand-picked list of projects built with AppBlips, shown in the
// Showcase view (components/showcase/). It replaced the community gallery, so
// there is no backend: the list below ships in the bundle and nothing here
// talks to Supabase. Pure (no React, no import.meta.env), so node tests
// (testing/testShowcase.js) can load it directly.
//
// To add a project, append an entry to SHOWCASE_PROJECTS:
//
//   {
//     id: 'pixel-pets',                     // a-z, 0-9 and dashes; the share link is /?showcase=pixel-pets
//     title: 'Pixel Pets',
//     description: 'A tiny virtual pet you feed, wash and play with.',
//     kind: 'game',                         // 'app' | 'website' | 'game'
//     url: 'https://my.appblips.com/you/pixel-pets', // the live, deployed project
//     thumbnail: '/showcase/pixel-pets.jpg', // optional; put the file in public/showcase/ (16:10 looks best)
//     device: 'mobile',                     // optional mockup: 'mobile' | 'tablet' | 'desktop' (default)
//     prompt: 'A virtual pet game where…',   // optional; the prompt that started it, shown with a copy button
//     source: '/showcase/pixel-pets.html',  // optional; enables Remix (see below)
//   },
//
// Projects show in the order listed. Entries that fail validation are dropped
// with a console warning rather than breaking the page.
//
// `source` lets visitors copy the project into their own workspace. It is
// either the project's single HTML file (download it from the code view) or,
// for a multi-page website, a JSON file shaped like
// `{ "files": { "index.html": "...", "about.html": "..." }, "studioMode": "website", "aiEnabled": false }`.
// Keep it clean generated code: no deploy-time snippets, no preview bridge.
import { LANDING_PAGE, validatePageName, checkFilesLimits } from './pages.js';

export const SHOWCASE_PROJECTS = [];

export const SHOWCASE_KINDS = ['app', 'website', 'game'];
export const SHOWCASE_DEVICES = ['mobile', 'tablet', 'desktop'];
export const KIND_LABELS = { app: 'App', website: 'Website', game: 'Game' };

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

// Same-site static file (`/showcase/x.jpg`) or an absolute http(s) URL.
const isAssetPath = (value) => typeof value === 'string' && (/^\/(?!\/)/.test(value) || isHttpUrl(value));

// Returns the entry with defaults filled in, or null (with the reason) when it
// can't be shown.
export const normalizeProject = (entry) => {
  if (!entry || typeof entry !== 'object') return { project: null, reason: 'not an object' };
  const { id, title, url } = entry;
  if (typeof id !== 'string' || !ID_RE.test(id)) return { project: null, reason: `bad id "${id}"` };
  if (typeof title !== 'string' || !title.trim()) return { project: null, reason: `"${id}" has no title` };
  if (typeof url !== 'string' || !isHttpUrl(url)) return { project: null, reason: `"${id}" needs an http(s) url` };
  for (const key of ['thumbnail', 'source']) {
    if (entry[key] != null && !isAssetPath(entry[key])) return { project: null, reason: `"${id}" has a bad ${key}` };
  }
  return {
    project: {
      id,
      title: title.trim(),
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      kind: SHOWCASE_KINDS.includes(entry.kind) ? entry.kind : 'app',
      url,
      thumbnail: entry.thumbnail || null,
      device: SHOWCASE_DEVICES.includes(entry.device) ? entry.device : 'desktop',
      prompt: typeof entry.prompt === 'string' ? entry.prompt.trim() : '',
      source: entry.source || null,
    },
    reason: null,
  };
};

export const normalizeProjects = (entries, warn = () => {}) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const { project, reason } = normalizeProject(entry);
    if (!project) { warn(`Showcase entry skipped: ${reason}.`); continue; }
    if (seen.has(project.id)) { warn(`Showcase entry skipped: duplicate id "${project.id}".`); continue; }
    seen.add(project.id);
    out.push(project);
  }
  return out;
};

export const showcaseProjects = normalizeProjects(SHOWCASE_PROJECTS, (msg) => console.warn(msg));

// Stable per-project gradient for cards without a thumbnail.
export const fallbackGradient = (seed = '') => {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 50) % 360} 80% 48%))`;
};

// --- Deep links: `?showcase` opens the list, `?showcase=<id>` one project. ---
// The retired gallery's `?gallery` / `?app=<id>` links land on the list.

export const parseShowcaseRoute = (search = '') => {
  const params = new URLSearchParams(search);
  if (params.has('showcase')) {
    const id = params.get('showcase');
    return { open: true, projectId: id && ID_RE.test(id) ? id : null };
  }
  return { open: params.has('gallery') || params.has('app'), projectId: null };
};

// Rewrites only the showcase params of `href` (dropping legacy gallery ones).
export const buildShowcaseHref = (href, { open, projectId }) => {
  const url = new URL(href);
  for (const key of ['showcase', 'gallery', 'app']) url.searchParams.delete(key);
  if (projectId) url.searchParams.set('showcase', projectId);
  else if (open) url.searchParams.set('showcase', '');
  // URLSearchParams writes `showcase=`; the bare flag reads better in a link.
  return url.toString().replace(/([?&])showcase=(?=&|$|#)/, '$1showcase');
};

export const showcaseShareUrl = (origin, projectId) => `${origin.replace(/\/+$/, '')}/?showcase=${projectId}`;

// --- Remix -----------------------------------------------------------------

// Checked as strictly as a project import even though the files are ours: a
// typo'd page name or an oversized site should fail here, not in the studio.
export const parseRemixSource = (project, body, isHtml) => {
  if (isHtml) {
    if (typeof body !== 'string' || !body.trim()) throw new Error('This project source is empty.');
    const files = { [LANDING_PAGE]: body };
    const limitError = checkFilesLimits(files);
    if (limitError) throw new Error(limitError);
    return { files, studioMode: project.kind, aiEnabled: false };
  }
  const files = body?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('This project source is invalid.');
  const clean = {};
  for (const [name, html] of Object.entries(files)) {
    if (!validatePageName(name) || typeof html !== 'string') throw new Error('This project source is invalid.');
    clean[name] = html;
  }
  if (!clean[LANDING_PAGE]) throw new Error('This project source is missing its landing page.');
  const limitError = checkFilesLimits(clean);
  if (limitError) throw new Error(limitError);
  return {
    files: clean,
    studioMode: SHOWCASE_KINDS.includes(body.studioMode) ? body.studioMode : project.kind,
    aiEnabled: Boolean(body.aiEnabled),
  };
};

export const fetchRemixSource = async (project) => {
  if (!project?.source) throw new Error('This project is not available for remixing.');
  const res = await fetch(project.source);
  if (!res.ok) throw new Error('Failed to download the project source.');
  const isHtml = /\.html?(?:[?#]|$)/i.test(project.source);
  return parseRemixSource(project, isHtml ? await res.text() : await res.json(), isHtml);
};
