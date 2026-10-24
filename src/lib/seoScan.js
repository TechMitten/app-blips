// Asks the host to read the user's own website once (/api/seo/scan, see
// electron/server/seoScanApi.js). Called only after the user says yes in the
// SEO questions. Resolves { scan } or { error } and never throws.
export async function scanSite(url, signal) {
  try {
    const response = await fetch('/api/seo/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.scan) return { scan: data.scan };
    return { error: data?.error || 'Couldn’t read that site. You can carry on without it.' };
  } catch {
    if (signal?.aborted) return { error: '' };
    return { error: 'Couldn’t reach AppBlips to scan the site. You can carry on without it.' };
  }
}
