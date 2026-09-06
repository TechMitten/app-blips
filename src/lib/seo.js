export const DEFAULT_FAVICON_URL = '/favicon.ico';
export const NOINDEX_META_TAG = '<meta name="robots" content="noindex">';

export const injectFaviconSnippet = (html, faviconDataUrl = DEFAULT_FAVICON_URL) => {
  if (typeof html !== 'string' || !html) return html;
  const targetFavicon = faviconDataUrl || DEFAULT_FAVICON_URL;

  // Replace any existing favicon link so the new icon takes precedence
  const existingIconRegex = /<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>/gi;
  const cleanHtml = html.replace(existingIconRegex, '');

  const faviconTag = `<link rel="icon" href="${targetFavicon}">`;
  const insertAt = (index) => cleanHtml.slice(0, index) + faviconTag + cleanHtml.slice(index);

  const headMatch = /<head\b[^>]*>/i.exec(cleanHtml);
  if (headMatch) {
    return insertAt(headMatch.index + headMatch[0].length);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(cleanHtml);
  if (htmlMatch) {
    return insertAt(htmlMatch.index + htmlMatch[0].length);
  }

  return faviconTag + cleanHtml;
};

export const injectNoindexSnippet = (html) => {
  if (typeof html !== 'string' || !html) return html;
  if (html.includes('<meta name="robots" content="noindex">')) return html;

  const insertAt = (index) => html.slice(0, index) + NOINDEX_META_TAG + html.slice(index);

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

  return NOINDEX_META_TAG + html;
};
