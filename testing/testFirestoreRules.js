// firestore.rules against the Firestore emulator. Needs Java and the
// Firebase CLI; run with `npm run test:rules`. Skipped (passes) when no
// emulator is running, so the plain `node testing/*.js` loop still works.
//
// Writes go through the real client SDK, in the exact shapes
// src/lib/username.js and src/lib/cloudProjects.js use.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, after } from 'node:test';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('skipped: FIRESTORE_EMULATOR_HOST is not set (run `npm run test:rules`)');
  process.exit(0);
}

const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, orderBy,
  serverTimestamp, Bytes,
} = await import('firebase/firestore');

const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-appblips',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
});
after(() => testEnv.cleanup());

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const seed = (fn) => testEnv.withSecurityRulesDisabled((context) => fn(context.firestore()));

const claim = (db, uid, username) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', username), { uid, created_at: serverTimestamp() });
  batch.set(doc(db, 'users', uid), { username, updated_at: serverTimestamp() });
  return batch.commit();
};

const saveProject = (db, uid, id, { chunks = 1, rev = 'r1', owner = uid, summary = {} } = {}) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'projects', id), {
    user_id: owner, name: 'App', updated_at: serverTimestamp(), rev, chunk_count: chunks, size: 3, encoding: 'gzip', ...summary,
  });
  for (let n = 0; n < chunks; n += 1) {
    batch.set(doc(db, 'projects', id, 'chunks', String(n)), { user_id: owner, rev, data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])) });
  }
  return batch.commit();
};

test.beforeEach(() => testEnv.clearFirestore());

test('a username is claimed once, in a pair, and can never be taken or changed', async () => {
  const alice = as('alice');
  await assertSucceeds(claim(alice, 'alice', 'alice'));
  await assertSucceeds(getDoc(doc(alice, 'users', 'alice')));
  await assertSucceeds(getDoc(doc(alice, 'usernames', 'alice')));

  const bob = as('bob');
  await assertFails(claim(bob, 'bob', 'alice'));
  await assertFails(getDoc(doc(bob, 'usernames', 'alice')));
  await assertFails(getDoc(doc(bob, 'users', 'alice')));

  // Alice can't take a second name, rename, or release hers.
  await assertFails(claim(alice, 'alice', 'alice2'));
  await assertFails(updateDoc(doc(alice, 'users', 'alice'), { username: 'other', updated_at: serverTimestamp() }));
  await assertFails(deleteDoc(doc(alice, 'usernames', 'alice')));
  await assertFails(deleteDoc(doc(alice, 'users', 'alice')));

  // Half a claim, a claim for someone else, or a bad name is refused.
  await assertFails(setDoc(doc(bob, 'usernames', 'bobby'), { uid: 'bob', created_at: serverTimestamp() }));
  await assertFails(setDoc(doc(bob, 'users', 'bob'), { username: 'bobby', updated_at: serverTimestamp() }));
  await assertFails(claim(bob, 'carol', 'bobby'));
  await assertFails(claim(bob, 'bob', 'Bob'));
  await assertFails(claim(bob, 'bob', 'ab'));
  await assertSucceeds(claim(bob, 'bob', 'bob-2'));
});

test('a username can\'t take over someone else\'s bare deploy slug', async () => {
  await seed((db) => Promise.all([
    setDoc(doc(db, 'deployments', 'cafe'), { user_id: 'alice', slug: 'cafe' }),
    setDoc(doc(db, 'deployments', 'shop'), { user_id: 'bob', slug: 'shop' }),
  ]));
  await assertFails(claim(as('bob'), 'bob', 'cafe'));
  await assertSucceeds(claim(as('bob'), 'bob', 'shop'));
});

test('anonymous accounts are treated as signed out', async () => {
  const ghost = testEnv.authenticatedContext('ghost', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  await assertFails(claim(ghost, 'ghost', 'ghost'));
  await assertFails(saveProject(ghost, 'ghost', PROJECT_A));
});

test('projects and their chunks are owner-only', async () => {
  const alice = as('alice');
  const bob = as('bob');
  await assertSucceeds(getDoc(doc(alice, 'projects', PROJECT_A)), 'a missing project reads as missing');
  await assertSucceeds(saveProject(alice, 'alice', PROJECT_A, { chunks: 3 }));
  await assertSucceeds(getDocs(query(collection(alice, 'projects'), where('user_id', '==', 'alice'), orderBy('updated_at', 'desc'))));
  await assertSucceeds(getDocs(query(collection(alice, 'projects', PROJECT_A, 'chunks'), where('user_id', '==', 'alice'))));

  await assertFails(getDoc(doc(bob, 'projects', PROJECT_A)));
  await assertFails(getDocs(query(collection(bob, 'projects'), where('user_id', '==', 'alice'))));
  await assertFails(getDocs(collection(bob, 'projects')));
  await assertFails(getDoc(doc(bob, 'projects', PROJECT_A, 'chunks', '0')));
  await assertFails(saveProject(bob, 'bob', PROJECT_A), 'overwriting someone else\'s project');
  await assertFails(saveProject(bob, 'alice', PROJECT_B), 'creating a project in someone else\'s name');
  await assertFails(deleteDoc(doc(bob, 'projects', PROJECT_A)));
  await assertFails(setDoc(doc(bob, 'projects', PROJECT_A, 'chunks', '5'), { user_id: 'bob', rev: 'r1', data: Bytes.fromUint8Array(new Uint8Array([1])) }));
  await assertFails(getDoc(doc(anon(), 'projects', PROJECT_A)));
});

test('project writes are shape-checked', async () => {
  const alice = as('alice');
  await assertFails(saveProject(alice, 'alice', 'not-a-uuid'));
  await assertFails(saveProject(alice, 'alice', PROJECT_A, { chunks: 9 }));
  const batch = writeBatch(alice);
  batch.set(doc(alice, 'projects', PROJECT_A), { user_id: 'alice', name: 'App', updated_at: serverTimestamp(), rev: 'r1', chunk_count: 1, size: 3, encoding: 'gzip', admin: true });
  await assertFails(batch.commit());

  // The Apps-list summary fields are optional but typed.
  await assertSucceeds(saveProject(alice, 'alice', PROJECT_B, { summary: { version_count: 12, studio_mode: 'website', deployment: { slug: 'my-app' } } }));
  await assertSucceeds(saveProject(alice, 'alice', PROJECT_B, { summary: { version_count: 0, studio_mode: 'app', deployment: null } }));
  await assertFails(saveProject(alice, 'alice', PROJECT_B, { summary: { version_count: '12' } }));
  await assertFails(saveProject(alice, 'alice', PROJECT_B, { summary: { studio_mode: 'admin' } }));
  await assertFails(saveProject(alice, 'alice', PROJECT_B, { summary: { deployment: 'x' } }));

  // A chunk must carry the rev of the save it belongs to.
  await assertSucceeds(saveProject(alice, 'alice', PROJECT_A));
  await assertFails(setDoc(doc(alice, 'projects', PROJECT_A, 'chunks', '0'), { user_id: 'alice', rev: 'stale', data: Bytes.fromUint8Array(new Uint8Array([1])) }));

  // Rename touches only name + updated_at; ownership can't be handed over.
  await assertSucceeds(updateDoc(doc(alice, 'projects', PROJECT_A), { name: 'Renamed', updated_at: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'projects', PROJECT_A), { user_id: 'bob', updated_at: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'projects', PROJECT_A), { name: 'x'.repeat(201), updated_at: serverTimestamp() }));

  // A save that shrinks deletes its extra chunks in the same batch.
  await assertSucceeds(saveProject(alice, 'alice', PROJECT_B, { chunks: 3 }));
  const shrink = writeBatch(alice);
  shrink.set(doc(alice, 'projects', PROJECT_B), { user_id: 'alice', name: 'App', updated_at: serverTimestamp(), rev: 'r2', chunk_count: 1, size: 3, encoding: 'gzip' });
  shrink.set(doc(alice, 'projects', PROJECT_B, 'chunks', '0'), { user_id: 'alice', rev: 'r2', data: Bytes.fromUint8Array(new Uint8Array([1])) });
  shrink.delete(doc(alice, 'projects', PROJECT_B, 'chunks', '1'));
  shrink.delete(doc(alice, 'projects', PROJECT_B, 'chunks', '2'));
  await assertSucceeds(shrink.commit());

  // Deleting a project with all its chunks at once.
  const remove = writeBatch(alice);
  remove.delete(doc(alice, 'projects', PROJECT_B, 'chunks', '0'));
  remove.delete(doc(alice, 'projects', PROJECT_B));
  await assertSucceeds(remove.commit());
});

test('the biggest allowed save fits within the rules\' document-access limits', async () => {
  await assertSucceeds(saveProject(as('alice'), 'alice', PROJECT_A, { chunks: 8 }));
});

test('deployments are server-written; owners can only read their own', async () => {
  await seed((db) => Promise.all([
    setDoc(doc(db, 'deployments', 'alice~cafe'), { user_id: 'alice', slug: 'alice/cafe', analytics_enabled: true }),
    setDoc(doc(db, 'deployments', 'bob~shop'), { user_id: 'bob', slug: 'bob/shop', analytics_enabled: true }),
  ]));
  const alice = as('alice');
  await assertSucceeds(getDocs(query(collection(alice, 'deployments'), where('user_id', '==', 'alice'), where('analytics_enabled', '==', true))));
  await assertSucceeds(getDoc(doc(alice, 'deployments', 'alice~cafe')));
  await assertFails(getDoc(doc(alice, 'deployments', 'bob~shop')));
  await assertFails(getDocs(collection(alice, 'deployments')));
  await assertFails(setDoc(doc(alice, 'deployments', 'alice~new'), { user_id: 'alice', storage_path: 'alice/x.html' }));
  await assertFails(updateDoc(doc(alice, 'deployments', 'alice~cafe'), { storage_path: 'bob/x.html' }));
  await assertFails(deleteDoc(doc(alice, 'deployments', 'alice~cafe')));
});

test('usage, subscriptions, trial cards and analytics sites are closed to clients', async () => {
  await seed((db) => Promise.all([
    setDoc(doc(db, 'usage', 'alice_2026-10-01'), { user_id: 'alice', builder_tokens: 5 }),
    setDoc(doc(db, 'subscriptions', 'alice'), { user_id: 'alice', plan: 'plus', status: 'active' }),
    setDoc(doc(db, 'analytics_sites', 'site-1'), { user_id: 'alice' }),
    setDoc(doc(db, 'trial_cards', 'fp_1'), { user_id: 'alice', subscription_id: 'sub_1' }),
  ]));
  const alice = as('alice');
  for (const path of ['usage/alice_2026-10-01', 'subscriptions/alice', 'analytics_sites/site-1', 'trial_cards/fp_1']) {
    await assertFails(getDoc(doc(alice, path)), `read ${path}`);
    await assertFails(setDoc(doc(alice, path), { user_id: 'alice', plan: 'pro', status: 'active', builder_tokens: 0 }), `write ${path}`);
    await assertFails(deleteDoc(doc(alice, path)), `delete ${path}`);
  }
  await assertFails(setDoc(doc(alice, 'anything', 'else'), { a: 1 }));
  assert.ok(true);
});
