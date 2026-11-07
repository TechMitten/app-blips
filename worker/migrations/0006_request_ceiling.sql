-- Limits that don't trust the client (electron/server/hosted/buildWindow.js):
-- every request in the window counts toward a ceiling, and a usage id only
-- rides for a while after it was first counted.
alter table accounts add column build_window_requests integer not null default 0;
alter table accounts add column build_window_last_at integer;
