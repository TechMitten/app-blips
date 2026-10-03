-- Retire the community gallery (`..._gallery.sql`, `..._gallery_device_mockup.sql`).
-- It is replaced by a curated showcase that ships as static data in the
-- client bundle (src/lib/showcase.js) and needs nothing in the database.
--
-- `deployments.password_protected` stays: the client still records it on
-- every deploy and it is harmless on its own.
--
-- Storage refuses deleting objects or buckets from SQL, so the `gallery`
-- bucket is only made private here (existing thumbnails and remix sources stop
-- being publicly readable). Empty and delete it from the dashboard afterwards.
--
-- Approved and applied by TechMitten on 2026-10-03, accepting the permanent
-- loss of existing gallery posts, likes and comments.

drop table if exists public.gallery_views;
drop table if exists public.gallery_reports;
drop table if exists public.gallery_comments;
drop table if exists public.gallery_likes;
drop table if exists public.gallery_posts;

drop trigger if exists gallery_deployment_protected on public.deployments;

drop function if exists public.gallery_feed(text, text, integer, integer);
drop function if exists public.gallery_record_view(uuid, text);
drop function if exists public.gallery_posts_before_insert();
drop function if exists public.gallery_touch_updated_at();
drop function if exists public.gallery_deployment_protected();
drop function if exists public.gallery_comments_before_insert();
drop function if exists public.gallery_likes_count();
drop function if exists public.gallery_comments_count();
drop function if exists public.gallery_reports_apply();

drop policy if exists "owners list gallery files" on storage.objects;
drop policy if exists "owners upload gallery files" on storage.objects;
drop policy if exists "owners update gallery files" on storage.objects;
drop policy if exists "owners delete gallery files" on storage.objects;

update storage.buckets set public = false where id = 'gallery';
