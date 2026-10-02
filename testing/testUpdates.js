// Self-hosted update check (src/lib/updates.js).
// Run: node --test testing/testUpdates.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions, parseLatestRelease, checkForUpdate, CHECK_CACHE_KEY, CHECK_INTERVAL_MS, RELEASES_URL,
} from '../src/lib/updates.js';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/TechMitten/app-blips/releases/tag/${tag}`, ...extra });
const github = (status, body, calls) => async (url) => {
  calls?.push(url);
  return new Response(JSON.stringify(body), { status });
};

test('compareVersions orders releases, with pre-releases before their release', () => {
  assert.ok(compareVersions('0.2.0', '0.1.0') > 0);
  assert.ok(compareVersions('v1.0.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('0.1.0', '0.1.1') < 0);
  assert.equal(compareVersions('0.1.0', 'v0.1.0'), 0);
  assert.ok(compareVersions('0.2.0', '0.2.0-beta.1') > 0);
  assert.ok(compareVersions('0.2.0-beta.2', '0.2.0-beta.1') > 0);
  assert.equal(compareVersions('garbage', '0.1.0'), 0);
});

test('parseLatestRelease skips drafts, pre-releases and odd tags, and only links into the repo', () => {
  assert.deepEqual(parseLatestRelease(release('v0.2.0')), { version: '0.2.0', url: 'https://github.com/TechMitten/app-blips/releases/tag/v0.2.0' });
  assert.equal(parseLatestRelease(release('v0.2.0', { draft: true })), null);
  assert.equal(parseLatestRelease(release('v0.2.0', { prerelease: true })), null);
  assert.equal(parseLatestRelease(release('nightly')), null);
  assert.equal(parseLatestRelease(release('v0.2.0', { html_url: 'https://evil.example/x' })).url, RELEASES_URL);
  assert.equal(parseLatestRelease(null), null);
});

test('checkForUpdate reports only newer releases', async () => {
  assert.deepEqual(
    await checkForUpdate({ current: '0.1.0', fetchImpl: github(200, release('v0.2.0')) }),
    { version: '0.2.0', url: 'https://github.com/TechMitten/app-blips/releases/tag/v0.2.0' },
  );
  assert.equal(await checkForUpdate({ current: '0.2.0', fetchImpl: github(200, release('v0.2.0')) }), null);
  assert.equal(await checkForUpdate({ current: '0.3.0', fetchImpl: github(200, release('v0.2.0')) }), null);
});

test('no releases yet, or GitHub failing, means no update and no crash', async () => {
  assert.equal(await checkForUpdate({ current: '0.1.0', fetchImpl: github(404, { message: 'Not Found' }) }), null);
  assert.equal(await checkForUpdate({ current: '0.1.0', fetchImpl: github(403, { message: 'rate limited' }) }), null);
  assert.equal(await checkForUpdate({ current: '0.1.0', fetchImpl: async () => { throw new Error('offline'); } }), null);
});

test('answers are cached for the check interval, then refreshed', async () => {
  const storage = memoryStorage();
  const calls = [];
  const now = 1_000_000;
  await checkForUpdate({ current: '0.1.0', storage, now, fetchImpl: github(200, release('v0.2.0'), calls) });
  const cached = await checkForUpdate({ current: '0.1.0', storage, now: now + 1000, fetchImpl: github(200, release('v0.3.0'), calls) });
  assert.equal(calls.length, 1);
  assert.equal(cached.version, '0.2.0');
  const refreshed = await checkForUpdate({ current: '0.1.0', storage, now: now + CHECK_INTERVAL_MS + 1, fetchImpl: github(200, release('v0.3.0'), calls) });
  assert.equal(calls.length, 2);
  assert.equal(refreshed.version, '0.3.0');
  assert.ok(JSON.parse(storage.map.get(CHECK_CACHE_KEY)).checkedAt > now);
});
