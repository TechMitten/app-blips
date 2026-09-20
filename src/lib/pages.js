// Multi-page project helpers. A project version stores `files`, a map of
// page filename -> full HTML document. `index.html` is always the landing
// page; single-page apps are simply `{ 'index.html': html }`.

export const LANDING_PAGE = 'index.html';
export const MAX_PAGES = 12;
// Firestore caps a project doc at 1 MiB and every version snapshots all pages,
// so keep any single version comfortably below it.
export const MAX_FILES_BYTES = 400 * 1024;

const PAGE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}\.html$/;

export function validatePageName(name) {
  return typeof name === 'string' && PAGE_NAME_RE.test(name);
}

/**
 * Normalize a link target to a page filename, or null if it isn't an internal
 * page link. Accepts `about.html`, `./about.html`, `/about.html`, `/about`,
 * `about`, `about.html#team`, `?x=1`, and `/` / `index.html` for the landing
 * page. Absolute URLs (any scheme or `//host`) and bare `#hash` return null.
 */
export function resolvePageLink(href) {
  if (typeof href !== 'string') return null;
  const raw = href.trim();
  if (!raw || raw[0] === '#' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  let path = raw.split('#')[0].split('?')[0];
  if (path === '') return null; // "?x=1": same page
  path = path.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (path === '') return LANDING_PAGE;
  if (path.includes('/')) return null;
  if (!path.endsWith('.html')) path += '.html';
  return validatePageName(path) ? path : null;
}

export function getHash(href) {
  const i = typeof href === 'string' ? href.indexOf('#') : -1;
  return i >= 0 ? href.slice(i + 1) : '';
}

export function makeFiles(landingHtml) {
  return landingHtml ? { [LANDING_PAGE]: landingHtml } : {};
}

export function getLanding(files) {
  return (files && files[LANDING_PAGE]) || '';
}

// Old/foreign version objects may only carry `code`.
export function versionFiles(version) {
  if (!version) return {};
  if (version.files && typeof version.files === 'object') return version.files;
  return makeFiles(version.code);
}

export function pageNames(files) {
  const names = Object.keys(files || {});
  return [LANDING_PAGE, ...names.filter((n) => n !== LANDING_PAGE).sort()].filter((n) => names.includes(n));
}

export function mapPages(files, fn) {
  return Object.fromEntries(Object.entries(files || {}).map(([name, html]) => [name, fn(html, name)]));
}

export function filesSize(files) {
  return Object.values(files || {}).reduce((sum, html) => sum + (html ? html.length : 0), 0);
}

/** Returns an error string if `files` violates page-count/size limits, else null. */
export function checkFilesLimits(files) {
  if (Object.keys(files || {}).length > MAX_PAGES) return `A site can have at most ${MAX_PAGES} pages.`;
  if (filesSize(files) > MAX_FILES_BYTES) return 'This site is too large to save. Remove or shorten a page.';
  return null;
}

/** Internal page links in `html` that point at pages missing from `files`. */
export function findBrokenLinks(files) {
  const broken = [];
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const [name, html] of Object.entries(files || {})) {
    let m;
    while ((m = re.exec(html))) {
      const target = resolvePageLink(m[1] ?? m[2]);
      if (target && !(target in files)) broken.push({ page: name, target });
    }
  }
  return broken;
}

export function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * Renders the site's code for an LLM prompt. A single page keeps the classic
 * "Current <noun> Code" block. With several pages each is fenced under its
 * filename, until `budget` characters are used; the rest are listed by name so
 * the model can pull them in with view_code.
 */
export function formatFilesForPrompt(files, noun = 'app', budget = 60000) {
  const names = pageNames(files);
  if (names.length <= 1) {
    return `Current ${noun} Code:\n\`\`\`html\n${getLanding(files)}\n\`\`\``;
  }
  let used = 0;
  const shown = [];
  const omitted = [];
  for (const name of names) {
    const html = files[name];
    if (shown.length === 0 || used + html.length <= budget) {
      shown.push(`=== ${name} ===\n\`\`\`html\n${html}\n\`\`\``);
      used += html.length;
    } else {
      omitted.push(`${name} (${html.length} chars)`);
    }
  }
  return `Current ${noun} files (${names.length} pages; index.html is the landing page):\n\n${shown.join('\n\n')}` +
    (omitted.length ? `\n\nNot shown (use view_code with the file parameter to read): ${omitted.join(', ')}` : '');
}

// Short human label for a page: "Home", "About", "Our menu".
export function pageLabel(name) {
  if (name === LANDING_PAGE) return 'Home';
  const words = name.replace(/[.]html$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Which page a partially streamed tool call is writing, or null while that is
// not known yet. `file` (edits) is null/absent for the landing page, but an
// absent key is indistinguishable from "not streamed yet", so only an explicit
// value counts; `name` is create_page's target.
export const sniffStreamedPage = (toolName, argsJson) => {
  if (toolName === 'create_page') {
    const m = /"name"\s*:\s*"([a-z0-9-]{1,40}\.html)"/.exec(argsJson);
    return m ? m[1] : null;
  }
  if (toolName === 'apply_surgical_edits') {
    const m = /"file"\s*:\s*(?:"([a-z0-9-]{1,40}\.html)"|null)/.exec(argsJson);
    if (m) return m[1] || 'index.html';
  }
  return null;
};
