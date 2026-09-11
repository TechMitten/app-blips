import { db, storage } from '../firebase';
import { doc, deleteDoc, runTransaction } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
import { encryptApp } from './crypto';
import { injectPwaSnippet } from './pwa';
import { injectAnalyticsSnippet } from './analytics';
import { injectAppAnalyticsSnippet } from './appAnalytics';
import { injectNoindexSnippet, injectFaviconSnippet, DEFAULT_FAVICON_URL } from './seo';
import { injectRemixBadgeSnippet } from './remixBadge';
import { injectAiBridge } from './aiBridge';

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

export const makeAiToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

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
export const registerDeployment = async ({
  slug, userId, projectId, storagePath, name, analyticsEnabled, analyticsWebsiteId, aiEnabled, aiToken
}) => {
  let candidate = slug;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'deployments', encodeURIComponent(candidate));
        const docSnap = await transaction.get(docRef);
        if (docSnap.exists() && docSnap.data().user_id !== userId) {
          throw new Error('taken');
        }
        transaction.set(docRef, {
          slug: candidate,
          user_id: userId,
          project_id: String(projectId ?? ''),
          storage_path: storagePath,
          name: name || null,
          analyticsEnabled: Boolean(analyticsEnabled),
          analyticsWebsiteId: analyticsWebsiteId || null,
          aiEnabled: Boolean(aiEnabled),
          // Public by design: this binds/rate-limits a real deployment; it is not a provider secret.
          aiToken: aiEnabled ? aiToken : null,
          updated_at: new Date().toISOString()
        });
      });
      return candidate;
    } catch (error) {
      if (error.message !== 'taken' && attempt === 2) {
        throw new Error(error.message || 'Failed to register the deploy link.');
      }
      candidate = `${slug}-${randomToken(3)}`;
    }
  }

  throw new Error('Could not find a free deploy link. Try again.');
};

export const unregisterDeployment = async (slug) => {
  try {
    await deleteDoc(doc(db, 'deployments', encodeURIComponent(slug)));
  } catch (error) {
    throw new Error(error.message || 'Failed to remove the deploy link.');
  }
};

export const uploadDeploy = async ({ path, html, password, preventIndexing, favicon, analyticsWebsiteId, aiEnabled, aiToken }) => {
  const deployFavicon = favicon || DEFAULT_FAVICON_URL;
  // Analytics goes in before encryption so a password-protected deploy still
  // carries it once decrypted and document.write'n in.
  let withExtras = injectRemixBadgeSnippet(injectAnalyticsSnippet(injectPwaSnippet(html)));
  if (aiEnabled) withExtras = injectAiBridge(withExtras, aiToken);
  if (analyticsWebsiteId) {
    withExtras = injectAppAnalyticsSnippet(withExtras, analyticsWebsiteId);
  }
  if (preventIndexing) {
    withExtras = injectNoindexSnippet(withExtras);
  }
  withExtras = injectFaviconSnippet(withExtras, deployFavicon);
  const finalHtml = password ? await encryptApp(withExtras, password, deployFavicon) : withExtras;

  try {
    const storageRef = ref(storage, `${DEPLOY_BUCKET}/${path}`);
    await uploadString(storageRef, finalHtml, 'raw', {
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'public, max-age=60'
    });
  } catch (error) {
    const message = error.message || '';
    if (/unauthorized/i.test(message)) {
      throw new Error(`Deployment was rejected by storage permissions. ${message}`);
    }
    throw new Error(message || 'Failed to deploy.');
  }
};
