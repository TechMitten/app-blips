// Optional Umami analytics for every deployed app and the platform, configured
// by the operator at build time. Disabled unless both the script URL and the
// website ID are set (VITE_UMAMI_SCRIPT_URL / VITE_UMAMI_WEBSITE_ID).
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
export const UMAMI_SCRIPT_SRC = String(import.meta.env.VITE_UMAMI_SCRIPT_URL || '');
export const UMAMI_WEBSITE_ID = String(import.meta.env.VITE_UMAMI_WEBSITE_ID || '');
export const UMAMI_RECORDER_SRC = String(import.meta.env.VITE_UMAMI_RECORDER_URL || '');

const umamiEnabled = Boolean(UMAMI_SCRIPT_SRC && UMAMI_WEBSITE_ID);

export const UMAMI_SCRIPT_TAG = umamiEnabled
  ? `<script defer src="${UMAMI_SCRIPT_SRC}" data-website-id="${UMAMI_WEBSITE_ID}"></script>`
  : '';

// Splice the tag into the earliest sensible point in <head>/<html>/<body>,
// mirroring the insertion strategy in pwa.js's injectPwaSnippet (index-based,
// single insertion point, rest of the document untouched).
export const injectAnalyticsSnippet = (html) => {
  if (!umamiEnabled || typeof html !== 'string' || !html) return html;
  // A user prompt can legitimately ask the model for umami tracking with this
  // same endpoint -- don't load it twice and double-count every event.
  if (html.includes(UMAMI_SCRIPT_SRC)) return html;

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

// Initializes Umami analytics (+ session recorder, when configured) in the
// main AppBlips web app. Dedupes if either script was already injected by
// Vite's HTML transform.
export const initAnalytics = () => {
  if (!umamiEnabled || typeof document === 'undefined') return;

  if (!document.querySelector(`script[src="${UMAMI_SCRIPT_SRC}"]`)) {
    const script = document.createElement('script');
    script.defer = true;
    script.src = UMAMI_SCRIPT_SRC;
    script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    document.head.appendChild(script);
  }

  if (UMAMI_RECORDER_SRC && !document.querySelector(`script[src="${UMAMI_RECORDER_SRC}"]`)) {
    const recorder = document.createElement('script');
    recorder.defer = true;
    recorder.src = UMAMI_RECORDER_SRC;
    recorder.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    document.head.appendChild(recorder);
  }
};
