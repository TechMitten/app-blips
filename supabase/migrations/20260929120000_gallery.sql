-- Blip Gallery: an opt-in public showcase of deployed apps.
--
-- Anyone (anon included) can browse visible posts; likes, comments, reports
-- and publishing require sign-in. Counters and moderation state (`hidden`,
-- `*_count`) are maintained only by the security-definer triggers below, never
-- by the client: posts expose column-level UPDATE grants for editable fields
-- only. A post hangs off its `deployments` row, so undeploying removes it.

-- Encrypted (password-protected) deploys can't be shown publicly.
alter table public.deployments
  add column if not exists password_protected boolean not null default false;

-- ---------------------------------------------------------------- tables ---

create table public.gallery_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique references public.deployments(slug) on delete cascade on update cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_username text not null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  thumbnail_path text,
  remix_path text,
  allow_remix boolean not null default true,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  views_count integer not null default 0,
  reports_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(author_username, ''))
  ) stored
);
create index gallery_posts_created_idx on public.gallery_posts (created_at desc);
create index gallery_posts_likes_idx on public.gallery_posts (likes_count desc, created_at desc);
create index gallery_posts_user_idx on public.gallery_posts (user_id);
create index gallery_posts_search_idx on public.gallery_posts using gin (search);

create table public.gallery_likes (
  post_id uuid not null references public.gallery_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index gallery_likes_user_idx on public.gallery_likes (user_id);

create table public.gallery_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.gallery_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_username text not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  hidden boolean not null default false,
  reports_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index gallery_comments_post_idx on public.gallery_comments (post_id, created_at desc);
create index gallery_comments_user_idx on public.gallery_comments (user_id);

create table public.gallery_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.gallery_posts(id) on delete cascade,
  comment_id uuid references public.gallery_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null))
);
create unique index gallery_reports_post_uniq on public.gallery_reports (post_id, reporter_id) where post_id is not null;
create unique index gallery_reports_comment_uniq on public.gallery_reports (comment_id, reporter_id) where comment_id is not null;
create index gallery_reports_comment_idx on public.gallery_reports (comment_id);
create index gallery_reports_reporter_idx on public.gallery_reports (reporter_id);

-- One row per (post, viewer); only gallery_record_view writes here.
create table public.gallery_views (
  post_id uuid not null references public.gallery_posts(id) on delete cascade,
  viewer_key text not null check (char_length(viewer_key) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_key)
);

-- -------------------------------------------------------------- triggers ---

-- Stamps author_username (profiles aren't publicly readable) and refuses
-- posts for deployments the caller doesn't own or that are encrypted.
create or replace function public.gallery_posts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select username into uname from public.profiles where id = new.user_id;
  if uname is null then raise exception 'Claim a username before publishing to the gallery.'; end if;
  if not exists (
    select 1 from public.deployments d
    where d.slug = new.slug and d.user_id = new.user_id and not d.password_protected
  ) then
    raise exception 'Only your own non-password-protected deployments can be published.';
  end if;
  new.author_username := uname;
  new.likes_count := 0; new.comments_count := 0; new.views_count := 0;
  new.reports_count := 0; new.hidden := false;
  return new;
end $$;
create trigger gallery_posts_before_insert before insert on public.gallery_posts
  for each row execute function public.gallery_posts_before_insert();

create or replace function public.gallery_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger gallery_posts_touch before update on public.gallery_posts
  for each row execute function public.gallery_touch_updated_at();

-- A deployment switched to password protection drops out of the gallery.
create or replace function public.gallery_deployment_protected()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.password_protected then delete from public.gallery_posts where slug = new.slug; end if;
  return new;
end $$;
create trigger gallery_deployment_protected after insert or update of password_protected on public.deployments
  for each row execute function public.gallery_deployment_protected();

create or replace function public.gallery_comments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select username into uname from public.profiles where id = new.user_id;
  if uname is null then raise exception 'Claim a username before commenting.'; end if;
  new.author_username := uname;
  new.body := btrim(new.body);
  new.hidden := false; new.reports_count := 0;
  return new;
end $$;
create trigger gallery_comments_before_insert before insert on public.gallery_comments
  for each row execute function public.gallery_comments_before_insert();

create or replace function public.gallery_likes_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.gallery_posts set likes_count = likes_count + 1 where id = new.post_id;
  else
    update public.gallery_posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
create trigger gallery_likes_count after insert or delete on public.gallery_likes
  for each row execute function public.gallery_likes_count();

create or replace function public.gallery_comments_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.gallery_posts set comments_count = comments_count + 1 where id = new.post_id;
  else
    update public.gallery_posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
create trigger gallery_comments_count after insert or delete on public.gallery_comments
  for each row execute function public.gallery_comments_count();

-- Three distinct reports hide the target pending review in the dashboard.
create or replace function public.gallery_reports_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is not null then
    update public.gallery_posts
      set reports_count = reports_count + 1, hidden = hidden or reports_count + 1 >= 3
      where id = new.post_id;
  else
    update public.gallery_comments
      set reports_count = reports_count + 1, hidden = hidden or reports_count + 1 >= 3
      where id = new.comment_id;
  end if;
  return null;
end $$;
create trigger gallery_reports_apply after insert on public.gallery_reports
  for each row execute function public.gallery_reports_apply();

-- Trigger functions are not meant to be called directly.
revoke execute on function
  public.gallery_posts_before_insert(), public.gallery_touch_updated_at(),
  public.gallery_deployment_protected(), public.gallery_comments_before_insert(),
  public.gallery_likes_count(), public.gallery_comments_count(), public.gallery_reports_apply()
  from public, anon, authenticated;

-- ------------------------------------------------------------------- RLS ---

alter table public.gallery_posts enable row level security;
alter table public.gallery_likes enable row level security;
alter table public.gallery_comments enable row level security;
alter table public.gallery_reports enable row level security;
alter table public.gallery_views enable row level security;

create policy "gallery posts readable" on public.gallery_posts for select to anon, authenticated
  using (not hidden or user_id = (select auth.uid()));
create policy "owners insert gallery posts" on public.gallery_posts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "owners update gallery posts" on public.gallery_posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owners delete gallery posts" on public.gallery_posts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "gallery likes readable" on public.gallery_likes for select to anon, authenticated using (true);
create policy "users like" on public.gallery_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.gallery_posts p where p.id = post_id));
create policy "users unlike" on public.gallery_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "gallery comments readable" on public.gallery_comments for select to anon, authenticated
  using (not hidden or user_id = (select auth.uid()));
create policy "users comment" on public.gallery_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.gallery_posts p where p.id = post_id));
create policy "authors or post owners delete comments" on public.gallery_comments for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.gallery_posts p where p.id = post_id and p.user_id = (select auth.uid()))
  );

create policy "users report" on public.gallery_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

-- gallery_views: no policies; RPC only.

-- ---------------------------------------------------------------- grants ---

grant select on public.gallery_posts to anon, authenticated;
grant insert, delete on public.gallery_posts to authenticated;
grant update (title, description, thumbnail_path, remix_path, allow_remix) on public.gallery_posts to authenticated;
grant select on public.gallery_likes to anon, authenticated;
grant insert, delete on public.gallery_likes to authenticated;
grant select on public.gallery_comments to anon, authenticated;
grant insert (post_id, user_id, body), delete on public.gallery_comments to authenticated;
grant insert (post_id, comment_id, reporter_id, reason) on public.gallery_reports to authenticated;
revoke all on public.gallery_views from anon, authenticated;

-- ------------------------------------------------------------------ RPCs ---

create or replace function public.gallery_feed(
  p_sort text default 'hot', p_search text default null,
  p_limit integer default 24, p_offset integer default 0
)
returns table (
  id uuid, slug text, user_id uuid, author_username text, title text, description text,
  thumbnail_path text, remix_path text, allow_remix boolean,
  likes_count integer, comments_count integer, views_count integer,
  created_at timestamptz, updated_at timestamptz, liked_by_me boolean
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.slug, p.user_id, p.author_username, p.title, p.description,
         p.thumbnail_path, p.remix_path, p.allow_remix,
         p.likes_count, p.comments_count, p.views_count,
         p.created_at, p.updated_at,
         exists (select 1 from public.gallery_likes l where l.post_id = p.id and l.user_id = (select auth.uid())) as liked_by_me
  from public.gallery_posts p
  where not p.hidden
    and (p_sort <> 'mine' or p.user_id = (select auth.uid()))
    and (coalesce(btrim(p_search), '') = '' or p.search @@ websearch_to_tsquery('simple', p_search))
  order by
    case when p_sort = 'hot' then
      (p.likes_count * 3 + p.comments_count * 2 + p.views_count * 0.05 + 1)
        / power(extract(epoch from (now() - p.created_at)) / 3600 + 2, 1.5)
    end desc nulls last,
    case when p_sort = 'top' then p.likes_count end desc nulls last,
    case when p_sort = 'top' then p.views_count end desc nulls last,
    p.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
grant execute on function public.gallery_feed(text, text, integer, integer) to anon, authenticated;

create or replace function public.gallery_record_view(p_post_id uuid, p_viewer_key text)
returns void language plpgsql security definer set search_path = public as $$
declare key text := coalesce((select auth.uid())::text, 'anon:' || coalesce(p_viewer_key, ''));
begin
  if char_length(key) < 8 or char_length(key) > 64 then return; end if;
  if not exists (select 1 from public.gallery_posts where id = p_post_id and not hidden) then return; end if;
  insert into public.gallery_views (post_id, viewer_key) values (p_post_id, key) on conflict do nothing;
  if found then
    update public.gallery_posts set views_count = views_count + 1 where id = p_post_id;
  end if;
end $$;
revoke execute on function public.gallery_record_view(uuid, text) from public;
grant execute on function public.gallery_record_view(uuid, text) to anon, authenticated;

-- --------------------------------------------------------------- storage ---

-- Thumbnails and remix sources live at gallery/<uid>/<postId>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 2097152, array['image/webp', 'image/jpeg', 'image/png', 'application/json'])
on conflict (id) do nothing;

create policy "owners list gallery files" on storage.objects for select to authenticated
  using (bucket_id = 'gallery' and owner_id = ((select auth.uid()))::text);
create policy "owners upload gallery files" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (storage.foldername(name))[1] = ((select auth.uid()))::text);
create policy "owners update gallery files" on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and owner_id = ((select auth.uid()))::text)
  with check (bucket_id = 'gallery' and (storage.foldername(name))[1] = ((select auth.uid()))::text);
create policy "owners delete gallery files" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and owner_id = ((select auth.uid()))::text);
