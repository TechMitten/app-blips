// POST /api/account/delete: deletes the signed-in account and everything it
// owns. Server-side so it's complete regardless of client-side rules: a
// running Stripe subscription is cancelled, every Firestore doc keyed to the
// account and every published object goes, then the Firebase Auth user.
//
// The username stays reserved (usernames/{name} is kept): old links under it
// must never start pointing at someone else's apps.
//
// Requires a fresh sign-in (the client re-authenticates first), so a stolen
// hour-old token can't wipe an account.
import { authorize } from './chatProxy.js';
import { serviceAccountConfigured, runQuery, deleteWrite, commitAll, deleteAuthUser } from './firebaseServer.js';
import { removeAllDeploymentsFor } from './deploys.js';
import { cancelSubscriptionFor } from './billing.js';

const RECENT_SIGN_IN_SECONDS = 5 * 60;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// Paths of the account's docs in a top-level collection keyed by `user_id`.
const ownedDocs = async (env, collection, uid) =>
  (await runQuery(env, collection, { where: [['user_id', '==', uid]], select: ['user_id'] }))
    .map((doc) => `${collection}/${doc.id}`);

export async function handleAccountDelete(request, env) {
  if (!serviceAccountConfigured(env)) return json({ error: 'Account deletion is not available on this server.' }, 404);
  const user = await authorize(request, env);
  if (!user || user.id === 'local-user') return json({ error: 'Sign in required.' }, 401);
  if (!user.authTime || Date.now() / 1000 - user.authTime > RECENT_SIGN_IN_SECONDS) {
    return json({ error: 'Please sign in again to delete your account.', code: 'reauth' }, 403);
  }
  const uid = user.id;
  // Names the step that threw, so a failure is diagnosable from the response.
  let step = 'start';
  try {
    step = 'cancel subscription';
    await cancelSubscriptionFor(env, uid);
    step = 'remove deployments';
    await removeAllDeploymentsFor(env, uid);

    step = 'list projects';
    const projects = await ownedDocs(env, 'projects', uid);
    const chunkPaths = [];
    for (const project of projects) {
      const chunks = await runQuery(env, 'chunks', { parent: project, where: [['user_id', '==', uid]], select: ['user_id'] });
      chunkPaths.push(...chunks.map((chunk) => `${project}/chunks/${chunk.id}`));
    }
    step = 'list usage and analytics';
    const docs = [
      ...chunkPaths,
      ...projects,
      ...await ownedDocs(env, 'usage', uid),
      ...await ownedDocs(env, 'analytics_sites', uid),
      `subscriptions/${uid}`,
      `users/${uid}`,
    ];
    step = 'delete documents';
    await commitAll(env, docs.map((path) => deleteWrite(env, path)));

    step = 'delete auth user';
    await deleteAuthUser(env, uid);
    return json({ deleted: true });
  } catch (err) {
    console.error(`[account] delete failed at "${step}":`, err?.message || err);
    return json({ error: `Could not delete the account (failed at: ${step}). Please try again.` }, 502);
  }
}
