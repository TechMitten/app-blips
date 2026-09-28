-- Project sync uses all four CRUD operations. Deployment publishing reads
-- slugs publicly but restricts mutations to the owning signed-in user. The
-- existing RLS policies remain the row-level enforcement boundary.

grant select, insert, update, delete on table public.projects to authenticated;
grant insert, update, delete on table public.deployments to authenticated;
