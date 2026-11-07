// The hosted account store on Cloudflare D1. Same methods and row shape as
// the Node SQLite store (electron/server/hosted/store.js), but every method
// returns a Promise; the shared handlers await them either way. The tables
// are created by worker/migrations, not here.

import { RELEASE_BUILD_SQL, TAKE_BUILD_SQL, WINDOW_START_SQL, windowResult } from '../electron/server/hosted/buildWindow.js';

const now = () => new Date().toISOString();

export function d1Store(db) {
  const getAccount = async (userId) => {
    if (!userId) return null;
    return (await db.prepare('select * from accounts where user_id = ?').bind(userId).first()) || null;
  };

  const getAccountByCustomer = async (customerId) => {
    if (!customerId) return null;
    return (await db.prepare('select * from accounts where creem_customer_id = ?').bind(customerId).first()) || null;
  };

  // One upsert instead of read-then-write, so two requests for a new user
  // can't both insert. Fields the caller doesn't know (null) keep their value.
  const saveAccount = async ({ userId, customerId = null, creditAccountId = null, plan = 'basic', active = false, sandboxId = null, snapshotId = null }) => {
    if (!userId) return null;
    await db.prepare(`
      insert into accounts (user_id, creem_customer_id, credit_account_id, plan, active, sandbox_id, sandbox_snapshot_id, updated_at)
      values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      on conflict(user_id) do update set
        creem_customer_id = coalesce(?2, creem_customer_id),
        credit_account_id = coalesce(?3, credit_account_id),
        plan = ?4,
        active = ?5,
        sandbox_id = coalesce(?6, sandbox_id),
        sandbox_snapshot_id = coalesce(?7, sandbox_snapshot_id),
        updated_at = ?8
    `).bind(userId, customerId, creditAccountId, plan, active ? 1 : 0, sandboxId, snapshotId, now()).run();
    return getAccount(userId);
  };

  const setPlan = async (userId, plan, active = true) => {
    if (!userId) return;
    await db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where user_id = ?')
      .bind(plan, active ? 1 : 0, now(), userId).run();
  };

  const setPlanByCustomer = async (customerId, plan, active = true) => {
    if (!customerId) return;
    await db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where creem_customer_id = ?')
      .bind(plan, active ? 1 : 0, now(), customerId).run();
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

  // The build cooldown (buildWindow.js); columns from migrations/0002.
  const takeBuild = async (userId, { limit, windowMs, at = Date.now() }) => {
    const taken = await db.prepare(TAKE_BUILD_SQL).bind(userId, at - windowMs, at, limit).first();
    const start = taken ? null : (await db.prepare(WINDOW_START_SQL).bind(userId).first())?.start;
    return windowResult(taken, start, windowMs);
  };
  const releaseBuild = async (userId) => {
    await db.prepare(RELEASE_BUILD_SQL).bind(userId).run();
  };

  return { getAccount, getAccountByCustomer, saveAccount, setPlan, setPlanByCustomer, setSandbox, claimEvent, takeBuild, releaseBuild, close: () => {} };
}
