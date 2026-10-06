// Firebase ID token verification (functions/_lib/firebaseServer.js) and the
// R2 request signer (functions/_lib/r2.js) -- the two pieces of server-side
// crypto that gate everything multi-user.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyIdToken, serviceAccount } from '../functions/_lib/firebaseServer.js';
import { sigV4Authorization } from '../functions/_lib/r2.js';
import { installFirebaseFake, signIdToken, firebaseEnv, PROJECT_ID, SERVICE_ACCOUNT } from './firebaseFake.js';

const env = firebaseEnv();
const now = () => Math.floor(Date.now() / 1000);

test('a valid token yields the user, with email only when verified', async (t) => {
  installFirebaseFake(t);
  const user = await verifyIdToken(await signIdToken('uid-1'), env);
  assert.equal(user.id, 'uid-1');
  assert.equal(user.email, 'uid-1@example.com');
  assert.ok(user.authTime > 0);

  const unverified = await verifyIdToken(await signIdToken('uid-2', { claims: { email_verified: false } }), env);
  assert.equal(unverified.id, 'uid-2');
  assert.equal(unverified.email, null);
});

test('tokens that are expired, for another project, unsigned or forged are refused', async (t) => {
  t.mock.method(console, 'error', () => {});
  installFirebaseFake(t);
  const refused = {
    expired: await signIdToken('u', { claims: { exp: now() - 3600 } }),
    'issued in the future': await signIdToken('u', { claims: { iat: now() + 3600 } }),
    'signed in in the future': await signIdToken('u', { claims: { auth_time: now() + 3600 } }),
    'other audience': await signIdToken('u', { claims: { aud: 'someone-else' } }),
    'other issuer': await signIdToken('u', { claims: { iss: 'https://securetoken.google.com/someone-else' } }),
    'no subject': await signIdToken('', {}),
    'unknown key': await signIdToken('u', { header: { kid: 'nope' } }),
    'wrong key': await signIdToken('u', { key: 'other' }),
    'alg none': await signIdToken('u', { header: { alg: 'none' } }),
    'HS256': await signIdToken('u', { header: { alg: 'HS256' } }),
  };
  for (const [name, token] of Object.entries(refused)) {
    assert.equal(await verifyIdToken(token, env), null, name);
  }
  const good = await signIdToken('u');
  const [head, body] = good.split('.');
  const tampered = `${head}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), sub: 'admin' })).toString('base64url')}.${good.split('.')[2]}`;
  assert.equal(await verifyIdToken(tampered, env), null, 'payload swapped under a valid signature');
  for (const junk of ['', 'a.b', 'a.b.c', null, undefined, 42]) assert.equal(await verifyIdToken(junk, env), null, String(junk));
});

test('a token is checked against the configured project only', async (t) => {
  installFirebaseFake(t);
  const token = await signIdToken('uid-1');
  assert.equal(await verifyIdToken(token, {}), null, 'no project configured');
  assert.equal(await verifyIdToken(token, { FIREBASE_PROJECT_ID: `${PROJECT_ID}-staging` }), null);
  assert.equal((await verifyIdToken(token, { VITE_FIREBASE_PROJECT_ID: PROJECT_ID })).id, 'uid-1');
});

test('signing keys are cached, and an unknown kid refetches at most once a minute', async (t) => {
  const { calls } = installFirebaseFake(t);
  const jwksCalls = () => calls.filter((call) => call.url.includes('/jwk/securetoken')).length;
  await verifyIdToken(await signIdToken('a'), env);
  await verifyIdToken(await signIdToken('b'), env);
  assert.equal(jwksCalls(), 1);
  await verifyIdToken(await signIdToken('c', { header: { kid: 'rotated' } }), env);
  await verifyIdToken(await signIdToken('d', { header: { kid: 'rotated-again' } }), env);
  assert.equal(jwksCalls(), 1, 'junk kids cannot make every request hit Google');
});

test('the service account is read from raw or base64 JSON', () => {
  assert.equal(serviceAccount({ FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT }).project_id, PROJECT_ID);
  assert.equal(serviceAccount({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(SERVICE_ACCOUNT).toString('base64') }).project_id, PROJECT_ID);
});

test('SigV4 matches the AWS test suite (get-vanilla)', async () => {
  const authorization = await sigV4Authorization({
    method: 'GET',
    path: '/',
    queryString: '',
    headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    amzDate: '20150830T123600Z',
    region: 'us-east-1',
    service: 'service',
    accessKeyId: 'AKIDEXAMPLE',
    secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  });
  assert.equal(
    authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});
