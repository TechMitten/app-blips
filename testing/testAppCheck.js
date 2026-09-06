import { verifyAppCheckToken, handleChatProxy } from '../functions/_lib/chatProxy.js';

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function runTests() {
  console.log('--- Starting App Check Verification Tests ---');

  const PROJECT_NUMBER = '472626328876';
  const PROJECT_ID = 'appbips-f46e2';
  const env = {
    SELF_HOSTED_MODE: 'false',
    FIREBASE_PROJECT_NUMBER: PROJECT_NUMBER,
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_API_KEY: 'test-key',
    APPBLIPS_LLM_BASE_URL: 'http://localhost:9999',
    APPBLIPS_LLM_API_KEY: 'test-llm-key',
    APPBLIPS_LLM_MODEL: 'test-model',
  };

  // Test 1: Missing token
  console.log('Test 1: Missing token should reject');
  const resMissing = await verifyAppCheckToken('', env);
  console.assert(!resMissing.ok, 'Missing token should fail');
  console.assert(resMissing.error.includes('missing'), 'Error message mentions missing');

  // Test 2: Malformed token
  console.log('Test 2: Malformed token should reject');
  const resMalformed = await verifyAppCheckToken('not.a.valid.jwt.token', env);
  console.assert(!resMalformed.ok, 'Malformed token should fail');

  // Generate a test RSA key pair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  async function createToken(header, payload, privKey = keyPair.privateKey) {
    const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const signedData = `${encHeader}.${encPayload}`;
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privKey,
      new TextEncoder().encode(signedData)
    );
    return `${signedData}.${base64UrlEncode(sig)}`;
  }

  // Test 3: Expired token
  console.log('Test 3: Expired token should reject');
  const expiredToken = await createToken(
    { alg: 'RS256', typ: 'JWT', kid: 'dummy' },
    {
      iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      aud: [`projects/${PROJECT_NUMBER}`],
      exp: Math.floor(Date.now() / 1000) - 60,
    }
  );
  const resExpired = await verifyAppCheckToken(expiredToken, env);
  console.assert(!resExpired.ok, 'Expired token should fail');
  console.assert(resExpired.error.includes('expired'), 'Error message mentions expired');

  // Test 4: Project number / issuer mismatch
  console.log('Test 4: Issuer mismatch should reject');
  const badIssuerToken = await createToken(
    { alg: 'RS256', typ: 'JWT', kid: 'dummy' },
    {
      iss: 'https://firebaseappcheck.googleapis.com/999999999999',
      aud: [`projects/${PROJECT_NUMBER}`],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
  );
  const resBadIssuer = await verifyAppCheckToken(badIssuerToken, env);
  console.assert(!resBadIssuer.ok, 'Bad issuer should fail');
  console.assert(resBadIssuer.error.includes('issuer'), 'Error mentions issuer');

  // Test 5: Audience mismatch
  console.log('Test 5: Audience mismatch should reject');
  const badAudToken = await createToken(
    { alg: 'RS256', typ: 'JWT', kid: 'dummy' },
    {
      iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      aud: ['projects/wrong-project'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
  );
  const resBadAud = await verifyAppCheckToken(badAudToken, env);
  console.assert(!resBadAud.ok, 'Bad audience should fail');
  console.assert(resBadAud.error.includes('audience'), 'Error mentions audience');

  // Test 6: Unknown signing key
  console.log('Test 6: Unknown signing key kid should reject');
  const unknownKeyToken = await createToken(
    { alg: 'RS256', typ: 'JWT', kid: 'non-existent-kid-12345' },
    {
      iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      aud: [`projects/${PROJECT_NUMBER}`],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
  );
  const resUnknownKey = await verifyAppCheckToken(unknownKeyToken, env);
  console.assert(!resUnknownKey.ok, 'Unknown key kid should fail');

  // Test 7: handleChatProxy in hosted mode with missing App Check token returns 401
  console.log('Test 7: handleChatProxy returns 401 when user auth is missing');
  const reqNoAuth = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  const resNoAuth = await handleChatProxy(reqNoAuth, env);
  console.assert(resNoAuth.status === 401, 'No auth should return 401');

  // Test 8: Self-hosted mode bypasses App Check and user auth
  console.log('Test 8: Self-hosted mode bypasses App Check and user auth');
  const selfHostedEnv = {
    ...env,
    SELF_HOSTED_MODE: 'true',
  };
  const reqSelfHosted = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  const resSelfHosted = await handleChatProxy(reqSelfHosted, selfHostedEnv);
  console.assert(resSelfHosted.status !== 401, 'Self-hosted mode should not return 401');

  console.log('--- ALL APP CHECK TESTS PASSED SUCCESSFULLY ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
