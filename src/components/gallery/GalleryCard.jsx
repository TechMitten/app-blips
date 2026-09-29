import { useState } from 'react';
import { Heart, Play, Shuffle, MessageCircle } from 'lucide-react';
import { galleryFileUrl } from '../../lib/gallery';
import { formatCount, avatarGradient } from '../../lib/galleryFormat';
import GalleryAvatar from './GalleryAvatar';

// Grid tile: 16:10 thumbnail with a glass stats pill, then avatar, title and
// @author underneath. The whole card opens the post; the heart likes in place.
export default function GalleryCard({ post, onOpen, onToggleLike, index = 0 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = imgFailed ? null : galleryFileUrl(post.thumbnail_path);

  return (
    <article
      className="gallery-card group"
      style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(post.id)}
        className="gallery-card-media"
        aria-label={`Open ${post.title} by @${post.author_username}`}
      >
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="gallery-card-img"
          />
        ) : (
          <div className="gallery-card-fallback" style={{ background: avatarGradient(post.id) }}>
            <span>{post.title}</span>
          </div>
        )}
        <span className="gallery-card-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
        {post.allow_remix && post.remix_path && (
          <span className="gallery-chip gallery-chip-remix" aria-hidden="true">
            <Shuffle size={11} /> Remix
          </span>
        )}
        <span className="gallery-stats" aria-hidden="true">
          <span><Play size={10} fill="currentColor" /> {formatCount(post.views_count)}</span>
          {post.comments_count > 0 && (
            <span><MessageCircle size={10} fill="currentColor" /> {formatCount(post.comments_count)}</span>
          )}
          <span><Heart size={10} fill="currentColor" /> {formatCount(post.likes_count)}</span>
        </span>
      </button>

      <div className="gallery-card-meta">
        <GalleryAvatar username={post.author_username} size={32} />
        <div className="min-w-0 flex-1">
          <h3 className="gallery-card-title" title={post.title}>{post.title}</h3>
          <p className="gallery-card-author">@{post.author_username}</p>
        </div>
        <button
          type="button"
          onClick={() => onToggleLike(post)}
          className={`gallery-like-btn ${post.liked_by_me ? 'is-liked' : ''}`}
          aria-pressed={Boolean(post.liked_by_me)}
          aria-label={post.liked_by_me ? 'Unlike' : 'Like'}
        >
          <Heart size={16} fill={post.liked_by_me ? 'currentColor' : 'none'} />
        </button>
      </div>
    </article>
  );
}

export function GalleryCardSkeleton() {
  return (
    <div className="gallery-card" aria-hidden="true">
      <div className="gallery-card-media gallery-shimmer" />
      <div className="gallery-card-meta">
        <span className="gallery-shimmer h-8 w-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <span className="gallery-shimmer block h-3.5 w-3/4 rounded" />
          <span className="gallery-shimmer block h-3 w-1/3 rounded" />
        </div>
      </div>
    </div>
  );
}
