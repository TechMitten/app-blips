-- The build cooldown (electron/server/hosted/buildWindow.js): when the
-- current window started (epoch ms) and how many builds it has used.
alter table accounts add column build_window_start integer;
alter table accounts add column build_window_count integer not null default 0;
