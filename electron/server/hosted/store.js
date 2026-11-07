// Small SQLite store for hosted billing. It holds only what Polar and Clerk
// don't: the link between a Clerk user and their Polar customer and
// subscription, the user's current plan (kept current by Polar webhooks),
// their usage cooldown and their sandbox.
//
// Uses Node's built-in node:sqlite (Node 22.5+), so the Docker server bundle
// still needs no node_modules at runtime.

import { DatabaseSync } from 'node:sqlite';
import { BUILD_WINDOW_COLUMNS, RELEASE_BUILD_SQL, TAKE_BUILD_SQL, WINDOW_START_SQL, windowResult } from './buildWindow.js';
import { SET_CANCEL_AT_SQL, SET_SUBSCRIPTION_ID_SQL, SUBSCRIPTION_COLUMNS } from './subscriptionSql.js';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const now = () => new Date().toISOString();

export function openStore(file) {
  // Opened on every start, so a data folder that doesn't exist yet must not
  // stop the server from starting.
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    create table if not exists accounts (
      user_id text primary key,
      customer_id text,
      credit_account_id text,
      plan text not null default 'basic',
      active integer not null default 0,
      sandbox_id text,
      sandbox_snapshot_id text,
      updated_at text not null
    );
    create table if not exists webhook_events (
      id text primary key,
      received_at text not null
    );
  `);

  // Older stores predate the subscription and sandbox columns: add them in place.
  let columns = db.prepare('pragma table_info(accounts)').all().map((column) => column.name);
  // Stores made before payments moved to Polar have the previous payment
  // service's customer column; its ids mean nothing to Polar, so they go.
  const legacyCustomerColumn = 'creem_customer_id';
  if (columns.includes(legacyCustomerColumn)) {
    db.exec(`alter table accounts rename column ${legacyCustomerColumn} to customer_id;
      update accounts set customer_id = null, credit_account_id = null;`);
    if (columns.includes('subscription_id')) db.exec('update accounts set subscription_id = null, cancel_at = null');
    columns = db.prepare('pragma table_info(accounts)').all().map((column) => column.name);
  }
  if (!columns.includes('active')) {
    db.exec('alter table accounts add column active integer not null default 0');
  }
  if (!columns.includes('sandbox_id')) {
    db.exec('alter table accounts add column sandbox_id text');
  }
  if (!columns.includes('sandbox_snapshot_id')) {
    db.exec('alter table accounts add column sandbox_snapshot_id text');
  }
  for (const [column, sql] of Object.entries({ ...BUILD_WINDOW_COLUMNS, ...SUBSCRIPTION_COLUMNS })) {
    if (!columns.includes(column)) db.exec(sql);
  }
  db.exec(`create unique index if not exists accounts_customer on accounts(customer_id)
    where customer_id is not null`);

  const byUser = db.prepare('select * from accounts where user_id = ?');
  const insert = db.prepare(`
    insert into accounts (user_id, customer_id, plan, active, sandbox_id, sandbox_snapshot_id, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    update accounts
       set customer_id = coalesce(?, customer_id),
           plan = ?,
           active = ?,
           sandbox_id = coalesce(?, sandbox_id),
           sandbox_snapshot_id = coalesce(?, sandbox_snapshot_id),
           updated_at = ?
     where user_id = ?
  `);
  const setPlanSql = db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where user_id = ?');
  const setSandboxSql = db.prepare('update accounts set sandbox_id = ?, sandbox_snapshot_id = ?, updated_at = ? where user_id = ?');
  const insertEvent = db.prepare('insert or ignore into webhook_events (id, received_at) values (?, ?)');

  const getAccount = (userId) => {
    if (!userId) return null;
    return byUser.get(userId) || null;
  };

  // Creates or updates the row for a user, preserving fields the caller
  // doesn't know yet. `active` is the subscription gate: without it the
  // user has no AI access.
  const saveAccount = ({ userId, customerId = null, plan = 'basic', active = false, sandboxId = null, snapshotId = null }) => {
    if (!userId) return null;
    const existing = getAccount(userId);
    if (existing) {
      update.run(customerId, plan, active ? 1 : 0, sandboxId, snapshotId, now(), userId);
    } else {
      insert.run(userId, customerId, plan, active ? 1 : 0, sandboxId, snapshotId, now());
    }
    return getAccount(userId);
  };

  const setPlan = (userId, plan, active = true) => {
    if (!userId) return;
    setPlanSql.run(plan, active ? 1 : 0, now(), userId);
  };

  // Links a user to their dedicated Render sandbox and latest filesystem
  // snapshot. Pass `null` for `sandboxId` when clearing a terminated sandbox.
  const setSandbox = (userId, { sandboxId, snapshotId } = {}) => {
    if (!userId) return null;
    const existing = getAccount(userId) || saveAccount({ userId });
    const nextSandboxId = sandboxId === undefined ? existing.sandbox_id : sandboxId;
    const nextSnapshotId = snapshotId === undefined ? existing.sandbox_snapshot_id : snapshotId;
    setSandboxSql.run(nextSandboxId ?? null, nextSnapshotId ?? null, now(), userId);
    return getAccount(userId);
  };

  // True only the first time an event id is seen.
  const claimEvent = (id) => {
    if (!id) return false;
    const result = insertEvent.run(String(id), now());
    return result.changes > 0;
  };

  // The usage cooldown (buildWindow.js).
  const takeBuildSql = db.prepare(TAKE_BUILD_SQL);
  const releaseBuildSql = db.prepare(RELEASE_BUILD_SQL);
  const windowStartSql = db.prepare(WINDOW_START_SQL);
  const takeBuild = (userId, { limit, windowMs, usageId = null, at = Date.now() }) => {
    const taken = takeBuildSql.get(userId, at - windowMs, at, limit, usageId);
    return windowResult(taken, taken ? null : windowStartSql.get(userId)?.start, windowMs);
  };
  const releaseBuild = (userId, usageId = null) => { releaseBuildSql.run(userId, usageId); };

  // The Polar subscription (subscriptionSql.js), keyed by Clerk user.
  const setSubscriptionIdSql = db.prepare(SET_SUBSCRIPTION_ID_SQL);
  const setCancelAtSql = db.prepare(SET_CANCEL_AT_SQL);
  const setSubscriptionId = (userId, subscriptionId) => {
    if (userId && subscriptionId) setSubscriptionIdSql.run(subscriptionId, now(), userId);
  };
  const setCancelAt = (userId, cancelAt) => {
    if (userId) setCancelAtSql.run(cancelAt || null, now(), userId);
  };

  // Deleting an account (Settings → Account) removes the user's row.
  const deleteAccountSql = db.prepare('delete from accounts where user_id = ?');
  const deleteAccount = (userId) => { if (userId) deleteAccountSql.run(userId); };

  return { getAccount, saveAccount, setPlan, setSandbox, claimEvent, takeBuild, releaseBuild, setSubscriptionId, setCancelAt, deleteAccount, close: () => db.close() };
}

export const defaultDatabasePath = (env) => {
  const explicit = String(env.APPBLIPS_DB_PATH || '').trim();
  if (explicit) return explicit;
  const dataDir = String(env.APPBLIPS_DATA_DIR || '').trim();
  return dataDir ? join(dataDir, 'appblips.db') : 'appblips.db';
};
