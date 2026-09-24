// Font choices for click-to-edit text formatting. Pure data + string helpers
// (no React, no DOM) so the direct-edit engine can share them under plain
// node in testing/.
//
// System stacks need nothing in the page. Google families are added to the
// page's <head> when chosen (see fontLinkTags), so a deployed or exported
// page keeps working without the studio. Stacks use single quotes so they
// survive inside a double-quoted style="..." attribute unescaped.

export const FONT_OPTIONS = [
  { id: 'sans', label: 'Sans', category: 'System', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: 'serif', label: 'Serif', category: 'System', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono', category: 'System', stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },

  { id: 'inter', label: 'Inter', category: 'Sans', stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  { id: 'dm-sans', label: 'DM Sans', category: 'Sans', stack: "'DM Sans', system-ui, sans-serif", google: 'DM+Sans:wght@400;500;600;700' },
  { id: 'poppins', label: 'Poppins', category: 'Sans', stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700' },
  { id: 'montserrat', label: 'Montserrat', category: 'Sans', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;500;600;700' },
  { id: 'space-grotesk', label: 'Space Grotesk', category: 'Sans', stack: "'Space Grotesk', system-ui, sans-serif", google: 'Space+Grotesk:wght@400;500;600;700' },

  { id: 'playfair', label: 'Playfair Display', category: 'Serif', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400;500;600;700' },
  { id: 'lora', label: 'Lora', category: 'Serif', stack: "'Lora', Georgia, serif", google: 'Lora:wght@400;500;600;700' },
  { id: 'merriweather', label: 'Merriweather', category: 'Serif', stack: "'Merriweather', Georgia, serif", google: 'Merriweather:wght@400;700' },
  { id: 'cormorant', label: 'Cormorant Garamond', category: 'Serif', stack: "'Cormorant Garamond', Georgia, serif", google: 'Cormorant+Garamond:wght@400;500;600;700' },

  { id: 'oswald', label: 'Oswald', category: 'Display', stack: "'Oswald', Impact, sans-serif", google: 'Oswald:wght@400;500;600;700' },
  { id: 'bebas', label: 'Bebas Neue', category: 'Display', stack: "'Bebas Neue', Impact, sans-serif", google: 'Bebas+Neue' },
  { id: 'abril', label: 'Abril Fatface', category: 'Display', stack: "'Abril Fatface', Georgia, serif", google: 'Abril+Fatface' },

  { id: 'caveat', label: 'Caveat', category: 'Handwriting', stack: "'Caveat', cursive", google: 'Caveat:wght@400;500;600;700' },
  { id: 'pacifico', label: 'Pacifico', category: 'Handwriting', stack: "'Pacifico', cursive", google: 'Pacifico' },

  { id: 'jetbrains', label: 'JetBrains Mono', category: 'Mono', stack: "'JetBrains Mono', ui-monospace, monospace", google: 'JetBrains+Mono:wght@400;500;700' },
];

const normalizeStack = (stack) => String(stack || '')
  .replace(/["']/g, '')
  .replace(/\s*,\s*/g, ',')
  .trim()
  .toLowerCase();

// Match a computed/authored font-family string to a catalog entry by its
// first family (computed values come back with double quotes and no fallback
// list changes, so compare the leading family name only).
export const findFontByStack = (stack) => {
  const first = normalizeStack(stack).split(',')[0];
  if (!first) return null;
  return FONT_OPTIONS.find((f) => normalizeStack(f.stack).split(',')[0] === first) || null;
};

// One stylesheet URL for the picker's own previews: every family, restricted
// to the glyphs their names need (a few KB in total).
export const fontPreviewStylesheetUrl = () => {
  const families = FONT_OPTIONS.filter((f) => f.google).map((f) => `family=${f.google.split(':')[0]}`);
  const text = encodeURIComponent(Array.from(new Set(FONT_OPTIONS.map((f) => f.label).join('').split(''))).join(''));
  return `https://fonts.googleapis.com/css2?${families.join('&')}&text=${text}&display=swap`;
};

// The <link> tags a page needs to render `font`, or '' when the page already
// loads that family (or the font is a system stack).
export const fontLinkTags = (font, code) => {
  if (!font || !font.google) return '';
  const family = font.google.split(':')[0];
  if (code.includes(`family=${family}`) || code.includes(`family=${family.replace(/\+/g, '%20')}`)) return '';
  const hasPreconnect = (host) => new RegExp(`rel=["']preconnect["'][^>]*${host.replace(/\./g, '\\.')}|${host.replace(/\./g, '\\.')}[^>]*rel=["']preconnect["']`).test(code);
  const lines = [];
  if (!hasPreconnect('fonts.googleapis.com')) lines.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  if (!hasPreconnect('fonts.gstatic.com')) lines.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  lines.push(`<link href="https://fonts.googleapis.com/css2?family=${font.google}&display=swap" rel="stylesheet">`);
  return lines.join('\n');
};

// Splice font <link> tags into a document's <head> (before </head>, else
// right after <head>, else at the very top).
export const insertFontLinks = (code, font) => {
  const tags = fontLinkTags(font, code);
  if (!tags) return code;
  const closeHead = code.search(/<\/head\s*>/i);
  if (closeHead !== -1) return `${code.slice(0, closeHead)}${tags}\n${code.slice(closeHead)}`;
  const openHead = /<head[^>]*>/i.exec(code);
  if (openHead) {
    const at = openHead.index + openHead[0].length;
    return `${code.slice(0, at)}\n${tags}${code.slice(at)}`;
  }
  return `${tags}\n${code}`;
};
