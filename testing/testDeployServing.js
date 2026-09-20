// Run: node --test testing/testDeployServing.js
// Exercises the deployed-app Pages Function with a mocked Firestore REST API and
// Storage, using the exact `deployments` document shape src/lib/deploy.js writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest, parseDeploymentDoc } from '../functions/[[path]].js';

const str = (v) => ({ stringValue: v });
// registerDeployment() stores extra pages WITH the extension.
const multiDoc = (extra = {}) => ({
  fields: {
    storage_path: str('uid123/tok0123456.html'),
    name: str('Cafe'),
    page_names: { arrayValue: { values: [str('about.html'), str('our-menu.html')] } },
    bundle: { booleanValue: false },
    ...extra,
  },
});
const page = (title, links = '') => `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1>${links}</body></html>`;
const OBJECTS = {
  'orion-deploys/uid123/tok0123456.html': page('Home', '<a href="about.html">a</a><a href="/our-menu">m</a><a href="index.html">h</a>'),
  'orion-deploys/uid123/tok0123456/about.html': page('About', '<a href="index.html">home</a>'),
  'orion-deploys/uid123/tok0123456/our-menu.html': page('Menu'),
};

const serve = async (t, path, docs) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    const row = /\/deployments\/([^?]+)/.exec(url);
    if (row) {
      const doc = docs[decodeURIComponent(row[1])];
      return doc ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('{}', { status: 404 });
    }
    const obj = /\/o\/([^?]+)\?alt=media/.exec(url);
    if (obj) {
      const body = OBJECTS[decodeURIComponent(obj[1])];
      return body ? new Response(body) : new Response('nope', { status: 404 });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const res = await onRequest({ request: new Request(`https://my.appblips.com${path}`), env: { SELF_HOSTED_MODE: 'true' }, next: () => new Response('SPA') });
  return { status: res.status, body: await res.text() };
};

test('extension in stored page_names is normalized', () => {
  assert.deepEqual(parseDeploymentDoc(multiDoc()).page_names, ['about', 'our-menu']);
  assert.deepEqual(parseDeploymentDoc(multiDoc({ page_names: { arrayValue: { values: [str('index.html'), str('../x.html'), str('about')] } } })).page_names, ['about']);
  assert.deepEqual(parseDeploymentDoc({ fields: { storage_path: str('a/b.html') } }).page_names, []);
});

for (const slug of ['cafe-a7f3', 'ray/cafe-a7f3']) {
  const docs = { [slug]: multiDoc() };

  test(`${slug}: landing page renders with links rewritten to real URLs`, async (t) => {
    const { status, body } = await serve(t, `/${slug}`, docs);
    assert.equal(status, 200);
    assert.match(body, /<h1>Home<\/h1>/);
    assert.ok(body.includes(`href="/${slug}/about"`), 'about link rewritten');
    assert.ok(body.includes(`href="/${slug}/our-menu"`), 'root-relative link rewritten');
    assert.ok(body.includes(`href="/${slug}"`), 'index link rewritten');
    assert.ok(body.includes(`window.__APPBLIPS_SLUG__=${JSON.stringify(slug)}`));
  });

  test(`${slug}: /about and /about.html serve the About page`, async (t) => {
    for (const suffix of ['about', 'about.html', 'about/']) {
      const { status, body } = await serve(t, `/${slug}/${suffix}`, docs);
      assert.equal(status, 200, suffix);
      assert.match(body, /<h1>About<\/h1>/, suffix);
      t.mock.restoreAll();
    }
  });

  test(`${slug}: hyphenated page and unknown page`, async (t) => {
    assert.match((await serve(t, `/${slug}/our-menu`, docs)).body, /<h1>Menu<\/h1>/);
    t.mock.restoreAll();
    const missing = await serve(t, `/${slug}/contact`, docs);
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
  const docs = { 'locked-x1': multiDoc({ bundle: { booleanValue: true }, page_names: { arrayValue: { values: [str('about.html')] } } }) };
  const { status, body } = await serve(t, '/locked-x1/about', docs);
  assert.equal(status, 200);
  assert.match(body, /<h1>Home<\/h1>/);
  assert.ok(!body.includes('href="/locked-x1/about"'), 'no link rewriting inside an encrypted bundle');
});

test('single-page deployments (no page_names) are unchanged', async (t) => {
  const docs = { 'solo-1': { fields: { storage_path: str('uid123/tok0123456.html') } } };
  const { status, body } = await serve(t, '/solo-1', docs);
  assert.equal(status, 200);
  assert.match(body, /<h1>Home<\/h1>/);
  assert.ok(body.includes('href="about.html"'), 'links untouched');
});
