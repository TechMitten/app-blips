import authProvider from './auth';
import { encryptApp } from './crypto';
import { injectPwaSnippet } from './pwa';
import { injectAnalyticsSnippet } from './analytics';
import { injectAppAnalyticsSnippet } from './appAnalytics';
import { injectNoindexSnippet, injectFaviconSnippet, DEFAULT_FAVICON_URL } from './seo';
import { injectRemixBadgeSnippet } from './remixBadge';
import { LANDING_PAGE, getLanding, mapPages, pageNames } from './pages';

// --- Deployment ---
//
// The browser builds each page's final HTML (snippets, and encryption for a
// password-protected app, so the password never leaves the browser) and sends
// it to POST /api/deploys, which stores it in a private R2 bucket and points
// the slug at it (functions/_lib/deploys.js). A Cloudflare Pages Function on
// APPS_ORIGIN serves it from there -- see functions/[[path]].js.
//
// Two rules when touching this:
//
// 1. Deployed apps MUST stay on their own hostname. They are LLM-generated code
//    with full script privileges; on the AppBlips SPA's origin they could read
//    localStorage and IndexedDB, which hold the user's LLM API key and
//    Firebase session.
// 2. Only ever upload `generatedCode`. The preview bridge is spliced in at
//    render time and must stay out of anything that leaves the app -- a public
//    URL most of all.
//
// The origin that serves deployed apps (functions/[[path]].js). Configured by
// the operator at build time; empty until a deploy host is set up.
export const APPS_ORIGIN = String(import.meta.env.VITE_APPS_ORIGIN || '').replace(/\/+$/, '');

export const randomToken = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % 62]).join('');
};

// `Daybook - Mood & Habit Journal` -> `daybook-mood-habit-journal-a7f3`. The
// random tail keeps slugs globally unique without letting one account squat on
// a plain name, and keeps other people's links unguessable.
export const slugifyName = (name) =>
  (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/([a-z0-9])\1{2,}/g, '$1')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

export const makePublicSlug = (projectName) => `${slugifyName(projectName) || 'app'}-${randomToken(6)}`;

export const deployUrlForSlug = (slug) => `${APPS_ORIGIN}/${slug}`;

const deployRequest = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${await authProvider.getIdToken()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Failed to deploy.');
    error.code = data.code || null;
    throw error;
  }
  return data;
};

// Builds every page of the site as it will be published: `landing` is the
// index page (with every page inside it, encrypted, for a password-protected
// multi-page site -- `bundled`), `pages` the other pages by filename.
export const buildDeployPages = async ({ files, password, preventIndexing, favicon, analyticsWebsiteId }) => {
  const deployFavicon = favicon || DEFAULT_FAVICON_URL;
  // Analytics goes in before encryption so a password-protected deploy still
  // carries it once decrypted and document.write'n in.
  const withExtras = (html) => {
    let out = injectRemixBadgeSnippet(injectAnalyticsSnippet(injectPwaSnippet(html)));
    if (analyticsWebsiteId) out = injectAppAnalyticsSnippet(out, analyticsWebsiteId);
    if (preventIndexing) out = injectNoindexSnippet(out);
    return injectFaviconSnippet(out, deployFavicon);
  };
  const built = mapPages(files, withExtras);
  const extraNames = pageNames(built).filter((n) => n !== LANDING_PAGE);
  const bundled = Boolean(password) && extraNames.length > 0;

  let landing = getLanding(built);
  if (password) landing = await encryptApp(bundled ? built : landing, password, deployFavicon);
  const pages = bundled ? {} : Object.fromEntries(extraNames.map((name) => [name, built[name]]));
  return { landing, pages, bundled };
};

// Publishes the built pages at `slug`. A slug already owned by someone else
// is refused by the server, so retry with a longer random tail; a redeploy
// keeps its own slug and never collides. Resolves to the server's
// { slug, path, pageObjects, updatedAt }.
export const publishDeployment = async ({ slug, ...fields }) => {
  let candidate = slug;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await deployRequest('POST', '/api/deploys', { slug: candidate, ...fields });
    } catch (error) {
      if (error.code !== 'taken') throw error;
      candidate = `${slug}-${randomToken(3)}`;
    }
  }
  throw new Error('Could not find a free deploy link. Try again.');
};

// Takes a project's public deployment fully offline (the link and the stored
// pages). Used on undeploy and when a project is deleted, so no orphaned
// public app outlives it. Already-gone counts as removed.
export const removeDeployment = async (deployment) => {
  if (!deployment?.slug) return;
  await deployRequest('DELETE', `/api/deploys?slug=${encodeURIComponent(deployment.slug)}`);
};
