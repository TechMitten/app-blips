-- PostgREST requires table privileges before it evaluates RLS policies.
-- A schema/ownership change removed these read privileges, producing 403s in
-- the client and a downstream 502 in the analytics deployment lookup.

grant usage on schema public to anon, authenticated;

-- Public deployment resolution is used by deployed-app routing and analytics.
-- Existing RLS policies continue to decide which rows are visible.
grant select on table public.deployments to anon, authenticated;

-- Signed-in users load their own username. Existing RLS policies must limit
-- this to the caller's profile row.
grant select on table public.profiles to authenticated;
