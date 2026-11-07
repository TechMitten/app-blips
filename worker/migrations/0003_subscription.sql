-- The account's Creem subscription id and, after a cancel, when the paid
-- period ends (electron/server/hosted/subscriptionSql.js).
alter table accounts add column subscription_id text;
alter table accounts add column cancel_at text;
