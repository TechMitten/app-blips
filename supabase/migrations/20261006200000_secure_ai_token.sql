-- Secure ai_token from public read
revoke select on table public.deployments from anon, authenticated;
grant select (
  slug, user_id, project_id, storage_path, page_names, bundle, name,
  analytics_enabled, analytics_website_id, ai_enabled, ai_token_generation,
  updated_at, password_protected
) on public.deployments to anon, authenticated;
