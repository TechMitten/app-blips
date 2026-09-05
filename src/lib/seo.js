export const NOINDEX_META_TAG = '<meta name="robots" content="noindex">';

export const injectFaviconSnippet = (html, faviconDataUrl) => {
  if (typeof html !== 'string' || !html || !faviconDataUrl) return html;
  
  const faviconTag = `<link rel="icon" href="${faviconDataUrl}">`;
  const insertAt = (index) => html.slice(0, index) + faviconTag + html.slice(index);

  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    return insertAt(headMatch.index + headMatch[0].length);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    return insertAt(htmlMatch.index + htmlMatch[0].length);
  }

  return faviconTag + html;
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
