// Per-account API usage counters (hosted mode only) -- observability, not a
// billing boundary. One doc per account per UTC day in Firestore's `usage`
// collection: { user_id, date, builderRequests, deployedRequests, updatedAt }.
//
// The write is authenticated with this server's own App Check token (the
// same one firebaseServer.js already mints for reading `deployments`), not
// the caller's identity -- chatProxy.js has a verified end-user ID token but
// that's irrelevant to authorizing *this* write, and aiRelay.js has no user
// identity at all (the caller is an anonymous visitor of a deployed app).
// firestore.rules constrains what this credential is allowed to write
// (known fields only, each counter increments by at most 1 per call).
import { firebaseProjectId, getAppCheckToken } from './firebaseServer.js';

const COUNTER_FIELDS = { builder: 'builderRequests', deployed: 'deployedRequests' };
const TOKEN_FIELDS = { builder: 'builderTokens', deployed: 'deployedTokens' };

const commitUrl = (env) =>
  `https://firestore.googleapis.com/v1/projects/${firebaseProjectId(env)}/databases/(default)/documents:commit`;

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Best-effort: a Firestore hiccup here must never break app generation or a
// deployed app's AI feature, so every failure is caught and logged, never
// thrown. Self-hosted mode has no Firebase project to write to.
export async function recordApiUsage(env, { uid, kind, tokens }) {
  const counterField = COUNTER_FIELDS[kind];
  const tokenField = TOKEN_FIELDS[kind];
  if (!uid || !counterField) return;
  if (env?.SELF_HOSTED_MODE !== 'false') return;

  const date = todayUtc();
  const documentName = `projects/${firebaseProjectId(env)}/databases/(default)/documents/usage/${uid}_${date}`;

  try {
    const headers = { 'content-type': 'application/json' };
    const appCheckToken = await getAppCheckToken(env);
    if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;

    // A single Write combining `update` (masked to user_id/date, so it never
    // touches the counters) with `updateTransforms` (increment + server
    // timestamp) -- the same shape the Admin SDK compiles
    // set({...}, {merge:true}) + FieldValue.increment() down to. Creates the
    // doc on the first write of the day, increments it thereafter, atomically.
    
    const updateTransforms = [
      { fieldPath: counterField, increment: { integerValue: '1' } },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ];
    if (tokens) {
      updateTransforms.push({ fieldPath: tokenField, increment: { integerValue: String(tokens) } });
    }

    const response = await fetch(commitUrl(env), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: documentName,
              fields: {
                user_id: { stringValue: uid },
                date: { stringValue: date },
              },
            },
            updateMask: { fieldPaths: ['user_id', 'date'] },
            updateTransforms,
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[usage-tracking] commit failed:', response.status, detail.slice(0, 200));
    }
  } catch (err) {
    console.error('[usage-tracking]', err?.message || err);
  }
}

// Runs recordApiUsage off the response's critical path. Under Cloudflare
// Pages/Workers, `waitUntil` keeps the isolate alive until the write lands;
// elsewhere (Vite dev middleware, Docker's server.js) there's no such hook,
// so the promise just runs un-awaited -- recordApiUsage handles its own
// errors, so nothing needs to observe how it settles.
export function trackApiUsage(env, args, waitUntil) {
  const promise = recordApiUsage(env, args);
  if (typeof waitUntil === 'function') waitUntil(promise);
}
