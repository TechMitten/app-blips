// Run: node --test testing/testDeployServing.js
// Exercises the deployed-app Pages Function against a mocked Supabase REST API
// and Storage, using the exact `deployments` row shape src/lib/deploy.js writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest, parseDeploymentDoc } from '../functions/[[path]].js';

// registerDeployment() stores extra pages WITH the extension.
const multiDoc = (extra = {}) => ({
  name: 'Cafe',
  storage_path: 'uid123/tok0123456.html',
  page_names: ['about.html', 'our-menu.html'],
  bundle: false,
  ...extra,
});
const page = (title, links = '') => `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1>${links}</body></html>`;
const OBJECTS = {
  'uid123/tok0123456.html': page('Home', '<a href="about.html">a</a><a href="/our-menu">m</a><a href="index.html">h</a>'),
  'uid123/tok0123456/about.html': page('About', '<a href="index.html">home</a>'),
  'uid123/tok0123456/our-menu.html': page('Menu'),
};

const serve = async (t, path, rows) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    const row = /\/rest\/v1\/deployments\?slug=eq\.([^&]+)/.exec(url);
    if (row) {
      const doc = rows[decodeURIComponent(row[1])];
      return doc ? new Response(JSON.stringify([doc]), { status: 200 }) : new Response('[]', { status: 200 });
    }
    const obj = /\/storage\/v1\/object\/public\/orion-deploys\/([^?]+)/.exec(url);
    if (obj) {
      const body = OBJECTS[decodeURIComponent(obj[1])];
      return body ? new Response(body) : new Response('nope', { status: 404 });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const res = await onRequest({
    request: new Request(`https://my.appblips.com${path}`),
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk', VITE_APPS_ORIGIN: 'https://my.appblips.com' },
    next: () => new Response('SPA'),
  });
  return { status: res.status, body: await res.text() };
};

test('extension in stored page_names is normalized', () => {
  assert.deepEqual(parseDeploymentDoc(multiDoc()).page_names, ['about', 'our-menu']);
  assert.deepEqual(parseDeploymentDoc(multiDoc({ page_names: ['index.html', '../x.html', 'about'] })).page_names, ['about']);
  assert.deepEqual(parseDeploymentDoc({ storage_path: 'a/b.html' }).page_names, []);
});

for (const slug of ['cafe-a7f3', 'ray/cafe-a7f3']) {
  const rows = { [slug]: multiDoc() };

  test(`${slug}: landing page renders with links rewritten to real URLs`, async (t) => {
    const { status, body } = await serve(t, `/${slug}`, rows);
    assert.equal(status, 200);
    assert.match(body, /<h1>Home<\/h1>/);
    assert.ok(body.includes(`href="/${slug}/about"`), 'about link rewritten');
    assert.ok(body.includes(`href="/${slug}/our-menu"`), 'root-relative link rewritten');
    assert.ok(body.includes(`href="/${slug}"`), 'index link rewritten');
    assert.ok(body.includes(`window.__APPBLIPS_SLUG__=${JSON.stringify(slug)}`));
  });

  test(`${slug}: /about and /about.html serve the About page`, async (t) => {
    for (const suffix of ['about', 'about.html', 'about/']) {
      const { status, body } = await serve(t, `/${slug}/${suffix}`, rows);
      assert.equal(status, 200, suffix);
      assert.match(body, /<h1>About<\/h1>/, suffix);
      t.mock.restoreAll();
    }
  });

  test(`${slug}: hyphenated page and unknown page`, async (t) => {
    assert.match((await serve(t, `/${slug}/our-menu`, rows)).body, /<h1>Menu<\/h1>/);
    t.mock.restoreAll();
    const missing = await serve(t, `/${slug}/contact`, rows);
    assert.equal(missing.status, 404);
    assert.match(missing.body, /Page not found/);
  });
}

test('an unknown site is still "no longer deployed"', async (t) => {
  const { status, body } = await serve(t, '/ghost-site/about', {});
  assert.equal(status, 404);
  assert.match(body, /no longer deployed/);
});

test('password bundle: every page URL serves the landing (unlock) object', async (t) => {
  const rows = { 'locked-x1': multiDoc({ bundle: true, page_names: ['about.html'] }) };
  const { status, body } = await serve(t, '/locked-x1/about', rows);
  assert.equal(status, 200);
  assert.match(body, /<h1>Home<\/h1>/);
  assert.ok(!body.includes('href="/locked-x1/about"'), 'no link rewriting inside an encrypted bundle');
});

test('single-page deployments (no page_names) are unchanged', async (t) => {
  const rows = { 'solo-1': { storage_path: 'uid123/tok0123456.html' } };
  const { status, body } = await serve(t, '/solo-1', rows);
  assert.equal(status, 200);
  assert.match(body, /<h1>Home<\/h1>/);
  assert.ok(body.includes('href="about.html"'), 'links untouched');
});
