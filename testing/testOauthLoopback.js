// Desktop OAuth loopback listener (electron/oauthLoopback.js).
// Run: node --test testing/testOauthLoopback.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOAuthLoopback, isSupabaseAuthorizeUrl } from '../electron/oauthLoopback.js';

test('resolves with the code from the callback and serves a done page', async () => {
  const loopback = createOAuthLoopback();
  const { redirectUri, result } = await loopback.begin();
  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  const res = await fetch(`${redirectUri}?code=abc123`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /signed in/i);
  assert.deepEqual(await result, { code: 'abc123' });
});

test('rejects with the provider error and escapes it in the page', async () => {
  const loopback = createOAuthLoopback();
  const { redirectUri, result } = await loopback.begin();
  const failed = assert.rejects(result, /access_denied/);
  const res = await fetch(`${redirectUri}?error_description=${encodeURIComponent('<b>access_denied</b>')}`);
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.ok(!html.includes('<b>access_denied</b>'));
  await failed;
});

test('ignores other paths and methods', async () => {
  const loopback = createOAuthLoopback();
  const { redirectUri, result } = await loopback.begin();
  const base = redirectUri.replace('/auth/callback', '');
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(redirectUri, { method: 'POST' })).status, 404);
  loopback.cancel();
  await assert.rejects(result, /cancelled/);
});

test('starting again cancels the sign-in still waiting', async () => {
  const loopback = createOAuthLoopback();
  const first = await loopback.begin();
  const second = await loopback.begin();
  await assert.rejects(first.result, /cancelled/);
  await fetch(`${second.redirectUri}?code=z`);
  assert.deepEqual(await second.result, { code: 'z' });
});

test('times out', async () => {
  const loopback = createOAuthLoopback({ timeoutMs: 20 });
  const { result } = await loopback.begin();
  await assert.rejects(result, /timed out/);
});

test('only the project authorize endpoint may be opened', () => {
  const base = 'https://proj.supabase.co';
  assert.ok(isSupabaseAuthorizeUrl(`${base}/auth/v1/authorize?provider=github`, base));
  assert.ok(!isSupabaseAuthorizeUrl('https://evil.example/auth/v1/authorize', base));
  assert.ok(!isSupabaseAuthorizeUrl(`${base}/auth/v1/user`, base));
  assert.ok(!isSupabaseAuthorizeUrl('http://proj.supabase.co/auth/v1/authorize', base));
  assert.ok(!isSupabaseAuthorizeUrl('file:///etc/passwd', base));
  assert.ok(!isSupabaseAuthorizeUrl('nonsense', base));
});
