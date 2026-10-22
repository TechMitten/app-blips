import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

// Seed prompts for the empty state. When `sampleSize` is set (App, Website and
// Game studios) the whole pool is shuffled on every mount, so the first page
// rotates between launches, and the rest of the pool sits on further pages the
// user can drag, swipe or arrow through. Without it, presets flagged
// `featured` are shown as a single fixed page (Ask mode's six presets).
// Picking one drops its prompt into the composer via onPick.
//
// Tile palettes are a fixed set of six hues spaced around the colour wheel.
// Tailwind's own ramp cannot be used for this: it bunches sky/blue/indigo/
// violet and emerald/teal within ~20°, so six different hue names can still
// render as near-identical tiles. Each card takes the nearest hue that is
// still unused within its page, so no two tiles seen together share or
// approach a colour. The actual tile styling (light + dark) lives in
// starter-ideas.css under [data-hue].
const TILE_HUES = [
  { key: 'rose', hue: 350 },
  { key: 'amber', hue: 38 },
  { key: 'emerald', hue: 160 },
  { key: 'sky', hue: 199 },
  { key: 'indigo', hue: 239 },
  { key: 'fuchsia', hue: 292 },
];

// Degrees for the preset color names, used only to pick the closest tile hue.
const PRESET_HUES = {
  rose: 350,
  amber: 38,
  emerald: 160,
  sky: 199,
  indigo: 239,
  violet: 262,
  blue: 221,
  teal: 173,
};

const MAX_VISIBLE = 6;

// A mouse drag shorter than this is still a click on the card under it.
const DRAG_THRESHOLD_PX = 5;
// How far a mouse drag must travel to turn the page rather than spring back.
const PAGE_FLICK_PX = 40;

const circularDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const presetHue = (colorString = '') => {
  const match = colorString.match(/amber|sky|emerald|violet|rose|blue|teal|indigo/);
  return match ? PRESET_HUES[match[0]] : PRESET_HUES.indigo;
};

const assignHues = (starters) => {
  const remaining = [...TILE_HUES];
  return starters.map((starter, index) => {
    const target = presetHue(starter.color);
    let best = 0;
    remaining.forEach((candidate, i) => {
      if (circularDistance(target, candidate.hue) < circularDistance(target, remaining[best].hue)) {
        best = i;
      }
    });
    const [chosen] = remaining.splice(best, 1);
    return { starter, hue: (chosen || TILE_HUES[index % TILE_HUES.length]).key };
  });
};

// Fisher-Yates over a copy.
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const chunk = (list, size) => {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages;
};

const scrollBehavior = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
);

// Touch and trackpads scroll the row natively; this adds click-and-drag for a
// mouse. Once a press moves past the threshold it becomes a drag, and the
// click that would follow is swallowed so letting go over a card doesn't pick
// it. With `paged`, releasing settles on the next/previous page in the drag's
// direction instead of wherever the row happened to stop.
function useMouseDragScroll(ref, paged) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let drag = null;
    let swallowClick = false;

    const onPointerDown = (event) => {
      swallowClick = false;
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { startX: event.clientX, startLeft: el.scrollLeft, moved: false, pointerId: event.pointerId };
    };
    const onPointerMove = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        el.dataset.dragging = 'true';
        el.setPointerCapture?.(drag.pointerId);
      }
      el.scrollLeft = drag.startLeft - dx;
    };
    const onPointerUp = (event) => {
      if (!drag) return;
      const { moved, startX, startLeft } = drag;
      drag = null;
      if (!moved) return;
      swallowClick = true;
      delete el.dataset.dragging;
      if (paged && el.clientWidth > 0) {
        const dx = event.clientX - startX;
        const startPage = Math.round(startLeft / el.clientWidth);
        const step = dx < -PAGE_FLICK_PX ? 1 : dx > PAGE_FLICK_PX ? -1 : 0;
        const lastPage = Math.max(0, el.children.length - 1);
        const page = Math.min(lastPage, Math.max(0, startPage + step));
        el.scrollTo({ left: page * el.clientWidth, behavior: scrollBehavior() });
      }
    };
    const onClickCapture = (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [ref, paged]);
}

// Tracks whether the row can scroll either way and which page is in view, for
// the arrows, the edge fades and the page counter.
function useScrollPosition(ref, deps) {
  const [position, setPosition] = useState({ atStart: true, atEnd: true, page: 0 });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const maxLeft = el.scrollWidth - el.clientWidth;
    const next = {
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= maxLeft - 1,
      page: el.clientWidth > 0 ? Math.round(el.scrollLeft / el.clientWidth) : 0,
    };
    setPosition((prev) => (
      prev.atStart === next.atStart && prev.atEnd === next.atEnd && prev.page === next.page ? prev : next
    ));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, update, ...deps]);

  return position;
}

// `sampleSize` switches from the curated/featured list to the whole pool,
// shuffled on mount and paged `sampleSize` at a time.
// `variant="chips"` renders the same ideas as a sliding row of pills (the
// first-build hero) instead of pages of the two-column card grid.
export default function StarterIdeas({ ideas, onPick, sampleSize, variant = 'cards' }) {
  const ordered = useMemo(() => {
    if (sampleSize) return shuffle(ideas);
    const featured = ideas.filter((idea) => idea.featured);
    return (featured.length > 0 ? featured : ideas).slice(0, MAX_VISIBLE);
  }, [ideas, sampleSize]);
  const pageSize = sampleSize || MAX_VISIBLE;
  const pages = useMemo(() => chunk(ordered, pageSize).map(assignHues), [ordered, pageSize]);

  const scrollerRef = useRef(null);
  const isChips = variant === 'chips';
  useMouseDragScroll(scrollerRef, !isChips);
  const { atStart, atEnd, page } = useScrollPosition(scrollerRef, [pages, variant]);

  const scrollByStep = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Chips scroll freely, so step most of a row and keep a chip of overlap.
    const step = isChips ? el.clientWidth * 0.8 : el.clientWidth;
    el.scrollBy({ left: direction * step, behavior: scrollBehavior() });
  };

  if (isChips) {
    return (
      <div className="flex items-center gap-1.5 animate-fade-in" style={{ animationDelay: '0.08s' }}>
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          aria-label="Previous ideas"
          tabIndex={atStart ? -1 : 0}
          className={`starter-chip shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${atStart ? 'invisible' : ''}`}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div
          ref={scrollerRef}
          role="region"
          aria-label="Starter ideas"
          data-fade-start={atStart ? undefined : 'true'}
          data-fade-end={atEnd ? undefined : 'true'}
          className="starter-scroller starter-chip-row flex-1 min-w-0 flex items-center gap-2 overflow-x-auto py-1 px-0.5"
        >
          {pages.flat().map(({ starter, hue }) => {
            const IconComponent = starter.icon || Sparkles;
            return (
              <button
                key={starter.title}
                type="button"
                onClick={() => onPick(starter)}
                title={starter.prompt}
                className="starter-chip group shrink-0 inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 cursor-pointer"
              >
                <span
                  data-hue={hue}
                  className="starter-card-tile shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                >
                  <IconComponent size={13} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="text-[13px] font-semibold leading-none whitespace-nowrap">{starter.title}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          aria-label="More ideas"
          tabIndex={atEnd ? -1 : 0}
          className={`starter-chip shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${atEnd ? 'invisible' : ''}`}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const arrowClass = 'w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 disabled:opacity-35 disabled:pointer-events-none dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer';

  return (
    <div className="space-y-2 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <p className="text-xs font-semibold text-slate-500 dark:text-white/55">
          Or start with one of these
        </p>
        {pages.length > 1 && (
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => scrollByStep(-1)} disabled={atStart} aria-label="Previous ideas" className={arrowClass}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <span className="min-w-[2.75rem] text-center text-[11px] font-semibold tabular-nums text-slate-500 dark:text-white/50">
              {Math.min(page, pages.length - 1) + 1} / {pages.length}
            </span>
            <button type="button" onClick={() => scrollByStep(1)} disabled={atEnd} aria-label="More ideas" className={arrowClass}>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        role="region"
        aria-label="Starter ideas"
        className="starter-scroller starter-pages flex overflow-x-auto -mx-1"
      >
        {pages.map((cards, pageIndex) => (
          <div
            key={pageIndex}
            className="w-full shrink-0 grid grid-cols-2 content-start gap-2 px-1 pb-1.5"
          >
            {cards.map(({ starter, hue }) => {
              const IconComponent = starter.icon || Sparkles;
              return (
                <button
                  key={starter.title}
                  type="button"
                  onClick={() => onPick(starter)}
                  title={starter.prompt}
                  className="starter-card group flex items-start gap-2.5 text-left p-2.5 rounded-2xl cursor-pointer"
                >
                  <span
                    data-hue={hue}
                    className="starter-card-tile shrink-0 w-9 h-9 rounded-[0.65rem] flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.06]"
                  >
                    <IconComponent size={18} strokeWidth={2.1} aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex flex-col pt-0.5">
                    <span className="text-sm font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
                      {starter.title}
                    </span>
                    <span className="text-[11px] font-medium leading-snug text-slate-500 dark:text-white/50">
                      {starter.category}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
