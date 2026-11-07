// Each account's Creem subscription id (needed to cancel it: Creem's search
// can't look one up by customer) and, after a cancel, when the paid period
// ends. Shared by the Node SQLite store and the Worker's D1 store.

// Older stores get the columns added in place (Node store; D1 has a migration).
export const SUBSCRIPTION_COLUMNS = {
  subscription_id: 'alter table accounts add column subscription_id text',
  cancel_at: 'alter table accounts add column cancel_at text',
};

export const SET_SUBSCRIPTION_ID_SQL = 'update accounts set subscription_id = ?, updated_at = ? where creem_customer_id = ?';
// cancel_at: ISO date the plan ends after a cancel, or null when it renews.
export const SET_CANCEL_AT_SQL = 'update accounts set cancel_at = ?, updated_at = ? where creem_customer_id = ?';
