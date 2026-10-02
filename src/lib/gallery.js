import { supabase } from '../supabase';
import { GALLERY_BUCKET, APPS_ORIGIN, randomToken } from './deploy';
import { LANDING_PAGE, validatePageName, checkFilesLimits } from './pages';

// --- Blip Gallery (hosted mode only) ---
//
// A post is an opt-in public listing of one deployment (`gallery_posts.slug`
// -> `deployments.slug`, cascading). Everything security-relevant is enforced
// in Postgres (see supabase/migrations/*_gallery.sql): RLS for ownership,
// triggers for counters/author names/auto-hide, and column grants so the
// client can only edit title/description/remix/thumbnail fields.
//
// Storage (`gallery` bucket, public): `<uid>/<postId>/thumb-<v>.jpg` and
// `<uid>/<postId>/source.json`. Thumbnails get a fresh name per upload so the
// CDN never serves a stale image; source.json is the clean `files` map (never
// the deploy-time snippets or the preview bridge) and exists only while the
// author allows remixing.

const POST_COLUMNS = 'id, slug, user_id, author_username, title, description, device_type, thumbnail_path, remix_path, allow_remix, likes_count, comments_count, views_count, created_at, updated_at, hidden';
const COMMENT_COLUMNS = 'id, post_id, user_id, author_username, body, created_at';
const VIEWER_KEY = 'appblips-gallery-viewer';
const SOURCE_FORMAT = 1;

export const PAGE_SIZE = 24;

const galleryError = (error, fallback) => new Error(error?.message || fallback);

export const galleryFileUrl = (path) =>
  path ? supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path).data.publicUrl : null;

export const appUrl = (slug) => `${APPS_ORIGIN}/${slug}`;

export const fetchFeed = async ({ sort = 'hot', search = '', limit = PAGE_SIZE, offset = 0 } = {}) => {
  const { data, error } = await supabase.rpc('gallery_feed', {
    p_sort: sort, p_search: search.trim() || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw galleryError(error, 'Failed to load the gallery.');
  return data || [];
};

const likedByMe = async (postId, userId) => {
  if (!userId) return false;
  const { data } = await supabase.from('gallery_likes').select('post_id')
    .eq('post_id', postId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
};

export const fetchPost = async (postId, userId) => {
  const { data, error } = await supabase.from('gallery_posts').select(POST_COLUMNS).eq('id', postId).maybeSingle();
  if (error) throw galleryError(error, 'Failed to load this app.');
  if (!data) return null;
  return { ...data, liked_by_me: await likedByMe(postId, userId) };
};

// The author's own post for a deployment (visible to them even when hidden).
export const fetchPostBySlug = async (slug) => {
  const { data, error } = await supabase.from('gallery_posts').select(POST_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw galleryError(error, 'Failed to load the gallery listing.');
  return data;
};

// Thumbnails are immutable (new name per upload) so they cache long;
// source.json is overwritten in place, so it must not.
const upload = async (path, body, contentType, cacheControl = '31536000') => {
  const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(path, body, {
    contentType, cacheControl, upsert: true,
  });
  if (error) throw galleryError(error, 'Failed to upload to the gallery.');
};

const removePaths = async (paths) => {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(GALLERY_BUCKET).remove(list);
  if (error && error.statusCode !== '404') console.warn('Gallery file cleanup failed:', error);
};

// Creates or updates the post for `slug`. `thumbnailBlob` replaces the
// thumbnail only when given; `source` ({ files, studioMode, aiEnabled }) is
// re-uploaded on every publish while remixing is allowed, so remixes track the
// latest deploy.
export const publishToGallery = async ({
  slug, userId, title, description = '', deviceType = 'desktop', allowRemix = true, thumbnailBlob = null, source = null,
}) => {
  const fields = {
    title: title.trim(),
    description: description.trim(),
    device_type: ['mobile', 'tablet', 'desktop'].includes(deviceType) ? deviceType : 'desktop',
    allow_remix: Boolean(allowRemix),
  };
  let post = await fetchPostBySlug(slug);

  if (post) {
    const { error } = await supabase.from('gallery_posts').update(fields).eq('id', post.id);
    if (error) throw galleryError(error, 'Failed to update the gallery listing.');
  } else {
    const { data, error } = await supabase.from('gallery_posts')
      .insert({ ...fields, slug, user_id: userId }).select(POST_COLUMNS).single();
    if (error) throw galleryError(error, 'Failed to publish to the gallery.');
    post = data;
  }

  const folder = `${userId}/${post.id}`;
  const paths = {};
  const stale = [];

  if (thumbnailBlob) {
    paths.thumbnail_path = `${folder}/thumb-${randomToken(8)}.jpg`;
    await upload(paths.thumbnail_path, thumbnailBlob, thumbnailBlob.type || 'image/jpeg');
    if (post.thumbnail_path) stale.push(post.thumbnail_path);
  }

  if (allowRemix && source?.files) {
    paths.remix_path = `${folder}/source.json`;
    const payload = JSON.stringify({ format: SOURCE_FORMAT, ...source });
    await upload(paths.remix_path, new Blob([payload], { type: 'application/json' }), 'application/json', '60');
  } else if (!allowRemix && post.remix_path) {
    paths.remix_path = null;
    stale.push(post.remix_path);
  }

  if (Object.keys(paths).length) {
    const { data, error } = await supabase.from('gallery_posts').update(paths).eq('id', post.id).select(POST_COLUMNS).single();
    if (error) throw galleryError(error, 'Failed to save the gallery thumbnail.');
    post = data;
  }
  await removePaths(stale);
  return post;
};

export const updateGalleryPost = async (postId, { title, description, allowRemix }) => {
  const fields = {};
  if (title !== undefined) fields.title = title.trim();
  if (description !== undefined) fields.description = description.trim();
  if (allowRemix !== undefined) fields.allow_remix = Boolean(allowRemix);
  const { data, error } = await supabase.from('gallery_posts').update(fields).eq('id', postId).select(POST_COLUMNS).single();
  if (error) throw galleryError(error, 'Failed to update the gallery listing.');
  return data;
};

// Removes a listing (and its files) but leaves the deployment online.
export const unpublishPost = async (post) => {
  if (!post) return;
  const { error } = await supabase.from('gallery_posts').delete().eq('id', post.id);
  if (error) throw galleryError(error, 'Failed to remove the gallery listing.');
  await removePaths([post.thumbnail_path, post.remix_path]);
};

export const unpublishFromGallery = async (slug) => unpublishPost(await fetchPostBySlug(slug));

export const setLiked = async (postId, userId, liked) => {
  const query = liked
    ? supabase.from('gallery_likes').insert({ post_id: postId, user_id: userId })
    : supabase.from('gallery_likes').delete().eq('post_id', postId).eq('user_id', userId);
  const { error } = await query;
  // A duplicate like (double click, second tab) is already the desired state.
  if (error && error.code !== '23505') throw galleryError(error, 'Failed to update your like.');
};

export const listComments = async (postId) => {
  const { data, error } = await supabase.from('gallery_comments').select(COMMENT_COLUMNS)
    .eq('post_id', postId).order('created_at', { ascending: false }).limit(200);
  if (error) throw galleryError(error, 'Failed to load comments.');
  return data || [];
};

export const addComment = async (postId, userId, body) => {
  const { data, error } = await supabase.from('gallery_comments')
    .insert({ post_id: postId, user_id: userId, body: body.trim() }).select(COMMENT_COLUMNS).single();
  if (error) throw galleryError(error, 'Failed to post your comment.');
  return data;
};

export const deleteComment = async (commentId) => {
  const { error } = await supabase.from('gallery_comments').delete().eq('id', commentId);
  if (error) throw galleryError(error, 'Failed to delete the comment.');
};

const report = async (row) => {
  const { error } = await supabase.from('gallery_reports').insert(row);
  // Already reported by this user: nothing more to do.
  if (error && error.code !== '23505') throw galleryError(error, 'Failed to send the report.');
};

export const reportPost = (postId, userId, reason = '') =>
  report({ post_id: postId, reporter_id: userId, reason: reason.slice(0, 300) });

export const reportComment = (commentId, userId, reason = '') =>
  report({ comment_id: commentId, reporter_id: userId, reason: reason.slice(0, 300) });

// Signed-in viewers are deduped server-side by user id; anonymous ones by a
// random per-browser key (best effort -- it only feeds a vanity counter).
const viewerKey = () => {
  try {
    let key = localStorage.getItem(VIEWER_KEY);
    if (!key) {
      key = randomToken(24);
      localStorage.setItem(VIEWER_KEY, key);
    }
    return key;
  } catch {
    return randomToken(24);
  }
};

export const recordView = async (postId) => {
  const { error } = await supabase.rpc('gallery_record_view', { p_post_id: postId, p_viewer_key: viewerKey() });
  if (error) console.warn('Failed to record gallery view:', error);
};

// Downloads and validates a post's remix source. The JSON is user-uploaded,
// so it is checked as strictly as a project import: only valid page names,
// string contents, a landing page, and the usual size limits.
export const fetchRemixSource = async (post) => {
  if (!post?.allow_remix || !post.remix_path) throw new Error('This app is not available for remixing.');
  const url = `${galleryFileUrl(post.remix_path)}?v=${encodeURIComponent(post.updated_at || '')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download the app source.');
  const data = await res.json();
  const files = data?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('This app source is invalid.');
  const clean = {};
  for (const [name, html] of Object.entries(files)) {
    if (!validatePageName(name) || typeof html !== 'string') throw new Error('This app source is invalid.');
    clean[name] = html;
  }
  if (!clean[LANDING_PAGE]) throw new Error('This app source is missing its landing page.');
  const limitError = checkFilesLimits(clean);
  if (limitError) throw new Error(limitError);
  return {
    files: clean,
    studioMode: data.studioMode === 'website' ? 'website' : data.studioMode === 'game' ? 'game' : 'app',
    aiEnabled: Boolean(data.aiEnabled),
  };
};
