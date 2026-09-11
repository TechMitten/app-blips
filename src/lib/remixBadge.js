// A small "Remix Blip!" CTA badge shown in the corner of every deployed app.
// Pure CSS/HTML, no JS -- the anchor's href/target do the work, so there's
// nothing here that can throw or fight with the generated app's own scripts.
// It is NOT a real remix feature (deploying a copy for the visitor to edit);
// it's just a CTA that sends visitors to https://appblips.com in a new tab.
//
// Spliced in at deploy time only -- never into `generatedCode` itself -- so it
// stays out of the preview srcDoc, the code panel, downloads, and the
// clipboard, exactly like the preview bridge and the PWA/analytics snippets.
// It's added in two places (mirroring their plumbing):
//   - `uploadDeploy` in deploy.js, before encryption, so password-protected
//     apps carry it once decrypted and document.write'n in.
//   - functions/[[path]].js also injects it at serve time (deduped) so
//     deployments uploaded before this existed get it too.
export const REMIX_BADGE_ID = 'appblips-remix-badge';

export const REMIX_BADGE_SNIPPET = `<style>
#${REMIX_BADGE_ID}{position:fixed;bottom:16px;right:16px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#${REMIX_BADGE_ID} .ablips-remix-link{all:unset;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:9999px;background:linear-gradient(135deg,#7c3aed,#4f46e5);box-shadow:0 4px 14px rgba(0,0,0,.28);cursor:pointer;transition:transform .15s ease}
#${REMIX_BADGE_ID} .ablips-remix-link:hover,#${REMIX_BADGE_ID} .ablips-remix-link:focus-visible{transform:scale(1.08)}
#${REMIX_BADGE_ID} .ablips-remix-tip{position:absolute;right:52px;bottom:11px;white-space:nowrap;background:#111827;color:#fff;font-size:12px;line-height:1;padding:6px 10px;border-radius:6px;opacity:0;transform:translateX(4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.2)}
#${REMIX_BADGE_ID} .ablips-remix-link:hover + .ablips-remix-tip,#${REMIX_BADGE_ID} .ablips-remix-link:focus-visible + .ablips-remix-tip{opacity:1;transform:translateX(0)}
</style>
<div id="${REMIX_BADGE_ID}">
  <a class="ablips-remix-link" href="https://appblips.com" target="_blank" rel="noopener noreferrer" aria-label="Remix Blip!" title="Remix Blip!">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <polyline points="16 3 21 3 21 8"></polyline>
      <line x1="4" y1="20" x2="21" y2="3"></line>
      <polyline points="21 16 21 21 16 21"></polyline>
      <line x1="15" y1="15" x2="21" y2="21"></line>
      <line x1="4" y1="4" x2="9" y2="9"></line>
    </svg>
  </a>
  <span class="ablips-remix-tip" aria-hidden="true">Remix Blip!</span>
</div>`;

// Splice the snippet just before the end of the document so it renders as a
// real element without depending on <head>/<body> being present or well-formed.
export const injectRemixBadgeSnippet = (html) => {
  if (typeof html !== 'string' || !html) return html;
  if (html.includes(`id="${REMIX_BADGE_ID}"`)) return html;

  const bodyCloseAt = html.lastIndexOf('</body>');
  if (bodyCloseAt !== -1) {
    return html.slice(0, bodyCloseAt) + REMIX_BADGE_SNIPPET + html.slice(bodyCloseAt);
  }

  const htmlCloseAt = html.lastIndexOf('</html>');
  if (htmlCloseAt !== -1) {
    return html.slice(0, htmlCloseAt) + REMIX_BADGE_SNIPPET + html.slice(htmlCloseAt);
  }

  return html + REMIX_BADGE_SNIPPET;
};
