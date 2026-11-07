-- Usage is counted once per user action (electron/server/hosted/buildWindow.js):
-- the latest action's usage id, and whether the latest request was the one
-- that counted it.
alter table accounts add column build_window_last_id text;
alter table accounts add column build_window_counted integer not null default 0;
