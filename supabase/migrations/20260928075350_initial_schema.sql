-- Initial multi-user schema: profiles, projects, deployments, usage,
-- username_claims, the core RPCs, and the `orion-deploys` storage bucket.
--
-- This is the foundation the app's Supabase-backed features build on. Apply
-- this first; the later migrations add the gallery (`..._gallery.sql`,
-- `..._gallery_device_mockup.sql`) and re-affirm table grants.
--
-- Security model: every table has Row Level Security enabled. `anon` can read
-- public deployment rows and the gallery; `authenticated` can read/write only
-- its own rows; server-only writes (usage counters, username claims, account
-- deletion) go through SECURITY DEFINER functions reachable only by the
-- intended role.

-- ============================================================= profiles ---

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9-]{3,39}$'),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

grant select on public.profiles to authenticated;

-- ===================================================== username_claims ---

-- Permanent per-user handle. Only `claim_username` writes here; the client
-- never reads or writes it directly.
create table public.username_claims (
  username text primary key check (username ~ '^[a-z0-9-]{3,39}$'),
  user_id uuid unique not null,
  created_at timestamptz not null default now()
);

alter table public.username_claims enable row level security;

create policy "username claims are private" on public.username_claims
  for select to authenticated
  using (false);

-- ============================================================ projects ---

create table public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index projects_user_updated_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

create policy "projects owned access" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.projects to authenticated;

-- ========================================================= deployments ---

create table public.deployments (
  slug text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null default '',
  storage_path text not null,
  page_names text[] not null default '{}'::text[],
  bundle boolean not null default false,
  name text,
  analytics_enabled boolean not null default false,
  analytics_website_id text,
  ai_enabled boolean not null default false,
  ai_token text unique,
  ai_token_generation integer,
  updated_at timestamptz not null default now(),
  password_protected boolean not null default false
);

create index deployments_user_idx on public.deployments (user_id);

alter table public.deployments enable row level security;

-- Publicly readable so the deploy-serving Function and the deployed-app AI
-- relay can resolve slugs with the publishable key; RLS keeps mutations
-- owner-only.
create policy "public deployments readable" on public.deployments
  for select to anon, authenticated
  using (true);

create policy "owners insert deployments" on public.deployments
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "owners update deployments" on public.deployments
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owners delete deployments" on public.deployments
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.deployments to anon, authenticated;
grant insert, update, delete on public.deployments to authenticated;

-- =============================================================== usage ---

-- Per-account API usage counters, written only by `increment_usage` (service
-- role). Observability, not a billing boundary.
create table public.usage (
  user_id uuid not null,
  date date not null,
  builder_requests bigint not null default 0,
  deployed_requests bigint not null default 0,
  builder_tokens bigint not null default 0,
  deployed_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.usage enable row level security;

create policy "read own usage" on public.usage
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.usage to authenticated, service_role;

-- ================================================================= RPCs ---

-- Atomically reserves a username and stamps it onto the caller's profile.
-- Supabase rules deny further writes once claimed, so a success is permanent.
create or replace function public.claim_username(requested_username text)
returns text language plpgsql security definer set search_path = public as $$
declare current_uid uuid := auth.uid(); existing_username text;
begin
  if current_uid is null then raise exception 'Sign in required.'; end if;
  if requested_username !~ '^[a-z0-9-]{3,39}$' then raise exception 'Invalid username.'; end if;
  select username into existing_username from public.profiles where id = current_uid;
  if existing_username is not null then raise exception 'Your username is already set and cannot be changed.'; end if;
  begin
    insert into public.username_claims(username, user_id) values (requested_username, current_uid);
  exception when unique_violation then
    raise exception 'That username is already taken.';
  end;
  insert into public.profiles(id, username, updated_at) values (current_uid, requested_username, now())
    on conflict (id) do update set username = excluded.username, updated_at = now();
  return requested_username;
end $$;

grant execute on function public.claim_username(text) to authenticated;

create or replace function public.delete_own_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare current_uid uuid := auth.uid();
begin
  if current_uid is null then raise exception 'Sign in required.'; end if;
  delete from auth.users where id = current_uid;
end $$;

grant execute on function public.delete_own_account() to authenticated;

-- Increments a single counter, by at most 1 per call, for the given day.
create or replace function public.increment_usage(
  target_user_id uuid, usage_date date, usage_kind text, token_count bigint default 0
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if usage_kind not in ('builder', 'deployed') then raise exception 'Invalid usage kind'; end if;
  insert into public.usage(user_id, date, builder_requests, deployed_requests, builder_tokens, deployed_tokens)
  values (
    target_user_id, usage_date,
    case when usage_kind = 'builder' then 1 else 0 end,
    case when usage_kind = 'deployed' then 1 else 0 end,
    case when usage_kind = 'builder' then greatest(token_count, 0) else 0 end,
    case when usage_kind = 'deployed' then greatest(token_count, 0) else 0 end
  )
  on conflict (user_id, date) do update set
    builder_requests = usage.builder_requests + case when usage_kind = 'builder' then 1 else 0 end,
    deployed_requests = usage.deployed_requests + case when usage_kind = 'deployed' then 1 else 0 end,
    builder_tokens = usage.builder_tokens + case when usage_kind = 'builder' then greatest(token_count, 0) else 0 end,
    deployed_tokens = usage.deployed_tokens + case when usage_kind = 'deployed' then greatest(token_count, 0) else 0 end,
    updated_at = now();
end $$;

grant execute on function public.increment_usage(uuid, date, text, bigint) to service_role;

-- ================================================= storage: orion-deploys ---

-- Deployed app HTML lives here, at `<uid>/<token>.html` (and, for multi-page
-- sites, `<uid>/<token>/<page>.html`). Public read (the deploy-serving
-- Function re-serves it); owners write under their own uid.
insert into storage.buckets (id, name, public)
values ('orion-deploys', 'orion-deploys', true)
on conflict (id) do nothing;

create policy "owners upload deploys" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'orion-deploys' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy "owners list deploys" on storage.objects
  for select to authenticated
  using (bucket_id = 'orion-deploys' and owner_id = (auth.uid())::text);

create policy "owners update deploys" on storage.objects
  for update to authenticated
  using (bucket_id = 'orion-deploys' and owner_id = (auth.uid())::text)
  with check (bucket_id = 'orion-deploys' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy "owners delete deploys" on storage.objects
  for delete to authenticated
  using (bucket_id = 'orion-deploys' and owner_id = (auth.uid())::text);
