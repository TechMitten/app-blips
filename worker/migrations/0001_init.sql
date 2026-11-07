-- Same tables as the Node store (electron/server/hosted/store.js).
create table if not exists accounts (
  user_id text primary key,
  creem_customer_id text,
  credit_account_id text,
  plan text not null default 'basic',
  active integer not null default 0,
  sandbox_id text,
  sandbox_snapshot_id text,
  updated_at text not null
);
create unique index if not exists accounts_customer on accounts(creem_customer_id)
  where creem_customer_id is not null;
create table if not exists webhook_events (
  id text primary key,
  received_at text not null
);
