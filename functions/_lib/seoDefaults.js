// Serve-time SEO fallbacks for deployed apps (functions/[[path]].js).
//
// Adds only what the page is missing -- lang, canonical, meta description, and
// Open Graph / Twitter basics derived from the page's own <title>, <h1> and
// first paragraph -- and never overwrites anything the generated HTML already
// declares. Done at serve time (not deploy time) because the final slug is
// only known after slug-collision handling, and it also covers older deploys.
// Pages marked noindex (password-protected wrappers, opted-out deploys) are
// returned untouched.

const MAX_DESCRIPTION = 160;

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");

const plainText = (fragment) =>
  decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const escapeAttr = (text) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const firstMatch = (html, regex) => {
  const match = regex.exec(html);
  return match ? plainText(match[1]) : '';
};

const truncate = (text, max) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '') + '…';
};

// Meta tags may put name/property before or after content, so match either.
const hasMeta = (html, attr, value) =>
  new RegExp(`<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${value}["']`, 'i').test(html);

export const injectSeoDefaults = (html, { url } = {}) => {
  if (typeof html !== 'string' || !html) return html;
  const isNoindex = (html.match(/<meta\b[^>]*>/gi) || []).some(
    (tag) => /\bname=["']robots["']/i.test(tag) && /noindex/i.test(tag),
  );
  if (isNoindex) return html;

  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const bodyOnly = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
  const paragraph = (bodyOnly.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [])
    .map((p) => plainText(p))
    .find((text) => text.length >= 40);

  const pageTitle = title || h1;
  const description = truncate(paragraph || '', MAX_DESCRIPTION);
  const tags = [];

  if (url && !/<link\b[^>]*\brel=["']canonical["']/i.test(html)) {
    tags.push(`<link rel="canonical" href="${escapeAttr(url)}">`);
  }
  if (description && !hasMeta(html, 'name', 'description')) {
    tags.push(`<meta name="description" content="${escapeAttr(description)}">`);
  }
  if (pageTitle && !hasMeta(html, 'property', 'og:title')) {
    tags.push(`<meta property="og:title" content="${escapeAttr(pageTitle)}">`);
  }
  const ogDescription = description || firstMatch(html, /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["']/i);
  if (ogDescription && !hasMeta(html, 'property', 'og:description')) {
    tags.push(`<meta property="og:description" content="${escapeAttr(ogDescription)}">`);
  }
  if (!hasMeta(html, 'property', 'og:type')) tags.push('<meta property="og:type" content="website">');
  if (url && !hasMeta(html, 'property', 'og:url')) {
    tags.push(`<meta property="og:url" content="${escapeAttr(url)}">`);
  }
  if (!hasMeta(html, 'name', 'twitter:card')) tags.push('<meta name="twitter:card" content="summary">');

  let out = html;

  // Screen readers and search engines use lang; add it only when absent.
  const htmlTag = /<html\b([^>]*)>/i.exec(out);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[1])) {
    out = out.slice(0, htmlTag.index) + `<html lang="en"${htmlTag[1]}>` + out.slice(htmlTag.index + htmlTag[0].length);
  }

  if (!tags.length) return out;
  const snippet = tags.join('');

  const headMatch = /<head\b[^>]*>/i.exec(out);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return out.slice(0, at) + snippet + out.slice(at);
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(out);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return out.slice(0, at) + snippet + out.slice(at);
  }
  return snippet + out;
};
