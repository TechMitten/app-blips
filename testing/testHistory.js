// Version history in R2, end to end: the browser-side store
// (src/lib/historyArchive.js) talking through a mocked fetch to the real
// /api/history handlers (functions/_lib/history.js), which write to a fake R2
// bucket. Covers that versions only lose their pages once R2 has them, that
// restores return the exact HTML, and that one account can't reach another's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleHistoryPages, handleHistoryFetch, handleHistoryDelete, removeAllHistoryFor } from '../functions/_lib/history.js';
import { createHistoryStore, KEEP_FULL_VERSIONS, isArchivedVersion, hashPage } from '../src/lib/historyArchive.js';
import { installFirebaseFake, firebaseEnv, signIdToken, createR2, R2_ENV } from './firebaseFake.js';

const HISTORY_BUCKET = 'orion-history';
const env = firebaseEnv({ ...R2_ENV, R2_HISTORY_BUCKET: HISTORY_BUCKET });
const PROJECT = '11111111-2222-4333-8444-555555555555';
const OTHER_PROJECT = '66666666-7777-4888-9999-aaaaaaaaaaaa';

const page = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head><body>${title}</body></html>`;

const routes = {
  '/api/history/pages': { POST: handleHistoryPages },
  '/api/history/fetch': { POST: handleHistoryFetch },
  '/api/history': { DELETE: handleHistoryDelete },
};

// Fake Firebase + R2, with /api/history/* answered by the real handlers.
// `serverEnv` lets a test switch history storage off.
const setup = (t, { serverEnv = env, failUploads = false } = {}) => {
  const history = createR2(HISTORY_BUCKET);
  const apiCalls = [];
  const fake = installFirebaseFake(t, {
    fallback: async (url, init) => {
      if (url.startsWith(history.prefix)) return history.handle(url, init);
      const path = url.split('?')[0];
      const handler = routes[path]?.[init.method || 'GET'];
      if (!handler) throw new Error(`Unexpected fetch in test: ${init.method || 'GET'} ${url}`);
      apiCalls.push(`${init.method} ${path}`);
      if (failUploads && path === '/api/history/pages') return Response.json({ error: 'down' }, { status: 500 });
      return handler(new Request(`https://app.example${url}`, init), serverEnv);
    },
  });
  return { ...fake, history, apiCalls };
};

const storeFor = (uid) => createHistoryStore({ getIdToken: () => signIdToken(uid) });

// `count` versions; each changes index.html, and about.html never changes.
const makeVersions = (count) => Array.from({ length: count }, (_, i) => ({
  id: i + 1,
  prompt: `Change ${i + 1}`,
  reply: `Done ${i + 1}`,
  sessionId: 's1',
  files: { 'index.html': page(`Home v${i + 1}`), 'about.html': page('About') },
}));

test(`only versions older than the newest ${KEEP_FULL_VERSIONS} are archived, and identical pages are stored once`, async (t) => {
  const { history } = setup(t);
  const store = storeFor('ray-uid');
  const versions = makeVersions(KEEP_FULL_VERSIONS + 3);

  const saved = await store.archiveVersions(PROJECT, versions);
  assert.equal(saved.length, versions.length);
  for (let i = 0; i < saved.length; i += 1) {
    assert.equal(isArchivedVersion(saved[i]), i < 3, `version ${i + 1}`);
  }
  // Everything but the pages stays inline.
  assert.equal(saved[0].prompt, 'Change 1');
  assert.equal(saved[0].reply, 'Done 1');
  assert.equal(saved[0].sessionId, 's1');
  assert.equal(saved[0].pageRefs['index.html'], await hashPage(page('Home v1')));
  assert.equal(saved[0].files, undefined);
  // The workspace's own objects aren't touched.
  assert.ok(versions[0].files);

  // 3 distinct landing pages + 1 shared about page.
  const keys = [...history.objects.keys()];
  assert.equal(keys.length, 4);
  assert.ok(keys.every((key) => key.startsWith(`ray-uid/${PROJECT}/`) && key.endsWith('.html')));
});

test('the open version stays inline even when it is old', async (t) => {
  setup(t);
  const saved = await storeFor('ray-uid').archiveVersions(PROJECT, makeVersions(KEEP_FULL_VERSIONS + 3), 1);
  assert.equal(isArchivedVersion(saved[0]), true);
  assert.equal(isArchivedVersion(saved[1]), false);
  assert.equal(isArchivedVersion(saved[2]), true);
});

test('restoring an archived version returns its exact pages, from cache the second time', async (t) => {
  const { apiCalls } = setup(t);
  const versions = makeVersions(KEEP_FULL_VERSIONS + 2);
  const saved = await storeFor('ray-uid').archiveVersions(PROJECT, versions);

  // A fresh session (no cache), as after reopening the project.
  const reopened = storeFor('ray-uid');
  assert.deepEqual(await reopened.ensureVersionFiles(PROJECT, saved[1]), versions[1].files);
  const fetches = apiCalls.filter((call) => call.endsWith('/fetch')).length;
  assert.deepEqual(await reopened.ensureVersionFiles(PROJECT, saved[1]), versions[1].files);
  assert.equal(apiCalls.filter((call) => call.endsWith('/fetch')).length, fetches, 'no refetch');

  // An inline version needs no request at all.
  assert.deepEqual(await reopened.ensureVersionFiles(PROJECT, saved.at(-1)), versions.at(-1).files);
});

test('a failed upload leaves every version inline', async (t) => {
  setup(t, { failUploads: true });
  const versions = makeVersions(KEEP_FULL_VERSIONS + 2);
  const saved = await storeFor('ray-uid').archiveVersions(PROJECT, versions);
  assert.equal(saved, versions);
  assert.equal(saved.some(isArchivedVersion), false);
});

test('a later save re-uses earlier uploads instead of re-sending them', async (t) => {
  const { apiCalls } = setup(t);
  const store = storeFor('ray-uid');
  const versions = makeVersions(KEEP_FULL_VERSIONS + 1);
  await store.archiveVersions(PROJECT, versions);
  const uploads = apiCalls.filter((call) => call.endsWith('/pages')).length;
  await store.archiveVersions(PROJECT, versions);
  assert.equal(apiCalls.filter((call) => call.endsWith('/pages')).length, uploads);
});

test('with history storage switched off, nothing is archived and the store stops asking', async (t) => {
  const { apiCalls } = setup(t, { serverEnv: firebaseEnv({ ...R2_ENV }) });
  const store = storeFor('ray-uid');
  const versions = makeVersions(KEEP_FULL_VERSIONS + 2);
  assert.equal(await store.archiveVersions(PROJECT, versions), versions);
  assert.equal(await store.archiveVersions(PROJECT, versions), versions);
  assert.equal(apiCalls.length, 1, 'one 501, then no more requests');
});

test('one account cannot read or delete another\'s history', async (t) => {
  const { history } = setup(t);
  const versions = makeVersions(KEEP_FULL_VERSIONS + 1);
  const saved = await storeFor('ray-uid').archiveVersions(PROJECT, versions);

  await assert.rejects(storeFor('bob-uid').ensureVersionFiles(PROJECT, saved[0]), /could not be loaded/);
  await storeFor('bob-uid').deleteProjectHistory(PROJECT);
  assert.ok(history.objects.size > 0, 'bob\'s delete only covers bob\'s prefix');
});

test('the server rejects a page whose hash does not match, bad ids and missing sign-in', async (t) => {
  setup(t);
  const post = async (body, headers) => handleHistoryPages(new Request('https://app.example/api/history/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }), env);
  const auth = { authorization: `Bearer ${await signIdToken('ray-uid')}` };
  const html = page('Home');

  assert.equal((await post({ projectId: PROJECT, pages: [{ hash: await hashPage(html), html }] }, auth)).status, 200);
  assert.equal((await post({ projectId: PROJECT, pages: [{ hash: await hashPage('other'), html }] }, auth)).status, 400);
  assert.equal((await post({ projectId: '../x', pages: [] }, auth)).status, 400);
  assert.equal((await post({ projectId: PROJECT, pages: [{ hash: 'x', html }] }, auth)).status, 400);
  assert.equal((await post({ projectId: PROJECT, pages: [] }, {})).status, 401);
});

test('deleting a project removes only its history; deleting the account removes all of it', async (t) => {
  const { history } = setup(t);
  const versions = makeVersions(KEEP_FULL_VERSIONS + 1);
  await storeFor('ray-uid').archiveVersions(PROJECT, versions);
  await storeFor('ray-uid').archiveVersions(OTHER_PROJECT, makeVersions(KEEP_FULL_VERSIONS + 1));
  await storeFor('bob-uid').archiveVersions(PROJECT, makeVersions(KEEP_FULL_VERSIONS + 1));

  await storeFor('ray-uid').deleteProjectHistory(PROJECT);
  const keys = () => [...history.objects.keys()];
  assert.equal(keys().some((key) => key.startsWith(`ray-uid/${PROJECT}/`)), false);
  assert.ok(keys().some((key) => key.startsWith(`ray-uid/${OTHER_PROJECT}/`)));

  await removeAllHistoryFor(env, 'ray-uid');
  assert.equal(keys().some((key) => key.startsWith('ray-uid/')), false);
  assert.ok(keys().some((key) => key.startsWith('bob-uid/')), 'other accounts untouched');
});
