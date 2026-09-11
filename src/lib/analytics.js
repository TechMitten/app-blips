import { firebaseEnabled } from '../firebase';

// Umami analytics for every deployed app and the hosted platform.
//
// Enabled ONLY in the hosted version (firebaseEnabled / SELF_HOSTED_MODE=false).
// Disabled in the self-hosted version (SELF_HOSTED_MODE=true or unset).
//
// The script tag is spliced in at deploy time only -- never into
// `generatedCode` itself -- so it stays out of the preview srcDoc, the code
// panel, downloads, and the clipboard, exactly like the preview bridge.
// It is added in two places (mirroring the PWA snippet's plumbing):
//   - `uploadDeploy` in deploy.js, before encryption, so password-protected
//     apps carry it once decrypted and document.write'n in.
//   - the "Unlock App" wrapper template in crypto.js, so the password screen
//     itself is tracked.
// functions/[[path]].js also injects it at serve time (deduped) so
// deployments uploaded before this existed are tracked as well.
export const UMAMI_SCRIPT_SRC = 'https://umami.techmitten.com/script.js';
export const UMAMI_WEBSITE_ID = 'ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3';

export const UMAMI_SCRIPT_TAG = firebaseEnabled
  ? `<script defer src="${UMAMI_SCRIPT_SRC}" data-website-id="${UMAMI_WEBSITE_ID}"></script>`
  : '';

// Session recorder: main AppBlips app only, never deployed apps.
//
// Intentionally NOT wired into injectAnalyticsSnippet/uploadDeploy/crypto.js's
// unlock wrapper -- those are the deployed-app path, and a recorder tag was
// previously removed from there (see functions/[[path]].js's oldRecorderRegex
// stripping, kept in place as a guard against it reappearing in old or
// re-uploaded deploys). It's only ever injected via umamiAnalyticsPlugin
// (vite.config.js) and initAnalytics below, both scoped to the SPA itself.
export const UMAMI_RECORDER_SRC = 'https://umami.techmitten.com/recorder.js';

// Splice the tag into the earliest sensible point in <head>/<html>/<body>,
// mirroring the insertion strategy in pwa.js's injectPwaSnippet (index-based,
// single insertion point, rest of the document untouched).
export const injectAnalyticsSnippet = (html) => {
  if (!firebaseEnabled || typeof html !== 'string' || !html) return html;
  // A user prompt can legitimately ask the model for umami tracking with this
  // same endpoint -- don't load it twice and double-count every event.
  if (html.includes('umami.techmitten.com/script.js')) return html;

  const insertAt = (index) => html.slice(0, index) + UMAMI_SCRIPT_TAG + html.slice(index);

  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    return insertAt(headMatch.index + headMatch[0].length);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    return insertAt(htmlMatch.index + htmlMatch[0].length);
  }

  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  if (bodyMatch) {
    return insertAt(bodyMatch.index + bodyMatch[0].length);
  }

  return UMAMI_SCRIPT_TAG + html;
};

// Initializes Umami analytics (+ session recorder) in the main AppBlips web
// app for hosted mode. Dedupes if either script was already injected by
// Vite's HTML transform.
export const initAnalytics = () => {
  if (!firebaseEnabled || typeof document === 'undefined') return;

  if (!document.querySelector(`script[src="${UMAMI_SCRIPT_SRC}"]`)) {
    const script = document.createElement('script');
    script.defer = true;
    script.src = UMAMI_SCRIPT_SRC;
    script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    document.head.appendChild(script);
  }

  if (!document.querySelector(`script[src="${UMAMI_RECORDER_SRC}"]`)) {
    const recorder = document.createElement('script');
    recorder.defer = true;
    recorder.src = UMAMI_RECORDER_SRC;
    recorder.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    document.head.appendChild(recorder);
  }
};
