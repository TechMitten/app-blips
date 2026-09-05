import { supabase } from '../supabase';
import { encryptApp } from './crypto';
import { injectPwaSnippet } from './pwa';
import { injectAnalyticsSnippet } from './analytics';
import { injectNoindexSnippet, injectFaviconSnippet } from './seo';

// --- Deployment ---
//
// The HTML lives as a single .html object in the public `orion-deploys` bucket,
// but it is NOT served from Supabase: every HTML GET on *.supabase.co comes back
// as `text/plain` with `CSP: default-src 'none'; sandbox` (Edge Functions get
// the same treatment as Storage), so such a link always shows source instead of
// a page. A Cloudflare Pages Function on APPS_ORIGIN reads the object and
// re-serves it with a real `text/html` content type -- see functions/[[path]].js.
//
// Two rules when touching this:
//
// 1. Deployed apps MUST stay on their own hostname. They are LLM-generated code
//    with full script privileges; on the AppBlips SPA's origin they could read
//    localStorage, which holds the user's LLM API key and Supabase session.
// 2. Only ever upload `generatedCode`. The preview bridge is spliced in at
//    render time and must stay out of anything that leaves the app -- a public
//    URL most of all.
export const DEPLOY_BUCKET = 'orion-deploys';
export const APPS_ORIGIN = 'https://my.appblips.com';

export const randomToken = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % 62]).join('');
};

// Storage object names stay opaque; only the public slug is human-readable.
export const makeStorageToken = () => randomToken(10);

export const deployObjectPath = (userId, token) => `${userId}/${token}.html`;

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

// Publishes the slug -> storage-object mapping the Pages Function reads. Slug is
// the primary key, so a collision with someone else's app is refused by RLS
// rather than silently stealing their link; retry with a longer tail.
export const registerDeployment = async ({ slug, userId, projectId, storagePath, name }) => {
  let candidate = slug;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.from('deployments').upsert(
      {
        slug: candidate,
        user_id: userId,
        project_id: String(projectId ?? ''),
        storage_path: storagePath,
        name: name || null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'slug' }
    );

    if (!error) return candidate;

    const taken = /duplicate key|row-level security|conflict|unauthorized/i.test(error.message || '');
    if (!taken || attempt === 2) {
      throw new Error(error.message || 'Failed to register the deploy link.');
    }
    candidate = `${slug}-${randomToken(3)}`;
  }

  throw new Error('Could not find a free deploy link. Try again.');
};

export const unregisterDeployment = async (slug) => {
  const { error } = await supabase.from('deployments').delete().eq('slug', slug);
  if (error) throw new Error(error.message || 'Failed to remove the deploy link.');
};

export const uploadDeploy = async ({ path, html, password, preventIndexing, favicon }) => {
  // Analytics goes in before encryption so a password-protected deploy still
  // carries it once decrypted and document.write'n in.
  let withExtras = injectAnalyticsSnippet(injectPwaSnippet(html));
  if (preventIndexing) {
    withExtras = injectNoindexSnippet(withExtras);
  }
  if (favicon) {
    withExtras = injectFaviconSnippet(withExtras, favicon);
  }
  const finalHtml = password ? await encryptApp(withExtras, password) : withExtras;

  const { error } = await supabase.storage
    .from(DEPLOY_BUCKET)
    .upload(path, new Blob([finalHtml], { type: 'text/html' }), {
      contentType: 'text/html; charset=utf-8',
      cacheControl: '60',
      upsert: true
    });

  if (error) {
    const message = error.message || '';
    if (/bucket not found/i.test(message)) {
      throw new Error("Deployment storage isn't set up for this project yet.");
    }
    // A genuine expired/invalid token -- signing in again actually helps.
    if (/jwt|token is expired|invalid claim/i.test(message)) {
      throw new Error('Your session expired. Sign in again to deploy.');
    }
    // An RLS rejection is a server misconfiguration, not a stale session.
    // Storage reports these as "Unauthorized" with a 400, so don't confuse the
    // two -- telling the user to sign in again would send them in circles.
    if (/row-level security|unauthorized/i.test(message)) {
      throw new Error(`Deployment was rejected by storage permissions. ${message}`);
    }
    if (/payload too large|exceeded the maximum|maximum allowed size/i.test(message)) {
      throw new Error('This app is too large to deploy (2 MB limit).');
    }
    if (/mime type|not supported/i.test(message)) {
      throw new Error(`Storage rejected the file type. ${message}`);
    }
    throw new Error(message || 'Failed to deploy.');
  }
};
