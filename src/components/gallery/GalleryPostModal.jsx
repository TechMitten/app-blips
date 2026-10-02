import { useEffect, useRef, useState } from 'react';
import {
  X, Heart, Share2, Shuffle, MoreHorizontal, Flag, Pencil, Trash2, Maximize2,
  Smartphone, Tablet, Monitor, Loader2, Send, Check, Link2, MessageCircle, Play, TriangleAlert
} from 'lucide-react';
import Modal from '../Modal';
import GalleryAvatar from './GalleryAvatar';
import ReportModal from './ReportModal';
import {
  fetchPost, recordView, setLiked, listComments, addComment, deleteComment,
  updateGalleryPost, unpublishPost, appUrl,
} from '../../lib/gallery';
import { formatCount, timeAgo, galleryShareUrl, COMMENT_MAX, TITLE_MAX, DESCRIPTION_MAX } from '../../lib/galleryFormat';

// Detail view for one gallery post: the live app on the left (its own
// my.appblips.com origin, so it is fully isolated from this SPA even with
// allow-same-origin -- which deployed apps need for their own localStorage),
// details, actions and comments on the right.
export default function GalleryPostModal({
  postId, initialPost, userId, isSignedIn, onClose, onRequireSignIn, onPostChange, onPostRemoved, onRemix,
}) {
  const [post, setPost] = useState(initialPost);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentsError, setCommentsError] = useState(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [shared, setShared] = useState('');
  const [remixing, setRemixing] = useState(false);
  const [actionError, setActionError] = useState('');
  const menuRef = useRef(null);

  const isOwner = Boolean(userId && post && post.user_id === userId);

  // Full row (with liked_by_me) even when the grid already had one: a deep
  // link has nothing else, and counts may have moved since the grid loaded.
  useEffect(() => {
    let cancelled = false;
    fetchPost(postId, userId)
      .then((row) => {
        if (cancelled) return;
        if (!row) setNotFound(true);
        else setPost(row);
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [postId, userId]);

  useEffect(() => { recordView(postId); }, [postId]);

  useEffect(() => {
    let cancelled = false;
    listComments(postId)
      .then((rows) => { if (!cancelled) setComments(rows); })
      .catch((err) => { if (!cancelled) setCommentsError(err.message); });
    return () => { cancelled = true; };
  }, [postId]);

  // Escape closes the innermost layer: menu, then the report dialog (which
  // handles its own), then this modal.
  useEffect(() => {
    if (reportTarget) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, reportTarget, onClose]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const patch = (changes) => {
    setPost((p) => ({ ...p, ...changes }));
    onPostChange(postId, changes);
  };

  const requireSignIn = () => {
    if (isSignedIn) return false;
    onRequireSignIn();
    return true;
  };

  const handleLike = async () => {
    if (requireSignIn() || !post) return;
    const liked = !post.liked_by_me;
    const before = { liked_by_me: post.liked_by_me, likes_count: post.likes_count };
    patch({ liked_by_me: liked, likes_count: Math.max(0, post.likes_count + (liked ? 1 : -1)) });
    try {
      await setLiked(postId, userId, liked);
    } catch (err) {
      patch(before);
      setActionError(err.message);
    }
  };

  const flash = (label) => {
    setShared(label);
    setTimeout(() => setShared(''), 2000);
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(label);
    } catch {
      setActionError('Could not copy the link.');
    }
  };

  const shareUrl = galleryShareUrl(window.location.origin, postId);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: post?.title || 'AppBlips', text: `Check out “${post?.title}” on AppBlips`, url: shareUrl });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    copy(shareUrl, 'share');
  };

  const handleRemix = async () => {
    if (requireSignIn() || !post) return;
    setRemixing(true);
    setActionError('');
    try {
      await onRemix(post);
    } catch (err) {
      setActionError(err.message || 'Remix failed.');
    } finally {
      setRemixing(false);
    }
  };

  const handleComment = async (e) => {
    e.preventDefault();
    if (requireSignIn()) return;
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setCommentError('');
    try {
      const row = await addComment(postId, userId, body);
      setComments((list) => [row, ...(list || [])]);
      setDraft('');
      patch({ comments_count: (post?.comments_count || 0) + 1 });
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (comment) => {
    try {
      await deleteComment(comment.id);
      setComments((list) => list.filter((c) => c.id !== comment.id));
      patch({ comments_count: Math.max(0, (post?.comments_count || 1) - 1) });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editing.title.trim()) return;
    setSavingEdit(true);
    try {
      const row = await updateGalleryPost(postId, editing);
      patch({ title: row.title, description: row.description });
      setEditing(null);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRemove = async () => {
    try {
      await unpublishPost(post);
      onPostRemoved(postId);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const url = post ? appUrl(post.slug) : '';
  const canRemix = Boolean(post?.allow_remix && post?.remix_path);
  const device = ['mobile', 'tablet', 'desktop'].includes(post?.device_type) ? post.device_type : 'desktop';
  const deviceMeta = {
    mobile: { label: 'Smartphone', Icon: Smartphone },
    tablet: { label: 'Tablet', Icon: Tablet },
    desktop: { label: 'Desktop', Icon: Monitor },
  }[device];
  const DeviceIcon = deviceMeta.Icon;

  const closeButton = (
    <button type="button" onClick={onClose} className="gallery-icon-btn" aria-label="Close">
      <X size={18} />
    </button>
  );

  if (notFound || (loadError && !post)) {
    return (
      <Modal zIndex={65} cardClass="w-full max-w-sm bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 p-6 animate-scale-in">
        <div className="flex justify-end">{closeButton}</div>
        <div className="flex flex-col items-center text-center gap-2 pb-2">
          <span className="gallery-empty-icon"><TriangleAlert size={24} /></span>
          <h2 className="text-lg font-bold text-slate-900">{notFound ? 'This blip isn’t available' : 'Couldn’t load this blip'}</h2>
          <p className="text-sm text-slate-500">{notFound ? 'It may have been removed by its creator.' : loadError}</p>
        </div>
      </Modal>
    );
  }

  // The report dialog is a sibling, not a child, of this modal's card: the
  // card's scale-in animation leaves a transform that would trap a nested
  // fixed-position dialog inside it.
  return (
    <>
    <Modal
      zIndex={65}
      scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4"
      cardClass="gallery-post-card w-full max-w-7xl bg-surface sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': post?.title || 'Gallery post' }}
    >
      <div className="gallery-post-layout">
        {/* Stage: the live app */}
        <div className="gallery-stage">
          <div className="gallery-stage-bar">
            <div className="gallery-showcase-device" aria-label={`Showcased as ${deviceMeta.label}`}>
              <DeviceIcon size={15} />
              <span>{deviceMeta.label}</span>
            </div>
            <span className="gallery-stage-url" title={url}>{url.replace(/^https?:\/\//, '')}</span>
            {post && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="gallery-stage-link" aria-label="Open full screen in a new tab">
                <Maximize2 size={15} /> <span className="hidden md:inline">Open</span>
              </a>
            )}
            <span className="sm:hidden ml-auto">{closeButton}</span>
          </div>
          <div className={`gallery-frame-wrap is-${device}`}>
            {post && (
              <iframe
                key={post.slug}
                src={url}
                title={post.title}
                onLoad={() => setFrameLoaded(true)}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
                allow="clipboard-write; fullscreen; autoplay"
                referrerPolicy="no-referrer"
                className={`gallery-frame ${frameLoaded ? 'is-loaded' : ''}`}
              />
            )}
            {!frameLoaded && (
              <div className="gallery-frame-loading">
                <Loader2 size={26} className="animate-spin" />
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <aside className="gallery-details custom-scrollbar">
          <div className="flex items-start gap-3">
            {post ? (
              <>
                <GalleryAvatar username={post.author_username} size={42} />
                <div className="min-w-0 flex-1">
                  {editing ? null : (
                    <h2 className="text-lg font-bold leading-snug text-slate-900 break-words">{post.title}</h2>
                  )}
                  <p className="text-sm text-slate-500">
                    <span className="font-medium text-slate-700">@{post.author_username}</span>
                    <span aria-hidden="true"> · </span>
                    {timeAgo(post.created_at)}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 space-y-2 pt-1">
                <span className="gallery-shimmer block h-5 w-2/3 rounded" />
                <span className="gallery-shimmer block h-3.5 w-1/3 rounded" />
              </div>
            )}
            <div className="flex items-center gap-1">
              {post && (isSignedIn || isOwner) && (
                <div className="relative" ref={menuRef}>
                  <button type="button" onClick={() => setMenuOpen((o) => !o)} className="gallery-icon-btn" aria-label="More actions" aria-expanded={menuOpen}>
                    <MoreHorizontal size={18} />
                  </button>
                  {menuOpen && (
                    <div className="gallery-menu animate-scale-in" role="menu">
                      {isOwner ? (
                        <>
                          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setEditing({ title: post.title, description: post.description || '' }); }}>
                            <Pencil size={15} /> Edit details
                          </button>
                          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); setConfirmRemove(true); }}>
                            <Trash2 size={15} /> Remove from gallery
                          </button>
                        </>
                      ) : (
                        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReportTarget({ type: 'post', id: postId }); }}>
                          <Flag size={15} /> Report
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <span className="hidden sm:inline-flex">{closeButton}</span>
            </div>
          </div>

          {editing ? (
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-2">
              <input
                value={editing.title}
                maxLength={TITLE_MAX}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="gallery-field"
                aria-label="Title"
                autoFocus
              />
              <textarea
                value={editing.description}
                maxLength={DESCRIPTION_MAX}
                rows={3}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className="gallery-field resize-none"
                aria-label="Description"
                placeholder="Description"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="gallery-ghost-btn">Cancel</button>
                <button type="submit" disabled={savingEdit || !editing.title.trim()} className="gallery-pill-btn">
                  {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                </button>
              </div>
            </form>
          ) : post?.description ? (
            <p className="mt-4 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">{post.description}</p>
          ) : null}

          {confirmRemove && (
            <div className="mt-4 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-3.5 text-sm text-rose-700">
              <p>Remove this listing? Your deployed app stays online; likes and comments are deleted.</p>
              <div className="mt-2.5 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmRemove(false)} className="gallery-ghost-btn">Keep</button>
                <button type="button" onClick={handleRemove} className="gallery-danger-btn">Remove</button>
              </div>
            </div>
          )}

          {post && (
            <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><Play size={12} /> {formatCount(post.views_count)} plays</span>
              <span className="inline-flex items-center gap-1"><Heart size={12} /> {formatCount(post.likes_count)} likes</span>
              <span className="inline-flex items-center gap-1"><MessageCircle size={12} /> {formatCount(post.comments_count)}</span>
            </div>
          )}

          <div className="gallery-actions">
            <button
              type="button"
              onClick={handleLike}
              disabled={!post}
              className={`gallery-action ${post?.liked_by_me ? 'is-liked' : ''}`}
              aria-pressed={Boolean(post?.liked_by_me)}
            >
              <Heart key={String(post?.liked_by_me)} size={17} fill={post?.liked_by_me ? 'currentColor' : 'none'} className={post?.liked_by_me ? 'gallery-heart-pop' : ''} />
              {post?.liked_by_me ? 'Liked' : 'Like'}
            </button>
            <button type="button" onClick={handleShare} disabled={!post} className="gallery-action">
              {shared === 'share' ? <Check size={17} className="text-emerald-500" /> : <Share2 size={17} />}
              {shared === 'share' ? 'Copied' : 'Share'}
            </button>
            {canRemix && (
              <button type="button" onClick={handleRemix} disabled={remixing} className="gallery-action gallery-action-primary">
                {remixing ? <Loader2 size={17} className="animate-spin" /> : <Shuffle size={17} />}
                Remix
              </button>
            )}
          </div>
          {post && (
            <button type="button" onClick={() => copy(url, 'app')} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
              {shared === 'app' ? <Check size={13} className="text-emerald-500" /> : <Link2 size={13} />}
              {shared === 'app' ? 'App link copied' : 'Copy direct app link'}
            </button>
          )}
          {actionError && <p className="mt-2 text-xs font-medium text-rose-500">{actionError}</p>}

          <section className="gallery-comments">
            <h3 className="text-sm font-semibold text-slate-900">
              Comments {post?.comments_count > 0 && <span className="text-slate-400 font-normal">· {post.comments_count}</span>}
            </h3>

            {isSignedIn ? (
              <form onSubmit={handleComment} className="gallery-composer">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleComment(e); }}
                  placeholder="Say something nice…"
                  rows={2}
                  aria-label="Write a comment"
                />
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className={`text-[11px] ${draft.length > COMMENT_MAX - 50 ? 'text-amber-500' : 'text-slate-400'}`}>
                    {draft.length > 0 ? `${draft.length}/${COMMENT_MAX}` : ''}
                  </span>
                  <button type="submit" disabled={posting || !draft.trim()} className="gallery-pill-btn">
                    {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
                  </button>
                </div>
                {commentError && <p className="px-1 text-xs font-medium text-rose-500">{commentError}</p>}
              </form>
            ) : (
              <button type="button" onClick={onRequireSignIn} className="gallery-signin-prompt">
                Sign in to like, comment and remix
              </button>
            )}

            {commentsError ? (
              <p className="text-xs text-rose-500">{commentsError}</p>
            ) : comments === null ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="flex gap-2.5">
                    <span className="gallery-shimmer h-7 w-7 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <span className="gallery-shimmer block h-3 w-1/4 rounded" />
                      <span className="gallery-shimmer block h-3 w-3/4 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">No comments yet. Be the first!</p>
            ) : (
              <ul className="space-y-3.5">
                {comments.map((c) => (
                  <li key={c.id} className="gallery-comment group/comment">
                    <GalleryAvatar username={c.author_username} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-semibold text-slate-800">@{c.author_username}</span>
                        {c.user_id === post?.user_id && <span className="gallery-creator-tag">Creator</span>}
                        <span className="text-slate-400"> · {timeAgo(c.created_at)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700">{c.body}</p>
                    </div>
                    {isSignedIn && (
                      <div className="gallery-comment-actions">
                        {(c.user_id === userId || isOwner) && (
                          <button type="button" onClick={() => handleDeleteComment(c)} aria-label="Delete comment" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        )}
                        {c.user_id !== userId && (
                          <button type="button" onClick={() => setReportTarget({ type: 'comment', id: c.id })} aria-label="Report comment" title="Report">
                            <Flag size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

    </Modal>
    {reportTarget && (
      <ReportModal
        target={reportTarget}
        userId={userId}
        onClose={() => setReportTarget(null)}
      />
    )}
    </>
  );
}
