// Small SQLite store for hosted billing. It holds only what Creem and Clerk
// don't: the link between a Clerk user and their Creem customer/credit
// account, the user's current plan (kept current by Creem webhooks), and the
// ids of processed webhook events so retries never double-apply.
//
// Uses Node's built-in node:sqlite (Node 22.5+), so the Docker server bundle
// still needs no node_modules at runtime.

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const now = () => new Date().toISOString();

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    create table if not exists accounts (
      user_id text primary key,
      creem_customer_id text,
      credit_account_id text,
      plan text not null default 'basic',
      active integer not null default 0,
      updated_at text not null
    );
    create unique index if not exists accounts_customer on accounts(creem_customer_id)
      where creem_customer_id is not null;
    create table if not exists webhook_events (
      id text primary key,
      received_at text not null
    );
  `);

  // Older stores predate the subscription flag: add it in place.
  const columns = db.prepare('pragma table_info(accounts)').all().map((column) => column.name);
  if (!columns.includes('active')) {
    db.exec('alter table accounts add column active integer not null default 0');
  }

  const byUser = db.prepare('select * from accounts where user_id = ?');
  const byCustomer = db.prepare('select * from accounts where creem_customer_id = ?');
  const insert = db.prepare(`
    insert into accounts (user_id, creem_customer_id, credit_account_id, plan, active, updated_at)
    values (?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    update accounts
       set creem_customer_id = coalesce(?, creem_customer_id),
           credit_account_id = coalesce(?, credit_account_id),
           plan = ?,
           active = ?,
           updated_at = ?
     where user_id = ?
  `);
  const setPlanSql = db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where user_id = ?');
  const setPlanByCustomerSql = db.prepare('update accounts set plan = ?, active = ?, updated_at = ? where creem_customer_id = ?');
  const insertEvent = db.prepare('insert or ignore into webhook_events (id, received_at) values (?, ?)');

  const getAccount = (userId) => {
    if (!userId) return null;
    return byUser.get(userId) || null;
  };

  const getAccountByCustomer = (customerId) => {
    if (!customerId) return null;
    return byCustomer.get(customerId) || null;
  };

  // Creates or updates the row for a user, preserving fields the caller
  // doesn't know yet. `active` is the subscription gate: without it the
  // user has no AI access.
  const saveAccount = ({ userId, customerId = null, creditAccountId = null, plan = 'basic', active = false }) => {
    if (!userId) return null;
    const existing = getAccount(userId);
    if (existing) {
      update.run(customerId, creditAccountId, plan, active ? 1 : 0, now(), userId);
    } else {
      insert.run(userId, customerId, creditAccountId, plan, active ? 1 : 0, now());
    }
    return getAccount(userId);
  };

  const setPlan = (userId, plan, active = true) => {
    if (!userId) return;
    setPlanSql.run(plan, active ? 1 : 0, now(), userId);
  };

  const setPlanByCustomer = (customerId, plan, active = true) => {
    if (!customerId) return;
    setPlanByCustomerSql.run(plan, active ? 1 : 0, now(), customerId);
  };

  // True only the first time an event id is seen.
  const claimEvent = (id) => {
    if (!id) return false;
    const result = insertEvent.run(String(id), now());
    return result.changes > 0;
  };

  return { getAccount, getAccountByCustomer, saveAccount, setPlan, setPlanByCustomer, claimEvent, close: () => db.close() };
}

export const defaultDatabasePath = (env) => {
  const explicit = String(env.APPBLIPS_DB_PATH || '').trim();
  if (explicit) return explicit;
  const dataDir = String(env.APPBLIPS_DATA_DIR || '').trim();
  return dataDir ? join(dataDir, 'appblips.db') : 'appblips.db';
};
