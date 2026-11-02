// Self-hosted update check (src/lib/updates.js).
// Run: node --test testing/testUpdates.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions, parseLatestRelease, checkForUpdate, debUpdateCommand, CHECK_CACHE_KEY, CHECK_INTERVAL_MS, RELEASES_URL,
} from '../src/lib/updates.js';
import { debInstall, APT_SOURCE_FILES } from '../electron/debInstall.js';

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

test('a forced check (Settings → Check now) skips the cache and reports failures', async () => {
  const storage = memoryStorage();
  const calls = [];
  const now = 1_000_000;
  await checkForUpdate({ current: '0.1.0', storage, now, fetchImpl: github(200, release('v0.2.0'), calls) });
  const forced = await checkForUpdate({ current: '0.1.0', storage, now: now + 1000, force: true, fetchImpl: github(200, release('v0.3.0'), calls) });
  assert.equal(calls.length, 2);
  assert.equal(forced.version, '0.3.0');
  await assert.rejects(checkForUpdate({ current: '0.1.0', storage, force: true, fetchImpl: github(403, { message: 'rate limited' }) }));
  assert.equal(await checkForUpdate({ current: '0.1.0', force: true, fetchImpl: github(404, { message: 'Not Found' }) }), null);
});

test('debUpdateCommand: apt upgrade with the source, else the downloaded .deb by name', () => {
  assert.equal(debUpdateCommand({ apt: true, downloadUrl: 'https://github.com/TechMitten/app-blips/releases/download/v0.2.0/AppBlips-0.2.0.deb' }), 'sudo apt update && sudo apt upgrade');
  assert.equal(debUpdateCommand({ downloadUrl: 'https://github.com/TechMitten/app-blips/releases/download/v0.2.0/AppBlips-0.2.0.deb' }), 'sudo apt install ~/Downloads/AppBlips-0.2.0.deb');
  // Anything that isn't a plain file name never reaches the command.
  assert.equal(debUpdateCommand({ downloadUrl: 'https://github.com/x/y/releases/download/v1/a%3Brm%20-rf.deb' }), 'sudo apt install ~/Downloads/AppBlips-*.deb');
  assert.equal(debUpdateCommand({ downloadUrl: 'https://github.com/x/y/releases/download/v1/%E0%A4%A' }), 'sudo apt install ~/Downloads/AppBlips-*.deb');
  assert.equal(debUpdateCommand({}), 'sudo apt install ~/Downloads/AppBlips-*.deb');
});

test('debInstall: only packaged non-AppImage Linux, apt when the source file exists', () => {
  const has = (files) => (f) => files.includes(f);
  assert.equal(debInstall({ isPackaged: false, platform: 'linux', env: {}, exists: has([]) }), null);
  assert.equal(debInstall({ isPackaged: true, platform: 'win32', env: {}, exists: has([]) }), null);
  assert.equal(debInstall({ isPackaged: true, platform: 'linux', env: { APPIMAGE: '/x.AppImage' }, exists: has([]) }), null);
  assert.deepEqual(debInstall({ isPackaged: true, platform: 'linux', env: {}, exists: has([]) }), { deb: true, apt: false });
  assert.deepEqual(debInstall({ isPackaged: true, platform: 'linux', env: {}, exists: has([APT_SOURCE_FILES[0]]) }), { deb: true, apt: true });
  assert.deepEqual(debInstall({ isPackaged: true, platform: 'linux', env: {}, exists: () => { throw new Error('EACCES'); } }), { deb: true, apt: false });
});
