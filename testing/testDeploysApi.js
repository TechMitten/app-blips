// POST/DELETE /api/deploys and POST /api/account/delete against fake
// Firestore and R2: who may publish where, what gets stored, and that
// deleting an account takes everything with it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleDeployUpload, handleDeployDelete, deploymentDocPath } from '../functions/_lib/deploys.js';
import { handleAccountDelete } from '../functions/_lib/account.js';
import { usageDocPath } from '../functions/_lib/usageTracking.js';
import { installFirebaseFake, firebaseEnv, signIdToken, R2_ENV } from './firebaseFake.js';

const env = firebaseEnv({ ...R2_ENV, STRIPE_SECRET_KEY: 'sk_test_x' });
const page = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head><body>${title}</body></html>`;

const setup = (t, fallback) => {
  const fake = installFirebaseFake(t, { fallback });
  fake.firestore.set('users/ray-uid', { username: 'ray' });
  fake.firestore.set('usernames/ray', { uid: 'ray-uid' });
  fake.firestore.set('users/bob-uid', { username: 'bob' });
  fake.firestore.set('usernames/bob', { uid: 'bob-uid' });
  return fake;
};

const authed = async (uid, claims) => ({ authorization: `Bearer ${await signIdToken(uid, { claims })}` });

const upload = async (uid, body, envOverride = env) => handleDeployUpload(new Request('https://app.example/api/deploys', {
  method: 'POST',
  headers: { ...(uid ? await authed(uid) : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
}), envOverride);

const remove = async (uid, slug) => handleDeployDelete(new Request(`https://app.example/api/deploys?slug=${encodeURIComponent(slug)}`, {
  method: 'DELETE',
  headers: await authed(uid),
}), env);

const site = (extra = {}) => ({
  slug: 'ray/cafe-a1b2',
  landing: page('Home'),
  pages: { 'about.html': page('About'), 'menu.html': page('Menu') },
  projectId: 'proj-1',
  name: 'Cafe',
  ...extra,
});

test('publishing stores every page under the caller\'s own prefix and records the deployment', async (t) => {
  const { firestore, r2 } = setup(t);
  const response = await upload('ray-uid', site());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.slug, 'ray/cafe-a1b2');
  assert.match(result.path, /^ray-uid\/[A-Za-z0-9]{10}\.html$/);
  assert.deepEqual(result.pageObjects, ['about.html', 'menu.html']);

  const base = result.path.replace(/\.html$/, '');
  assert.equal(r2.objects.get(result.path), page('Home'));
  assert.equal(r2.objects.get(`${base}/about.html`), page('About'));
  assert.equal(r2.objects.get(`${base}/menu.html`), page('Menu'));

  const doc = firestore.getData(deploymentDocPath('ray/cafe-a1b2'));
  assert.equal(doc.user_id, 'ray-uid');
  assert.equal(doc.storage_path, result.path);
  assert.deepEqual(doc.page_names, ['about.html', 'menu.html']);
  assert.equal(doc.bundle, false);
  assert.equal(doc.analytics_enabled, false);
});

test('a redeploy keeps its path and drops pages that are gone', async (t) => {
  const { r2 } = setup(t);
  const first = await (await upload('ray-uid', site())).json();
  const second = await (await upload('ray-uid', site({ pages: { 'about.html': page('About 2') } }))).json();
  assert.equal(second.path, first.path);
  const base = first.path.replace(/\.html$/, '');
  assert.equal(r2.objects.get(`${base}/about.html`), page('About 2'));
  assert.equal(r2.objects.has(`${base}/menu.html`), false, 'removed page is no longer stored');

  // Switching to a password bundle folds every page into the landing object.
  await upload('ray-uid', site({ pages: {}, bundled: true, passwordProtected: true }));
  assert.equal(r2.objects.has(`${base}/about.html`), false);
});

test('a slug belongs to whoever published it first', async (t) => {
  const { firestore } = setup(t);
  assert.equal((await upload('ray-uid', site({ slug: 'cafe-zz' }))).status, 200);
  const taken = await upload('bob-uid', site({ slug: 'cafe-zz' }));
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).code, 'taken');
  assert.equal(firestore.getData(deploymentDocPath('cafe-zz')).user_id, 'ray-uid');
});

test('the username part of a link must be the caller\'s own', async (t) => {
  setup(t);
  assert.equal((await upload('bob-uid', site({ slug: 'ray/phish-1' }))).status, 403);
  assert.equal((await upload('nobody-uid', site({ slug: 'ray/phish-1' }))).status, 403, 'no username at all');
  // A bare slug can't sit on top of someone's username either.
  assert.equal((await upload('bob-uid', site({ slug: 'ray' }))).status, 409);
});

test('bad input is refused before anything is stored', async (t) => {
  const { r2 } = setup(t);
  const cases = {
    'bad slug': site({ slug: '../etc' }),
    'bad page name': site({ pages: { '../x.html': page('x') } }),
    'index as a page': site({ pages: { 'index.html': page('x') } }),
    'uppercase page': site({ pages: { 'About.html': page('x') } }),
    'non-string page': site({ pages: { 'about.html': 5 } }),
    'too many pages': site({ pages: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}.html`, page('x')])) }),
    'huge landing': site({ landing: 'x'.repeat(3 * 1024 * 1024 + 1) }),
    'bundle with pages': site({ bundled: true }),
    'no landing': site({ landing: '' }),
  };
  for (const [name, body] of Object.entries(cases)) {
    assert.equal((await upload('ray-uid', body)).status, 400, name);
  }
  assert.equal(r2.objects.size, 0);
});

test('an analytics website can only be attached by the account that created it', async (t) => {
  const { firestore } = setup(t);
  firestore.set('analytics_sites/site-bob', { user_id: 'bob-uid' });
  firestore.set('analytics_sites/site-ray', { user_id: 'ray-uid' });
  assert.equal((await upload('ray-uid', site({ analyticsEnabled: true, analyticsWebsiteId: 'site-bob' }))).status, 400);
  assert.equal((await upload('ray-uid', site({ analyticsEnabled: true, analyticsWebsiteId: 'site-ray' }))).status, 200);
  assert.equal(firestore.getData(deploymentDocPath('ray/cafe-a1b2')).analytics_website_id, 'site-ray');
});

test('publishing needs a signed-in user and a configured server', async (t) => {
  setup(t);
  assert.equal((await upload(null, site())).status, 401);
  assert.equal((await upload('ray-uid', site(), firebaseEnv())).status, 404, 'no R2 credentials');
});

test('only the owner can take a deployment down, and it takes its pages with it', async (t) => {
  const { firestore, r2 } = setup(t);
  const { path } = await (await upload('ray-uid', site())).json();
  assert.equal((await remove('bob-uid', 'ray/cafe-a1b2')).status, 404);
  assert.ok(firestore.getData(deploymentDocPath('ray/cafe-a1b2')));

  assert.equal((await remove('ray-uid', 'ray/cafe-a1b2')).status, 200);
  assert.equal(firestore.getData(deploymentDocPath('ray/cafe-a1b2')), null);
  assert.equal([...r2.objects.keys()].some((key) => key.startsWith(path.replace(/\.html$/, ''))), false);
  assert.equal((await remove('ray-uid', 'ray/cafe-a1b2')).status, 200, 'already gone is fine');
});

// --- account deletion -----------------------------------------------------

const deleteAccount = async (uid, claims) => handleAccountDelete(new Request('https://app.example/api/account/delete', {
  method: 'POST',
  headers: await authed(uid, claims),
}), env);

test('deleting an account needs a fresh sign-in', async (t) => {
  const { firestore } = setup(t);
  const response = await deleteAccount('ray-uid', { auth_time: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'reauth');
  assert.ok(firestore.getData('users/ray-uid'), 'nothing was deleted');
});

test('deleting an account removes everything it owns, and only that', async (t) => {
  const stripeCalls = [];
  const { firestore, r2, calls } = setup(t, async (url, init) => {
    stripeCalls.push(`${init.method} ${url}`);
    return Response.json({ id: 'sub_1', status: 'canceled' });
  });
  await upload('ray-uid', site());
  await upload('bob-uid', site({ slug: 'bob/shop-1' }));
  firestore.set('projects/p1', { user_id: 'ray-uid', name: 'Cafe', chunk_count: 1 });
  firestore.set('projects/p1/chunks/0', { user_id: 'ray-uid', rev: 'r' });
  firestore.set('projects/p2', { user_id: 'bob-uid', name: 'Shop', chunk_count: 1 });
  firestore.set(usageDocPath('ray-uid', '2026-10-01'), { user_id: 'ray-uid', date: '2026-10-01' });
  firestore.set('subscriptions/ray-uid', { user_id: 'ray-uid', plan: 'plus', status: 'active', stripe_subscription_id: 'sub_1' });
  firestore.set('analytics_sites/site-ray', { user_id: 'ray-uid' });

  const response = await deleteAccount('ray-uid');
  assert.equal(response.status, 200);

  for (const path of ['users/ray-uid', 'projects/p1', 'projects/p1/chunks/0', usageDocPath('ray-uid', '2026-10-01'), 'subscriptions/ray-uid', 'analytics_sites/site-ray', deploymentDocPath('ray/cafe-a1b2')]) {
    assert.equal(firestore.getData(path), null, path);
  }
  assert.ok(firestore.getData('usernames/ray'), 'the username stays reserved');
  assert.ok(firestore.getData('projects/p2') && firestore.getData('users/bob-uid') && firestore.getData(deploymentDocPath('bob/shop-1')), 'other accounts untouched');
  assert.equal([...r2.objects.keys()].some((key) => key.startsWith('ray-uid/')), false);
  assert.ok([...r2.objects.keys()].some((key) => key.startsWith('bob-uid/')));
  assert.deepEqual(stripeCalls, ['DELETE https://api.stripe.com/v1/subscriptions/sub_1']);
  assert.ok(calls.some((call) => call.url.endsWith('/accounts:delete')), 'the Auth user is deleted');
});
