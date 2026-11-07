// The hosted account store on Cloudflare D1. Same methods and row shape as
// the Node SQLite store (electron/server/hosted/store.js), but every method
// returns a Promise; the shared handlers await them either way. The tables
// are created by worker/migrations, not here.

import { RELEASE_BUILD_SQL, TAKE_BUILD_SQL, WINDOW_START_SQL, windowResult } from '../electron/server/hosted/buildWindow.js';
import { SET_CANCEL_AT_SQL, SET_SUBSCRIPTION_ID_SQL } from '../electron/server/hosted/subscriptionSql.js';

const now = () => new Date().toISOString();

export function d1Store(db) {
  const getAccount = async (userId) => {
    if (!userId) return null;
    return (await db.prepare('select * from accounts where user_id = ?').bind(userId).first()) || null;
  };

  // One upsert instead of read-then-write, so two requests for a new user
  // can't both insert. Fields the caller doesn't know (null) keep their value.
  const saveAccount = async ({ userId, customerId = null, plan = 'basic', active = false, sandboxId = null, snapshotId = null }) => {
    if (!userId) return null;
    await db.prepare(`
      insert into accounts (user_id, customer_id, plan, active, sandbox_id, sandbox_snapshot_id, updated_at)
      values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      on conflict(user_id) do update set
        customer_id = coalesce(?2, customer_id),
        plan = ?3,
        active = ?4,
        sandbox_id = coalesce(?5, sandbox_id),
        sandbox_snapshot_id = coalesce(?6, sandbox_snapshot_id),
        updated_at = ?7
    `).bind(userId, customerId, plan, active ? 1 : 0, sandboxId, snapshotId, now()).run();
    return getAccount(userId);
  };

  const setPlan = async (userId, plan, active = true) => {
    if (!userId) return;
    await db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where user_id = ?')
      .bind(plan, active ? 1 : 0, now(), userId).run();
  };

  // Pass `null` for `sandboxId` when clearing a terminated sandbox; leave a
  // field undefined to keep it.
  const setSandbox = async (userId, { sandboxId, snapshotId } = {}) => {
    if (!userId) return null;
    const existing = (await getAccount(userId)) || (await saveAccount({ userId }));
    const nextSandboxId = sandboxId === undefined ? existing.sandbox_id : sandboxId;
    const nextSnapshotId = snapshotId === undefined ? existing.sandbox_snapshot_id : snapshotId;
    await db.prepare('update accounts set sandbox_id = ?, sandbox_snapshot_id = ?, updated_at = ? where user_id = ?')
      .bind(nextSandboxId ?? null, nextSnapshotId ?? null, now(), userId).run();
    return getAccount(userId);
  };

  // True only the first time an event id is seen.
  const claimEvent = async (id) => {
    if (!id) return false;
    const result = await db.prepare('insert or ignore into webhook_events (id, received_at) values (?, ?)')
      .bind(String(id), now()).run();
    return (result.meta?.changes || 0) > 0;
  };

  // The usage cooldown (buildWindow.js); columns from migrations/0002 and 0005.
  const takeBuild = async (userId, { limit, windowMs, usageId = null, at = Date.now() }) => {
    const taken = await db.prepare(TAKE_BUILD_SQL).bind(userId, at - windowMs, at, limit, usageId).first();
    const start = taken ? null : (await db.prepare(WINDOW_START_SQL).bind(userId).first())?.start;
    return windowResult(taken, start, windowMs);
  };
  const releaseBuild = async (userId, usageId = null) => {
    await db.prepare(RELEASE_BUILD_SQL).bind(userId, usageId).run();
  };

  // The Polar subscription (subscriptionSql.js); columns from migrations/0003.
  const setSubscriptionId = async (userId, subscriptionId) => {
    if (userId && subscriptionId) await db.prepare(SET_SUBSCRIPTION_ID_SQL).bind(subscriptionId, now(), userId).run();
  };
  const setCancelAt = async (userId, cancelAt) => {
    if (userId) await db.prepare(SET_CANCEL_AT_SQL).bind(cancelAt || null, now(), userId).run();
  };

  // Deleting an account (Settings → Account) removes the user's row.
  const deleteAccount = async (userId) => {
    if (userId) await db.prepare('delete from accounts where user_id = ?').bind(userId).run();
  };

  return { getAccount, saveAccount, setPlan, setSandbox, claimEvent, takeBuild, releaseBuild, setSubscriptionId, setCancelAt, deleteAccount, close: () => {} };
}
