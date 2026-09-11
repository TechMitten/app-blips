import authProvider from './auth';

// Per-deployment opt-in analytics, backed by a dedicated self-hosted Umami
// instance. Deliberately separate from src/lib/analytics.js, which is the
// always-on shared-website platform tracker (untouched by this feature) --
// keeping these apart means the fuzzy edit matcher, the deploy pipeline, and
// anyone reading either file never has to reason about the two together.
//
// The script src here is client-safe (no secret): the admin API URL and
// credentials used to create/query Umami websites stay server-side only, see
// functions/_lib/umamiProxy.js.
export const APP_UMAMI_SCRIPT_SRC = 'https://analytics.appblips.com/script.js';

// Splice the per-app tracking tag into <head>/<html>/<body>, mirroring the
// insertion strategy already used by injectAnalyticsSnippet/injectNoindexSnippet.
// Dedup only on this script's own src -- the shared-tracker tag has a
// different src, so both can coexist in the same document.
export const injectAppAnalyticsSnippet = (html, websiteId) => {
  if (typeof html !== 'string' || !html || !websiteId) return html;
  if (html.includes(APP_UMAMI_SCRIPT_SRC)) return html;

  const tag = `<script defer src="${APP_UMAMI_SCRIPT_SRC}" data-website-id="${websiteId}"></script>`;
  const insertAt = (index) => html.slice(0, index) + tag + html.slice(index);

  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) return insertAt(headMatch.index + headMatch[0].length);

  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) return insertAt(htmlMatch.index + htmlMatch[0].length);

  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  if (bodyMatch) return insertAt(bodyMatch.index + bodyMatch[0].length);

  return tag + html;
};

const withAuthHeaders = async () => {
  const token = await authProvider.getIdToken();
  const appCheckTokenStr = await authProvider.getAppCheckToken();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (appCheckTokenStr) headers['X-Firebase-AppCheck'] = appCheckTokenStr;
  return headers;
};

// Umami's own error responses aren't always a plain string -- validation
// failures can come back as `{ error: [{ message, path }, ...] }` or
// `{ error: { message } }`. Always resolve to a string so this is usable
// directly as an Error message instead of collapsing to "[object Object]".
const readErrorMessage = async (response, fallback) => {
  try {
    const data = await response.json();
    const err = data?.error;
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (Array.isArray(err)) {
      return err.map((e) => e?.message || JSON.stringify(e)).join('; ') || fallback;
    }
    if (typeof err === 'object') return err.message || JSON.stringify(err);
    return String(err);
  } catch {
    return fallback;
  }
};

// Creates (or, if one already exists for this slug, reuses) a dedicated Umami
// website for a deployment. Called once per deployment, right before its
// first analytics-enabled upload.
export const createAnalyticsWebsite = async (slug) => {
  const headers = await withAuthHeaders();
  const response = await fetch('/api/analytics/website', {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to enable analytics for this app.'));
  }
  const data = await response.json();
  return data.websiteId;
};

// type: 'summary' | 'pageviews' | 'urls' | 'referrers' | 'active' | 'countries' | 'entryPages'
export const fetchAnalyticsStats = async (slug, { type = 'summary', startAt, endAt, unit } = {}) => {
  const headers = await withAuthHeaders();
  const params = new URLSearchParams({ slug, type });
  if (startAt) params.set('startAt', String(startAt));
  if (endAt) params.set('endAt', String(endAt));
  if (unit) params.set('unit', unit);

  const response = await fetch(`/api/analytics/stats?${params.toString()}`, { headers });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load analytics.'));
  }
  return response.json();
};
