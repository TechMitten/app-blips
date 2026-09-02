// Makes every deployed app installable as a PWA.
//
// The manifest/service-worker URLs can't be baked in at deploy time -- the
// object is uploaded before its final slug is known (a slug collision during
// `registerDeployment` renames it), and a password-protected deploy's real
// HTML only exists inside an encrypted payload until the client decrypts it.
// So instead of a hardcoded `/{slug}/...` href, this snippet derives its own
// URLs from `location.pathname` at load time. `/_pwa/` is a reserved prefix
// that can never collide with a real slug (see SLUG_PATTERN in
// functions/[[path]].js, which requires slugs to start with an alphanumeric).
//
// This same snippet is spliced into two places:
//   - `generatedCode` itself, by `uploadDeploy` in deploy.js, before encryption
//     -- so it's present once the app is decrypted and document.write'n in.
//   - the "Unlock App" wrapper template in crypto.js -- so it's present
//     immediately, before any password is entered, for protected deploys.
export const PWA_HEAD_SNIPPET = `<link rel="manifest" id="orion-pwa-manifest">
<link rel="apple-touch-icon" id="orion-pwa-touch-icon">
<script>
(function () {
  var base = '/_pwa' + location.pathname.replace(/\\/+$/, '');
  var link = document.getElementById('orion-pwa-manifest');
  if (link) link.setAttribute('href', base + '/manifest.webmanifest');
  var touch = document.getElementById('orion-pwa-touch-icon');
  if (touch) touch.setAttribute('href', '/apple-touch-icon.png');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(base + '/sw.js', { scope: location.pathname }).catch(function () {});
  }
})();
</script>`;

// Splice the snippet into the earliest sensible point in <head>/<html>/<body>,
// mirroring the insertion strategy in previewBridge.js's injectPreviewBridge
// (index-based, single insertion point, rest of the document untouched).
export const injectPwaSnippet = (html) => {
  if (typeof html !== 'string' || !html) return html;

  const insertAt = (index, payload) => html.slice(0, index) + payload + html.slice(index);

  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    return insertAt(headMatch.index + headMatch[0].length, PWA_HEAD_SNIPPET);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    return insertAt(htmlMatch.index + htmlMatch[0].length, '<head>' + PWA_HEAD_SNIPPET + '</' + 'head>');
  }

  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  if (bodyMatch) {
    return insertAt(bodyMatch.index + bodyMatch[0].length, PWA_HEAD_SNIPPET);
  }

  return PWA_HEAD_SNIPPET + html;
};
