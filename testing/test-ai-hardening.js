// Regression tests for the /ai/chat hardening pass:
//   1. the per-IP limiter runs before any Firestore lookup
//   2. the deployment/token caches are bounded
//   3. an IP-rejected caller cannot drain a deployment's shared budget
//
// Each assertion is written so it would FAIL against the previous ordering,
// not merely pass against the new one.
import assert from 'node:assert/strict';
import {
  handleAiChat,
  validateDeploymentToken,
  clearAiCachesForTesting,
  aiCacheSizesForTesting,
} from '../functions/_lib/aiRelay.js';
import { clearRateLimitsForTesting } from '../functions/_lib/rateLimit.js';

const baseEnv = {
  FIREBASE_PROJECT_ID: 'test-project',
  APPBLIPS_APP_LLM_BASE_URL: 'https://provider.invalid/v1',
  APPBLIPS_APP_LLM_API_KEY: 'server-only-test-key',
  APPBLIPS_APP_LLM_MODEL: 'forced-model',
};

let firestoreCalls = 0;
const installFetch = ({ validToken } = {}) => {
  firestoreCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('firebaseappcheck.googleapis.com')) {
      return Response.json({ token: 'server-app-check', ttl: '3600s' });
    }
    if (target.includes('firestore.googleapis.com')) {
      firestoreCalls += 1;
      const asked = JSON.parse(options.body).structuredQuery.where.fieldFilter.value.stringValue;
      if (validToken && asked === validToken) {
        return Response.json([{ document: { fields: {
          aiEnabled: { booleanValue: true },
          aiToken: { stringValue: validToken },
        } } }]);
      }
      return Response.json([{}]);
    }
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  };
};

const request = (body, ip) => new Request('https://my.appblips.com/ai/chat', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://my.appblips.com',
    'cf-connecting-ip': ip,
  },
  body: JSON.stringify(body),
});

// --- 1. Rate limit precedes the Firestore lookup -------------------------
// Junk tokens from one IP used to buy one database query each, unthrottled.
clearRateLimitsForTesting();
clearAiCachesForTesting();
installFetch({});
const cheapEnv = { ...baseEnv, APPBLIPS_AI_RATE_LIMIT_MAX: '3', APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS: '60' };

let rejected = 0;
for (let i = 0; i < 25; i += 1) {
  const response = await handleAiChat(request({ token: `junk-${i}`, messages: [{ role: 'user', content: 'x' }] }, '203.0.113.9'), cheapEnv);
  if (response.status === 429) rejected += 1;
}
assert.equal(rejected, 22, 'IP limiter should reject everything past the third request');
assert.ok(firestoreCalls <= 3, `Firestore queried ${firestoreCalls}x behind a 3-request IP budget (was 25 before the fix)`);
console.log(`Rate limit precedes Firestore: ${firestoreCalls} queries for 25 junk requests.`);

// --- 2. Caches are bounded ----------------------------------------------
// Entries only ever expired logically; nothing deleted them, so unique keys
// grew the Map until the isolate was recycled.
clearAiCachesForTesting();
installFetch({});
const { limit } = aiCacheSizesForTesting();
for (let i = 0; i < limit + 250; i += 1) {
  await validateDeploymentToken(`unique-token-${i}`, baseEnv);
}
const sizes = aiCacheSizesForTesting();
assert.ok(sizes.tokens <= limit, `token cache grew to ${sizes.tokens}, above the ${limit} cap`);
console.log(`Caches bounded: ${limit + 250} unique tokens left ${sizes.tokens} entries (cap ${limit}).`);

// --- 3. An IP-rejected caller cannot drain the deployment budget ---------
// Previously the deployment bucket was consumed BEFORE the IP check, so an
// abuser being throttled still zeroed out the app for its real visitors.
clearRateLimitsForTesting();
clearAiCachesForTesting();
const sharedToken = 'shared-deployment-token';
installFetch({ validToken: sharedToken });
const splitEnv = {
  ...baseEnv,
  APPBLIPS_AI_RATE_LIMIT_MAX: '2',            // per IP
  APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS: '60',
  APPBLIPS_AI_DEPLOYMENT_RATE_LIMIT_MAX: '4', // per deployment, all visitors
  APPBLIPS_AI_DEPLOYMENT_RATE_LIMIT_WINDOW_SECONDS: '60',
};

const send = (ip) => handleAiChat(request({ token: sharedToken, messages: [{ role: 'user', content: 'x' }] }, ip), splitEnv);

const abuser = [];
for (let i = 0; i < 8; i += 1) abuser.push((await send('10.0.0.1')).status);
assert.deepEqual(abuser, [200, 200, 429, 429, 429, 429, 429, 429], 'abuser should be cut off by their own IP budget');

// The deployment had 4 tokens; the abuser legitimately spent 2. A different
// visitor must still get the remaining 2.
assert.equal((await send('10.0.0.2')).status, 200, 'victim request 1 starved by throttled abuser');
assert.equal((await send('10.0.0.3')).status, 200, 'victim request 2 starved by throttled abuser');
assert.equal((await send('10.0.0.4')).status, 429, 'deployment budget should now be exhausted');
console.log('Deployment budget survives a throttled abuser: 2 spent, 2 left for real visitors.');

console.log('AI hardening regression checks passed.');
