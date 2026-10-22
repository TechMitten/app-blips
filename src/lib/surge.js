// Publish to Surge (PublishDialog): the page side of /api/surge
// (electron/server/surgeApi.js). The same fetch works in every host: the
// desktop app answers it in-process, server.js and the Vite dev server over
// HTTP. The Surge token never reaches the page; only the account email does.
import { safeStorage } from './config';
import { slugifyName } from './helpers';

export const SURGE_SUFFIX = '.surge.sh';
const DOMAINS_KEY = 'orion-surge-domains';

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Couldn’t reach AppBlips’ publishing service. Try again.' };
  }
  try {
    return await response.json();
  } catch {
    return { error: `Publishing failed (error ${response.status}).` };
  }
}

export const surgeStatus = () => call('/api/surge');
export const surgeLogin = (email, password) => call('/api/surge/login', { method: 'POST', body: { email, password } });
export const surgeSignOut = () => call('/api/surge', { method: 'DELETE' });
export const surgePublish = (domain, files) => call('/api/surge/publish', { method: 'POST', body: { domain, files } });
export const surgeUnpublish = (domain) => call('/api/surge/unpublish', { method: 'POST', body: { domain } });

// "My Bakery Site" -> "my-bakery-site-x7k2": a random tail makes it unlikely
// that someone else on Surge already has the address.
export function suggestSurgeName(projectName) {
  const base = (slugifyName(projectName) || 'my-site').slice(0, 30).replace(/-+$/, '');
  const tail = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${base}-${tail}`;
}

// The address each project was last published to (just the name, without
// .surge.sh), so publishing again updates the same site.
const loadDomains = () => {
  try {
    const parsed = JSON.parse(safeStorage('local')?.getItem(DOMAINS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const loadPublishedName = (projectId) => {
  const name = projectId ? loadDomains()[projectId] : '';
  return typeof name === 'string' ? name : '';
};

// An empty name forgets the address (after Unpublish).
export const savePublishedName = (projectId, name) => {
  if (!projectId) return;
  const domains = { ...loadDomains(), [projectId]: name };
  if (!name) delete domains[projectId];
  try {
    safeStorage('local')?.setItem(DOMAINS_KEY, JSON.stringify(domains));
  } catch { /* storage blocked: the next publish suggests a name again */ }
};
