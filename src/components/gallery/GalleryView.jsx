import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Search, X, Flame, Sparkles, Trophy, UserRound, Home, ChevronDown,
  LogIn, RefreshCw, Rocket, SearchX
} from 'lucide-react';
import useGallery from '../../hooks/useGallery';
import { setLiked } from '../../lib/gallery';
import GalleryCard, { GalleryCardSkeleton } from './GalleryCard';
import GalleryPostModal from './GalleryPostModal';

const SECTION_SIZE = 8;

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'hot', label: 'Hot', icon: Flame },
  { id: 'new', label: 'New', icon: Sparkles },
  { id: 'top', label: 'Top', icon: Trophy },
  { id: 'mine', label: 'Mine', icon: UserRound, signedIn: true },
];

const SECTIONS = [
  { sort: 'hot', label: 'Hot', icon: Flame, tone: 'hot' },
  { sort: 'new', label: 'Fresh', icon: Sparkles, tone: 'new' },
  { sort: 'top', label: 'All-time top', icon: Trophy, tone: 'top' },
];

function CardGrid({ children }) {
  return <div className="gallery-grid">{children}</div>;
}

function Skeletons({ count }) {
  return Array.from({ length: count }, (_, i) => <GalleryCardSkeleton key={i} />);
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="gallery-empty animate-fade-in">
      <span className="gallery-empty-icon"><Icon size={26} /></span>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
      {action}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <EmptyState
      icon={RefreshCw}
      title="Couldn't load the gallery"
      body={message}
      action={<button type="button" onClick={onRetry} className="gallery-pill-btn mt-1">Try again</button>}
    />
  );
}

// Full-page community gallery (hosted mode only). Home shows Hot / Fresh / Top
// sections like a storefront; the other tabs are one infinite grid. The post
// detail modal lives here too, so likes and edits made there are patched into
// every feed on screen without a refetch.
export default function GalleryView({
  userId, isSignedIn, activePostId, onOpenPost, onClosePost, onClose, onRequireSignIn, onRemix,
}) {
  const [tab, setTab] = useState('home');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const isHome = tab === 'home' && !search;
  const gridSort = tab === 'home' ? 'hot' : tab;

  const hot = useGallery({ sort: 'hot', userId, pageSize: SECTION_SIZE, enabled: isHome });
  const fresh = useGallery({ sort: 'new', userId, pageSize: SECTION_SIZE, enabled: isHome });
  const top = useGallery({ sort: 'top', userId, pageSize: SECTION_SIZE, enabled: isHome });
  const grid = useGallery({ sort: gridSort, search, userId, enabled: !isHome && (gridSort !== 'mine' || isSignedIn) });
  const sectionFeeds = { hot, new: fresh, top };
  const allFeeds = [hot, fresh, top, grid];

  const patchEverywhere = (postId, patch) => allFeeds.forEach((f) => f.patchPost(postId, patch));
  const removeEverywhere = (postId) => allFeeds.forEach((f) => f.removePost(postId));

  // Optimistic in every feed at once (a post can sit in Hot and Fresh).
  const handleToggleLike = async (post) => {
    if (!isSignedIn) { onRequireSignIn(); return; }
    const liked = !post.liked_by_me;
    const apply = (on) => patchEverywhere(post.id, (p) => (p.liked_by_me === on ? {} : {
      liked_by_me: on, likes_count: Math.max(0, p.likes_count + (on ? 1 : -1)),
    }));
    apply(liked);
    try {
      await setLiked(post.id, userId, liked);
    } catch (err) {
      console.warn(err);
      apply(!liked);
    }
  };

  // Infinite scroll for the single-grid tabs.
  const { loadMore, hasMore } = grid;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || isHome || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
      { root: scrollRef.current, rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isHome, hasMore, loadMore]);

  const selectTab = (id) => {
    setTab(id);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // Escape backs out of the gallery unless a modal above it handles it first.
  useEffect(() => {
    if (activePostId) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && e.target?.tagName !== 'INPUT') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activePostId, onClose]);

  const initialPost = activePostId
    ? allFeeds.flatMap((f) => f.posts).find((p) => p.id === activePostId) || null
    : null;

  const renderCards = (posts) => posts.map((post, i) => (
    <GalleryCard key={post.id} post={post} index={i} onOpen={onOpenPost} onToggleLike={handleToggleLike} />
  ));

  const renderHome = () => {
    if (SECTIONS.every(({ sort }) => !sectionFeeds[sort].loading && !sectionFeeds[sort].error && sectionFeeds[sort].posts.length === 0)) {
      return (
        <EmptyState
          icon={Rocket}
          title="The gallery is waiting for its first blip"
          body="Deploy an app and switch on “Show in Gallery” to be the first one here."
        />
      );
    }
    // A post can rank in several sections (with few posts, every one is in all
    // three), so each shows only in the first section that has it. A section
    // waits on the ones above it, so cards never appear and then vanish.
    const shown = new Set();
    let pending = false;
    return SECTIONS.map(({ sort, label, icon: Icon, tone }) => {
      const feed = sectionFeeds[sort];
      const loading = pending || feed.loading;
      pending = loading;
      const posts = loading ? [] : feed.posts.filter((p) => !shown.has(p.id));
      posts.forEach((p) => shown.add(p.id));
      if (!loading && !feed.error && posts.length === 0) return null;
      return (
        <section key={sort} className="gallery-section">
          <button type="button" onClick={() => selectTab(sort)} className={`gallery-section-pill tone-${tone}`}>
            <Icon size={15} /> {label}
          </button>
          {feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.refresh} />
          ) : (
            <CardGrid>{loading ? <Skeletons count={SECTION_SIZE} /> : renderCards(posts)}</CardGrid>
          )}
          {feed.hasMore && (
            <div className="gallery-show-more">
              <button type="button" onClick={() => selectTab(sort)}>
                Show more <ChevronDown size={15} />
              </button>
            </div>
          )}
        </section>
      );
    });
  };

  const renderGrid = () => {
    if (gridSort === 'mine' && !isSignedIn) {
      return (
        <EmptyState
          icon={LogIn}
          title="Sign in to see your blips"
          body="Everything you publish to the gallery shows up here."
          action={<button type="button" onClick={onRequireSignIn} className="gallery-pill-btn mt-1">Sign in</button>}
        />
      );
    }
    if (grid.error && grid.posts.length === 0) return <ErrorState message={grid.error} onRetry={grid.refresh} />;
    if (!grid.loading && grid.posts.length === 0) {
      if (search) {
        return <EmptyState icon={SearchX} title={`No blips match “${search}”`} body="Try a different word, or browse what’s hot." />;
      }
      if (gridSort === 'mine') {
        return (
          <EmptyState
            icon={Rocket}
            title="You haven’t published anything yet"
            body="Deploy an app and switch on “Show in Gallery” to share it here."
          />
        );
      }
      return <EmptyState icon={Rocket} title="Nothing here yet" body="Be the first to publish a blip." />;
    }
    return (
      <>
        <CardGrid>
          {renderCards(grid.posts)}
          {(grid.loading || grid.loadingMore) && <Skeletons count={grid.loading ? 12 : 4} />}
        </CardGrid>
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        {!grid.loading && !grid.hasMore && grid.posts.length > 8 && (
          <p className="py-8 text-center text-xs text-slate-400">You’ve reached the end.</p>
        )}
      </>
    );
  };

  return (
    <div className="gallery-view fixed inset-0 z-[55] flex flex-col" role="region" aria-label="Gallery">
      <header className="gallery-topbar">
        <button type="button" onClick={onClose} className="gallery-back-btn" aria-label="Back to the studio">
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">Studio</span>
        </button>
        <div className="gallery-brand">
          <span className="gallery-brand-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>Gallery</span>
        </div>
        <label className="gallery-search">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blips and creators"
            aria-label="Search the gallery"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-700">
              <X size={15} />
            </button>
          )}
        </label>
        {!isSignedIn && (
          <button type="button" onClick={onRequireSignIn} className="gallery-pill-btn shrink-0">
            <LogIn size={15} /> <span className="hidden sm:inline">Sign in</span>
          </button>
        )}
      </header>

      <main ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-10">
          <div className="gallery-hero">
            <h1>Discover what people are building</h1>
            <p>Play with apps made on AppBlips, cheer on your favorites, and remix them into something new.</p>
          </div>

          <nav className="gallery-tabs" aria-label="Gallery sections">
            {TABS.filter((t) => !t.signedIn || isSignedIn).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`gallery-tab ${tab === id ? 'is-active' : ''}`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </nav>

          {search && (
            <p className="mb-4 text-sm text-slate-500">
              Results for <span className="font-semibold text-slate-800">“{search}”</span>
            </p>
          )}

          {isHome ? renderHome() : renderGrid()}
        </div>
      </main>

      {activePostId && (
        <GalleryPostModal
          key={activePostId}
          postId={activePostId}
          initialPost={initialPost}
          userId={userId}
          isSignedIn={isSignedIn}
          onClose={onClosePost}
          onRequireSignIn={onRequireSignIn}
          onPostChange={patchEverywhere}
          onPostRemoved={(id) => { removeEverywhere(id); onClosePost(); }}
          onRemix={onRemix}
        />
      )}
    </div>
  );
}
