// Umami analytics for every deployed app.
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
export const UMAMI_SCRIPT_TAG =
  '<script defer src="https://umami.techmitten.com/script.js" data-website-id="ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3"></script>';

// Splice the tag into the earliest sensible point in <head>/<html>/<body>,
// mirroring the insertion strategy in pwa.js's injectPwaSnippet (index-based,
// single insertion point, rest of the document untouched).
export const injectAnalyticsSnippet = (html) => {
  if (typeof html !== 'string' || !html) return html;
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
