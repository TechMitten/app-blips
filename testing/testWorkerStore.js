// The Cloudflare Worker's account store and routing (worker/), with no
// Cloudflare: the real D1 migrations run in an in-memory node:sqlite
// database behind a small D1-shaped wrapper, and the Worker's store must
// behave exactly like the Node store (electron/server/hosted/store.js) that
// server.js uses. Also checks the Node store's move off the old payment
// service's customer column.
//   node testing/testWorkerStore.js

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Store } from '../worker/d1Store.js';
import worker from '../worker/index.js';
import { openStore } from '../electron/server/hosted/store.js';

const MIGRATIONS = new URL('../worker/migrations/', import.meta.url);

// Just enough of D1's API (prepare → bind → first/run/all) over node:sqlite.
// Like D1, binding `undefined` is an error.
function fakeD1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      const bound = {
        bind(...values) {
          values.forEach((value, i) => {
            if (value === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound at ${i + 1} in ${sql.trim().slice(0, 60)}`);
          });
          args = values;
          return bound;
        },
        first: async () => statement.get(...args) ?? null,
        run: async () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }),
        all: async () => ({ success: true, results: statement.all(...args) }),
      };
      return bound;
    },
  };
}

function migratedD1() {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.map((f) => f.slice(0, 4)), files.map((_, i) => String(i + 1).padStart(4, '0')), 'migrations are numbered in sequence');
  for (const file of files) db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  return db;
}

const columnsOf = (db) => db.prepare('pragma table_info(accounts)').all().map((c) => c.name).sort();
const withoutTime = (row) => {
  if (!row) return row;
  const { updated_at: updatedAt, ...rest } = row;
  assert.match(updatedAt, /^\d{4}-\d\d-\d\dT/);
  return { ...rest };
};

const tmp = mkdtempSync(join(tmpdir(), 'appblips-worker-store-'));
try {
  // ---- The migrations make the same table as the Node store -------------------------
  const d1Db = migratedD1();
  const node = openStore(join(tmp, 'node.db'));
  const nodeDb = new DatabaseSync(join(tmp, 'node.db'));
  assert.deepEqual(columnsOf(d1Db), columnsOf(nodeDb), 'D1 and Node stores have the same columns');
  assert.ok(columnsOf(d1Db).includes('customer_id'));
  assert.equal(columnsOf(d1Db).includes('creem_customer_id'), false);
  nodeDb.close();

  // ---- Same calls, same results ---------------------------------------------------------
  const d1 = d1Store(fakeD1(d1Db));
  const both = async (fn) => {
    const [a, b] = [await fn(node), await fn(d1)];
    const strip = (v) => (v && typeof v === 'object' && 'user_id' in v ? withoutTime(v) : v);
    assert.deepEqual(strip(b), strip(a));
    return a;
  };
  const row = (id) => both((s) => s.getAccount(id));
  // takeBuild's outcome without `start`/`reason`, which are checked on their own.
  const take = async (userId, options) => {
    const outcome = { ...(await both((s) => s.takeBuild(userId, options))) };
    delete outcome.start;
    delete outcome.reason;
    return outcome;
  };

  assert.equal(await both((s) => s.getAccount('')), null);
  assert.equal(await both((s) => s.getAccount('nobody')), null);
  assert.equal(await both((s) => s.saveAccount({})), null);

  let r = await both((s) => s.saveAccount({ userId: 'u1' }));
  assert.equal(r.plan, 'basic');
  assert.equal(r.active, 0);
  r = await both((s) => s.saveAccount({ userId: 'u1', customerId: 'cus_1', plan: 'pro', active: true }));
  assert.equal(r.customer_id, 'cus_1');
  assert.equal(r.active, 1);
  // Unknown fields keep their value.
  r = await both((s) => s.saveAccount({ userId: 'u1', plan: 'pro', active: true }));
  assert.equal(r.customer_id, 'cus_1');

  // A customer id belongs to one account only.
  await both(async (s) => {
    await assert.rejects(async () => s.saveAccount({ userId: 'u2', customerId: 'cus_1' }), /UNIQUE/);
    return null;
  });

  await both((s) => s.setPlan('u1', 'max', false));
  r = await row('u1');
  assert.equal(r.plan, 'max');
  assert.equal(r.active, 0);
  await both((s) => s.setPlan('u1', 'pro'));
  assert.equal((await row('u1')).active, 1, 'setPlan defaults to active');

  r = await both((s) => s.setSandbox('u3', { sandboxId: 'sb_1' }));
  assert.equal(r.sandbox_id, 'sb_1', 'setSandbox creates the row when needed');
  r = await both((s) => s.setSandbox('u3', { snapshotId: 'snap_1' }));
  assert.equal(r.sandbox_id, 'sb_1', 'an undefined field is kept');
  assert.equal(r.snapshot_id, undefined);
  assert.equal(r.sandbox_snapshot_id, 'snap_1');
  r = await both((s) => s.setSandbox('u3', { sandboxId: null }));
  assert.equal(r.sandbox_id, null, 'null clears it');
  assert.equal(r.sandbox_snapshot_id, 'snap_1');

  assert.equal(await both((s) => s.claimEvent('evt_1')), true);
  assert.equal(await both((s) => s.claimEvent('evt_1')), false, 'a webhook is processed once');
  assert.equal(await both((s) => s.claimEvent('')), false);
  assert.equal(await both((s) => s.claimEvent(12345)), true);

  // Build cooldown: 2 builds per 1000 ms window.
  const limits = (at) => ({ limit: 2, windowMs: 1000, at });
  assert.deepEqual(await take('u1', limits(10_000)), { allowed: true, counted: true });
  assert.deepEqual(await take('u1', limits(10_100)), { allowed: true, counted: true });
  assert.deepEqual(await take('u1', limits(10_200)), { allowed: false, resetAt: 11_000 });
  await both((s) => s.releaseBuild('u1'));
  assert.deepEqual(await take('u1', limits(10_300)), { allowed: true, counted: true }, 'a released build can be used again');
  assert.deepEqual(await take('u1', limits(10_400)), { allowed: false, resetAt: 11_000 });
  assert.deepEqual(await take('u1', limits(11_000)), { allowed: true, counted: true }, 'a new window starts');
  assert.equal((await row('u1')).build_window_count, 1);
  // Releasing never goes below zero.
  await both((s) => s.releaseBuild('u1'));
  await both((s) => s.releaseBuild('u1'));
  assert.equal((await row('u1')).build_window_count, 0);
  // No account row: no build (the gate creates the row first).
  assert.equal((await take('ghost', limits(10_000))).allowed, false);

  // Usage ids: one count per action, however many requests it makes.
  const tagged = (at, usageId) => ({ ...limits(at), usageId });
  await both((s) => s.saveAccount({ userId: 'u4', active: true }));
  assert.deepEqual(await take('u4', tagged(20_000, 'action-a1')), { allowed: true, counted: true });
  assert.deepEqual(await take('u4', tagged(20_010, 'action-a1')), { allowed: true, counted: false }, 'a follow-up request is free');
  assert.deepEqual(await take('u4', tagged(20_020, 'action-b1')), { allowed: true, counted: true });
  assert.equal((await row('u4')).build_window_count, 2);
  assert.deepEqual(await take('u4', tagged(20_030, 'action-b1')), { allowed: true, counted: false }, 'an action can finish at the limit');
  assert.equal((await take('u4', tagged(20_040, 'action-c1'))).allowed, false, 'a new action at the limit is refused');
  // Giving back b1 forgets its id, so its retry counts again (once in all).
  await both((s) => s.releaseBuild('u4', 'action-b1'));
  assert.deepEqual(await take('u4', tagged(20_050, 'action-b1')), { allowed: true, counted: true });
  assert.equal((await row('u4')).build_window_count, 2);
  // A release for an older action leaves the latest id alone.
  await both((s) => s.releaseBuild('u4', 'action-a1'));
  assert.deepEqual(await take('u4', tagged(20_060, 'action-b1')), { allowed: true, counted: false });
  // Without an id every request counts.
  assert.deepEqual(await take('u4', limits(20_070)), { allowed: true, counted: true });
  assert.equal((await take('u4', limits(20_080))).allowed, false);
  // An action still running when its window ends doesn't count in the next.
  await take('u4', tagged(30_000, 'action-d1'));
  assert.deepEqual(await take('u4', tagged(31_500, 'action-d1')), { allowed: true, counted: false });
  assert.equal((await row('u4')).build_window_count, 0);
  assert.equal((await row('u4')).build_window_start, 31_500);

  // A usage id rides for ACTION_MAX_MS (30 min) after it was counted; reused
  // later, it counts again, so one fixed id can't make everything free.
  const hour = 60 * 60 * 1000;
  const long = (at, usageId, extra = {}) => ({ limit: 3, windowMs: 5 * hour, at, usageId, ...extra });
  await both((s) => s.saveAccount({ userId: 'u5', active: true }));
  assert.deepEqual(await take('u5', long(0, 'fixed-id-1')), { allowed: true, counted: true });
  assert.deepEqual(await take('u5', long(29 * 60 * 1000, 'fixed-id-1')), { allowed: true, counted: false });
  assert.deepEqual(await take('u5', long(31 * 60 * 1000, 'fixed-id-1')), { allowed: true, counted: true }, 'a stale id counts again');
  assert.deepEqual(await take('u5', long(32 * 60 * 1000, 'fixed-id-1')), { allowed: true, counted: false });
  assert.equal((await row('u5')).build_window_count, 2);

  // Free requests (Ask mode, automatic repairs) don't use the plan, aren't a
  // repeat of anything, and don't move the latest id.
  assert.deepEqual(await take('u5', long(40 * 60 * 1000, 'fixed-id-1', { counts: false })), { allowed: true, counted: false });
  assert.equal((await row('u5')).build_window_count, 2);
  assert.equal((await row('u5')).build_window_last_id, 'fixed-id-1');
  assert.deepEqual(await take('u5', long(41 * 60 * 1000, 'other-id-1')), { allowed: true, counted: true });
  // At the use limit, free requests still pass, new uses don't.
  assert.equal((await take('u5', long(42 * 60 * 1000, 'more-id-01'))).allowed, false);
  assert.equal((await take('u5', long(43 * 60 * 1000, null, { counts: false }))).allowed, true);

  // The request ceiling stops everything, free requests and repeats included.
  const ceiling = (at, extra = {}) => long(at, 'other-id-1', { requestLimit: 8, ...extra });
  const sent = (await row('u5')).build_window_requests;
  assert.equal(sent, 7, 'every allowed request counts toward the ceiling');
  assert.equal((await take('u5', ceiling(44 * 60 * 1000, { counts: false }))).allowed, true);
  const capped = await both((s) => s.takeBuild('u5', ceiling(44 * 60 * 1000 + 1)));
  assert.deepEqual(capped, { allowed: false, resetAt: 5 * hour, reason: 'requests' });
  assert.equal((await take('u5', ceiling(45 * 60 * 1000, { counts: false }))).allowed, false);
  const usesHit = await both((s) => s.takeBuild('u5', long(46 * 60 * 1000, 'new-id-001')));
  assert.deepEqual(usesHit, { allowed: false, resetAt: 5 * hour, reason: 'uses' }, 'the default ceiling (40 per use) is far off');

  // A use is given back only in the window it was counted in.
  await both((s) => s.saveAccount({ userId: 'u6', active: true }));
  const counted = await both((s) => s.takeBuild('u6', long(0, 'release-a1')));
  assert.equal(counted.start, 0);
  await both((s) => s.takeBuild('u6', long(6 * hour, 'release-b1')));
  await both((s) => s.releaseBuild('u6', 'release-a1', counted.start));
  assert.equal((await row('u6')).build_window_count, 1, 'a release from an old window took a use from the new one');
  await both((s) => s.releaseBuild('u6', 'release-b1', 6 * hour));
  assert.equal((await row('u6')).build_window_count, 0);

  await both((s) => s.setSubscriptionId('u1', 'sub_1'));
  await both((s) => s.setSubscriptionId('u1', ''));
  assert.equal((await row('u1')).subscription_id, 'sub_1', 'an empty id doesn\'t clear it');
  await both((s) => s.setCancelAt('u1', '2026-12-01T00:00:00.000Z'));
  assert.equal((await row('u1')).cancel_at, '2026-12-01T00:00:00.000Z');
  await both((s) => s.setCancelAt('u1', undefined));
  assert.equal((await row('u1')).cancel_at, null, 'resubscribing clears the end date');

  await both((s) => s.deleteAccount('u1'));
  assert.equal(await row('u1'), null);
  assert.ok(await row('u3'), 'only that account is deleted');
  await both((s) => s.deleteAccount(''));

  node.close();
  d1Db.close();

  // ---- Node store: moving off the old payment service's column --------------------------
  {
    const file = join(tmp, 'legacy.db');
    const old = new DatabaseSync(file);
    old.exec(`
      create table accounts (user_id text primary key, creem_customer_id text, credit_account_id text,
        plan text not null default 'basic', active integer not null default 0, updated_at text not null,
        subscription_id text, cancel_at text);
      create table webhook_events (id text primary key, received_at text not null);
      insert into accounts values ('old', 'creem_cus', 'credit_1', 'pro', 1, '2026-01-01', 'creem_sub', '2026-02-01');
    `);
    old.close();
    const store = openStore(file);
    const migrated = store.getAccount('old');
    assert.equal(migrated.customer_id, null, 'old customer ids mean nothing to Polar');
    assert.equal(migrated.credit_account_id, null);
    assert.equal(migrated.subscription_id, null);
    assert.equal(migrated.cancel_at, null);
    assert.equal(migrated.plan, 'pro', 'the plan itself is kept');
    assert.equal('creem_customer_id' in migrated, false);
    assert.ok('sandbox_id' in migrated && 'build_window_count' in migrated, 'missing columns are added');
    store.saveAccount({ userId: 'new', customerId: 'polar_cus' });
    assert.equal(store.getAccount('new').customer_id, 'polar_cus');
    store.close();
    // Opening again changes nothing.
    const again = openStore(file);
    assert.equal(again.getAccount('new').customer_id, 'polar_cus');
    again.close();
  }

  // ---- Worker routing -------------------------------------------------------------------
  {
    const db = migratedD1();
    const env = {
      DB: fakeD1(db),
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuYXBwYmxpcHMuY29tJA',
      POLAR_ACCESS_TOKEN: 'polar_test',
      POLAR_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
      APPBLIPS_CHAT_ALLOWED_ORIGINS: 'appblips://app',
    };
    const ctx = { waitUntil: () => {} };
    const call = (path, init = {}, e = env) => worker.fetch(new Request(`https://appblips-api.example${path}`, init), e, ctx);
    const error = console.error;
    console.error = () => {};
    try {
      const notHosted = await call('/', {}, { ...env, POLAR_ACCESS_TOKEN: '' });
      assert.equal(notHosted.status, 503);

      const done = await call('/');
      assert.equal(done.status, 200);
      assert.match(await done.text(), /Payment received/);
      assert.match(done.headers.get('content-security-policy'), /default-src 'none'/);

      assert.equal((await call('/desktop-sign-in?state=x')).status, 200);
      assert.equal((await call('/nope')).status, 404);
      assert.equal((await call('/api/chat')).status, 405);

      const foreign = await call('/api/billing/me', { headers: { origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.headers.get('access-control-allow-origin'), null);

      const preflight = await call('/api/billing/me', { method: 'OPTIONS', headers: { origin: 'appblips://app' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'appblips://app');

      const me = await call('/api/billing/me', { headers: { origin: 'appblips://app' } });
      assert.equal(me.status, 401, 'plan status needs a sign-in');
      assert.equal(me.headers.get('access-control-allow-origin'), 'appblips://app');

      const config = await call('/api/billing/config', { headers: { origin: 'appblips://app' } });
      assert.equal(config.status, 200);
      assert.ok(Array.isArray((await config.json()).plans), 'the plan catalog is public');

      const ticket = await call('/api/desktop-auth/ticket', { method: 'POST', body: '{}' });
      assert.equal(ticket.status, 401);

      const webhook = await call('/api/webhooks/polar', { method: 'POST', body: '{}' });
      assert.ok(webhook.status >= 400 && webhook.status < 500, `unsigned webhook refused (${webhook.status})`);
    } finally {
      console.error = error;
      db.close();
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('Worker store checks passed: D1 migrations, D1 and Node stores agree, the old customer column is dropped, Worker routing and CORS.');
