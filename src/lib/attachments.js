// Client-side helpers for the chat-input image attachment feature (screenshot
// capture + manual upload).

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Only src= and url() -- an href is either a link (which paints nothing) or a
// stylesheet the bridge already stripped, and fetching those just produced
// noisy CORS failures for things like the Tailwind CDN script tag.
const HTTP_URL_RE = /src=(["'])(https?:\/\/[^"']+)\1|url\(\s*(["']?)(https?:\/\/[^"')]+)\3\s*\)/g;

const collectHttpUrls = (text) => {
  const urls = new Set();
  let match;
  HTTP_URL_RE.lastIndex = 0;
  while ((match = HTTP_URL_RE.exec(text))) {
    urls.add(match[2] || match[4]);
  }
  return [...urls];
};

const escapeForRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const xmlEscape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const fetchText = async (url) => {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};

// Best-effort: fetch the URL and re-encode it as a data: URI. Anything that
// fails (CORS, network, ...) resolves to null rather than rejecting -- the
// caller strips the reference instead of leaving a live cross-origin URL,
// which would otherwise taint the capture canvas and fail the ENTIRE
// screenshot at the toDataURL() step, not just that one image.
const inlineHttpUrl = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

// Turns the raw {html, css} snapshot posted back by previewBridge.js's
// captureDomSnapshot into a rasterized screenshot data URL. Runs in the
// PARENT window deliberately -- see previewBridge.js's module header for why
// this can't happen inside the sandboxed preview frame. Uses the classic
// SVG-foreignObject trick (serialize markup + CSS into an SVG, load it as an
// <img>, draw that to a <canvas>) rather than a library like html2canvas,
// because every such library clones into a helper <iframe> to compute
// styles, and that iframe is exactly the cross-origin trap this avoids.
export const rasterizeDomSnapshot = async ({
  html,
  css,
  externalStyleUrls = [],
  width,
  height,
  backgroundColor = '#ffffff',
  rootFontSize = '16px',
  scrollX = 0,
  scrollY = 0,
}) => {
  // Stylesheets the frame couldn't read (cross-origin, e.g. Google Fonts) can
  // usually still be fetched here as plain text.
  const recovered = await Promise.all(externalStyleUrls.map((url) => fetchText(url)));

  let safeHtml = html || '';
  let safeCss = [css || '', ...recovered.filter(Boolean)].join('\n');

  const urls = new Set([...collectHttpUrls(safeHtml), ...collectHttpUrls(safeCss)]);
  const inlined = await Promise.all([...urls].map(async (url) => [url, await inlineHttpUrl(url)]));

  for (const [url, dataUrl] of inlined) {
    if (dataUrl) {
      safeHtml = safeHtml.split(url).join(dataUrl);
      safeCss = safeCss.split(url).join(dataUrl);
    } else {
      // An SVG rendered through an <img> loads NO external resources, so a
      // reference we couldn't inline can never paint anyway. Swap images for
      // a transparent pixel (a broken-image glyph looks worse than a gap)
      // and drop the CSS reference entirely.
      const escaped = escapeForRegExp(url);
      safeHtml = safeHtml.replace(new RegExp('src=(["\'])' + escaped + '\\1', 'g'), 'src=$1' + TRANSPARENT_PIXEL + '$1');
      safeCss = safeCss.replace(new RegExp('url\\((["\']?)' + escaped + '\\1\\)', 'g'), 'none');
    }
  }

  // The markup arrives already namespaced by XMLSerializer; the CSS is raw
  // text, so it needs XML escaping before it can sit in a <style> node.
  // font-size on <svg> is what rem units in the content resolve against,
  // since the SVG element -- not the captured <html> -- is this document's
  // root. Every wrapper carries an explicit 100% height: the captured page's
  // own `height: 100%` chain chains up through these, and one `height: auto`
  // link collapses the whole app to its header.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" style="font-size:' + rootFontSize + '">' +
      '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + width + 'px;height:' + height + 'px;overflow:hidden">' +
          // Prepended, so the page's own rules still win: it only supplies a
          // definite height where the page never declared one. A `height:100%`
          // / `flex:1` column needs an unbroken chain from the root, and one
          // `auto` link collapses the scrollable middle to nothing -- which
          // renders as a page showing only its fixed-position chrome.
          '<style>html,body{height:100%}' + xmlEscape(safeCss) + '</style>' +
          '<div style="width:100%;height:100%;transform:translate(' + -scrollX + 'px,' + -scrollY + 'px)">' + safeHtml + '</div>' +
        '</div>' +
      '</foreignObject>' +
    '</svg>';

  // <img> reports an XML parse failure as a bare onerror with no detail, which
  // is indistinguishable from every other load failure. Parse it here first so
  // a malformed snapshot names itself instead of failing silently.
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const parseError = parsed.querySelector('parsererror');
  if (parseError) {
    throw new Error('Could not build the screenshot: ' + (parseError.textContent || '').trim().split('\n')[0]);
  }

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to render the preview snapshot.'));
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported.');
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    throw new Error("Couldn't capture the screenshot — this app references external content that blocks capture. Try the paperclip upload instead.");
  }
};

// Keeps the base64 payload sent to the LLM bounded regardless of source --
// there's no size limit anywhere in the proxy chain (see
// functions/_lib/chatProxy.js), so this is the only guardrail.
export const compressImageDataUrl = (dataUrl, { maxDimension = 1600, quality = 0.85 } = {}) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas is not supported.'));
        return;
      }
      // Flatten any transparency onto white before JPEG-encoding, which has
      // no alpha channel.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load the image for compression.'));
    img.src = dataUrl;
  });
};
