import assert from 'node:assert/strict';
import { signSessionToken, verifySessionToken } from '../functions/_lib/aiSession.js';
import { handleAiSession, handleAiChat, clearAiCachesForTesting } from '../functions/_lib/aiRelay.js';
import { clearRateLimitsForTesting } from '../functions/_lib/rateLimit.js';

const providerSecret = 'server-only-provider-key';
const sessionSecret = 'session-signing-secret';
const slug = 'alice/cook-app';

const baseEnv = {
  FIREBASE_PROJECT_ID: 'test-project',
  APPBLIPS_LLM_BASE_URL: 'https://provider.invalid/v1',
  APPBLIPS_LLM_API_KEY: providerSecret,
  APPBLIPS_LLM_MODEL: 'forced-model',
  APPBLIPS_APP_AI_MAX_TOKENS: '100',
  APPBLIPS_AI_RATE_LIMIT_MAX: '20',
  APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS: '60',
  APPBLIPS_SESSION_SECRET: sessionSecret,
};

const deploymentFields = (gen, enabled = true) => ({
  slug: { stringValue: slug },
  aiEnabled: { booleanValue: enabled },
  aiTokenGeneration: { integerValue: String(gen) },
});

const installFetch = ({ gen = 1, enabled = true, turnstileSuccess = true } = {}) => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('firebaseappcheck.googleapis.com')) {
      return Response.json({ token: 'server-app-check', ttl: '3600s' });
    }
    if (target.includes('challenges.cloudflare.com')) {
      return Response.json({ success: turnstileSuccess });
    }
    if (target.includes('firestore.googleapis.com')) {
      const query = JSON.parse(options.body);
      assert.equal(query.structuredQuery.where.fieldFilter.field.fieldPath, 'slug');
      assert.equal(query.structuredQuery.where.fieldFilter.value.stringValue, slug);
      return Response.json([{ document: { fields: deploymentFields(gen, enabled) } }]);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
};

const sessionRequest = (body) => new Request('https://my.appblips.com/ai/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://my.appblips.com' },
  body: JSON.stringify(body),
});

const chatRequest = (body) => new Request('https://my.appblips.com/ai/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://my.appblips.com' },
  body: JSON.stringify(body),
});

const assertNoSecret = async (response) => {
  const body = await response.clone().text();
  assert.equal(body.includes(providerSecret), false, 'provider key leaked in response');
};

// --- Token signing ---
const signed = await signSessionToken({ slug, gen: 3 }, baseEnv);
const claims = await verifySessionToken(signed.token, baseEnv);
assert.equal(claims.slug, slug);
assert.equal(claims.gen, 3);
assert.equal(await verifySessionToken(signed.token, { ...baseEnv, APPBLIPS_SESSION_SECRET: 'other-secret' }), null);
assert.equal(await verifySessionToken('garbage', baseEnv), null);
const tampered = signed.token.slice(0, -1) + (signed.token.endsWith('A') ? 'B' : 'A');
assert.equal(await verifySessionToken(tampered, baseEnv), null);

const realNow = Date.now;
Date.now = () => realNow() + 2_000_000;
assert.equal(await verifySessionToken(signed.token, baseEnv), null, 'expired token accepted');
Date.now = realNow;
console.log('Session token signing checks passed.');

// --- Mint endpoint ---
clearRateLimitsForTesting();
clearAiCachesForTesting();
installFetch();

let response = await handleAiSession(sessionRequest({ slug }), { ...baseEnv, TURNSTILE_SECRET: 'ts-secret' });
assert.equal(response.status, 403, 'mint without Turnstile token must fail when configured');
await assertNoSecret(response);

response = await handleAiSession(sessionRequest({ slug, turnstileToken: 'good' }), { ...baseEnv, TURNSTILE_SECRET: 'ts-secret' });
assert.equal(response.status, 200);
const minted = await response.json();
const mintedClaims = await verifySessionToken(minted.token, baseEnv);
assert.equal(mintedClaims.slug, slug);
assert.equal(mintedClaims.gen, 1);
assert.ok(minted.expiresAt > Date.now());

clearAiCachesForTesting();
installFetch({ gen: 2 });
response = await handleAiSession(sessionRequest({ slug }), baseEnv);
assert.equal(response.status, 200, 'ungated mint should work without TURNSTILE_SECRET');
assert.equal((await verifySessionToken((await response.json()).token, baseEnv)).gen, 2);

clearAiCachesForTesting();
installFetch({ enabled: false });
response = await handleAiSession(sessionRequest({ slug }), baseEnv);
assert.equal(response.status, 403, 'mint must fail for an AI-disabled deployment');
console.log('Session mint checks passed.');

// --- Chat accepts session tokens + revocation ---
clearRateLimitsForTesting();
clearAiCachesForTesting();
installFetch({ gen: 5 });
const session5 = await signSessionToken({ slug, gen: 5 }, baseEnv);
response = await handleAiChat(chatRequest({ token: session5.token, messages: [{ role: 'user', content: 'hi' }] }), baseEnv);
assert.equal(response.status, 200, 'valid session token rejected');
await assertNoSecret(response);

clearAiCachesForTesting();
installFetch({ gen: 6 });
response = await handleAiChat(chatRequest({ token: session5.token, messages: [{ role: 'user', content: 'hi' }] }), baseEnv);
assert.equal(response.status, 403, 'revoked generation still accepted');
await assertNoSecret(response);

response = await handleAiChat(chatRequest({ token: 'legacy-static-token', messages: [{ role: 'user', content: 'hi' }] }), { ...baseEnv, APPBLIPS_AI_REQUIRE_SESSION: 'true' });
assert.equal(response.status, 403, 'legacy token accepted while REQUIRE_SESSION=true');

response = await handleAiChat(chatRequest({ token: session5.token, messages: [{ role: 'user', content: 'hi' }] }), { ...baseEnv, APPBLIPS_SESSION_SECRET: 'other-secret', APPBLIPS_AI_REQUIRE_SESSION: 'true' });
assert.equal(response.status, 403, 'wrong-secret session token accepted');
await assertNoSecret(response);
console.log('Session chat/revocation checks passed.');

console.log('AI session security checks passed.');
