-- Persist the creator's chosen presentation for the community gallery.
-- Existing posts keep the desktop presentation for backwards compatibility.
alter table public.gallery_posts
  add column if not exists device_type text not null default 'desktop'
  check (device_type in ('mobile', 'tablet', 'desktop'));

-- Gallery owners can change the presentation when they redeploy, alongside
-- the other editable listing fields. RLS still limits this to the owner.
grant update (title, description, device_type, thumbnail_path, remix_path, allow_remix)
  on public.gallery_posts to authenticated;
