import { useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { Sparkles } from 'lucide-react';

// Drag-to-scroll threshold (px) below which a mouse interaction still
// counts as a click rather than a pan, so picking a card stays reliable.
const DRAG_CLICK_THRESHOLD = 5;

// Auto-scroll speed in px per ms (~14px/s) for the idle marquee drift.
const AUTO_SCROLL_SPEED = 0.014;

// Icon tile treatments keyed by hue. Tailwind's scanner only sees literal class
// names, so each variant is spelled out in full rather than composed at runtime.
//
// Icon tile treatments keyed by hue.
//
// CAUTION: the dark theme mirrors every hue ramp (dark[n] == stock[1000-n]; see
// index.css). Under .dark the LOW steps are the dark colors and the HIGH steps
// are the light ones, so a step must not be reused across themes:
//   Light — ink on paper: a -50 tint carrying a saturated -600 stroke.
//   Dark  — low-alpha -500 tint with a bright -700 stroke. (Bright is a HIGH
//   step here; reusing the light theme's -600 stroke would give a pale tile
//   with white-on-pastel, and -300 would give a dark, invisible glyph.)
// The hue lives only in the tile: card hover feedback comes from the lift,
// border, and shadow, so no colored wash sits on top of the content.
const ICON_THEMES = {
  amber: {
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/25 dark:text-amber-700',
  },
  sky: {
    tile: 'bg-sky-50 text-sky-600 dark:bg-sky-500/25 dark:text-sky-700',
  },
  emerald: {
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/25 dark:text-emerald-700',
  },
  violet: {
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/25 dark:text-violet-700',
  },
  rose: {
    tile: 'bg-rose-50 text-rose-600 dark:bg-rose-500/25 dark:text-rose-700',
  },
  blue: {
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/25 dark:text-blue-700',
  },
  teal: {
    tile: 'bg-teal-50 text-teal-600 dark:bg-teal-500/25 dark:text-teal-700',
  },
  indigo: {
    tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/25 dark:text-indigo-700',
  },
};

const getColorClasses = (colorString = '') => {
  const match = colorString.match(/amber|sky|emerald|violet|rose|blue|teal|indigo/);
  return ICON_THEMES[match ? match[0] : 'indigo'];
};

const shuffle = (items) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

function StarterRow({ ideas, rowIndex, onPick }) {
  const scrollerRef = useRef(null);
  const trackRef = useRef(null);
  const singleWidthRef = useRef(0);
  const dragRef = useRef({
    isDown: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    captured: false,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    momentumRaf: null,
    moveResetTimeout: null,
  });
  const autoPausedRef = useRef(false);

  // Render 3 sets of ideas so the row can wrap seamlessly in either direction
  const tripleIdeas = useMemo(() => [...ideas, ...ideas, ...ideas], [ideas]);

  const getSingleWidth = () => {
    if (singleWidthRef.current > 0) return singleWidthRef.current;
    const scroller = scrollerRef.current;
    if (scroller && scroller.scrollWidth > 0) {
      singleWidthRef.current = scroller.scrollWidth / 3;
      return singleWidthRef.current;
    }
    return 0;
  };

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const applyOffset = () => {
      if (!scrollerRef.current) return;
      const sw = scrollerRef.current.scrollWidth / 3;
      if (sw > 0) {
        singleWidthRef.current = sw;
        // Stagger row 1 so rows are not stacked evenly, while seamless wrapping
        // ensures no empty gaps appear at the left margin.
        const initialOffset = rowIndex === 1 ? 75 : 0;
        scrollerRef.current.scrollLeft = sw + initialOffset;
      }
    };

    applyOffset();
    const raf = requestAnimationFrame(applyOffset);
    return () => cancelAnimationFrame(raf);
  }, [rowIndex, ideas]);

  useEffect(() => {
    return () => {
      if (dragRef.current.momentumRaf != null) {
        cancelAnimationFrame(dragRef.current.momentumRaf);
      }
      if (dragRef.current.moveResetTimeout != null) {
        clearTimeout(dragRef.current.moveResetTimeout);
      }
    };
  }, []);

  // Idle marquee: each row drifts very slowly on its own (alternating
  // direction per row) and pauses while hovered, while the user is dragging
  // or gliding, or when prefers-reduced-motion is set. The tripled card list
  // plus the same wrap window used by drag/scroll keeps the loop seamless.
  useEffect(() => {
    const direction = rowIndex % 2 === 0 ? 1 : -1;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = null;
    let lastTime = null;
    // Fractional accumulator: scrollLeft assignments are truncated to whole
    // pixels on 1x displays, so sub-pixel per-frame steps must be summed here
    // or the row would never actually move.
    let pos = null;

    const clearSubpixel = () => {
      const track = trackRef.current;
      if (track && track.style.transform) track.style.transform = '';
    };

    const step = (now) => {
      raf = requestAnimationFrame(step);
      const scroller = scrollerRef.current;
      const drag = dragRef.current;
      if (!scroller || autoPausedRef.current || reducedMotion.matches || drag.isDown || drag.moved || drag.momentumRaf != null) {
        lastTime = now;
        pos = null;
        clearSubpixel();
        return;
      }
      if (pos == null) pos = scroller.scrollLeft;
      if (lastTime == null) {
        lastTime = now;
        return;
      }
      const dt = Math.min(now - lastTime, 64);
      lastTime = now;
      const sw = getSingleWidth();
      pos += AUTO_SCROLL_SPEED * dt * direction;
      if (sw > 0) {
        if (pos < sw * 0.5) pos += sw;
        else if (pos > sw * 1.5) pos -= sw;
      }
      // scrollLeft is integer-only on 1x displays, so put the whole-pixel
      // part there and express the subpixel remainder as a composited
      // translateX on the track for jitter-free motion.
      const base = Math.floor(pos);
      scroller.scrollLeft = base;
      const track = trackRef.current;
      if (track) track.style.transform = `translateX(${(base - pos).toFixed(3)}px)`;
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearSubpixel();
    };
  }, [rowIndex]);

  const handlePointerDown = (e) => {
    if (e.pointerType !== 'mouse') return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (dragRef.current.momentumRaf != null) {
      cancelAnimationFrame(dragRef.current.momentumRaf);
      dragRef.current.momentumRaf = null;
    }
    if (dragRef.current.moveResetTimeout != null) {
      clearTimeout(dragRef.current.moveResetTimeout);
      dragRef.current.moveResetTimeout = null;
    }

    getSingleWidth();
    const track = trackRef.current;
    if (track) track.style.transform = '';

    const now = performance.now();
    dragRef.current = {
      isDown: true,
      startX: e.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
      captured: false,
      lastX: e.clientX,
      lastTime: now,
      velocity: 0,
      momentumRaf: null,
      moveResetTimeout: null,
    };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.isDown) return;

    const delta = e.clientX - drag.startX;
    if (Math.abs(delta) > DRAG_CLICK_THRESHOLD) {
      drag.moved = true;
      const scroller = scrollerRef.current;
      if (scroller && !drag.captured) {
        scroller.setPointerCapture(e.pointerId);
        drag.captured = true;
        scroller.classList.add('is-dragging');
      }
    }

    if (drag.moved && scrollerRef.current) {
      e.preventDefault();
      const now = performance.now();
      const dt = now - drag.lastTime;
      if (dt > 0) {
        const instantVelocity = (drag.lastX - e.clientX) / dt;
        drag.velocity = 0.7 * instantVelocity + 0.3 * drag.velocity;
      }
      drag.lastX = e.clientX;
      drag.lastTime = now;

      const scroller = scrollerRef.current;
      let newScrollLeft = drag.startScrollLeft - delta;
      const sw = getSingleWidth();
      if (sw > 0) {
        if (newScrollLeft < sw * 0.5) {
          newScrollLeft += sw;
          drag.startScrollLeft += sw;
        } else if (newScrollLeft > sw * 1.5) {
          newScrollLeft -= sw;
          drag.startScrollLeft -= sw;
        }
      }
      scroller.scrollLeft = newScrollLeft;
    }
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    if (!drag.isDown) return;
    drag.isDown = false;

    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.classList.remove('is-dragging');
      if (drag.captured && e?.pointerId != null && scroller.hasPointerCapture?.(e.pointerId)) {
        scroller.releasePointerCapture(e.pointerId);
      }
    }
    drag.captured = false;

    if (drag.moved) {
      drag.moveResetTimeout = setTimeout(() => {
        drag.moved = false;
      }, 60);

      const timeSinceMove = performance.now() - drag.lastTime;
      if (timeSinceMove < 80 && Math.abs(drag.velocity) > 0.1 && scroller) {
        let vel = drag.velocity;
        const glide = () => {
          vel *= 0.94;
          if (scrollerRef.current) {
            const sw = getSingleWidth();
            let sl = scrollerRef.current.scrollLeft + vel * 16;
            if (sw > 0) {
              if (sl < sw * 0.5) sl += sw;
              else if (sl > sw * 1.5) sl -= sw;
            }
            scrollerRef.current.scrollLeft = sl;
          }
          if (Math.abs(vel) > 0.05) {
            drag.momentumRaf = requestAnimationFrame(glide);
          } else {
            drag.momentumRaf = null;
          }
        };
        drag.momentumRaf = requestAnimationFrame(glide);
      }
    }
  };

  const handleScroll = () => {
    const sw = getSingleWidth();
    if (sw <= 0) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollLeft < sw * 0.5) {
      scroller.scrollLeft += sw;
      if (dragRef.current.isDown) dragRef.current.startScrollLeft += sw;
    } else if (scroller.scrollLeft > sw * 1.5) {
      scroller.scrollLeft -= sw;
      if (dragRef.current.isDown) dragRef.current.startScrollLeft -= sw;
    }
  };

  const handlePick = (starter) => {
    if (dragRef.current.moved) return;
    onPick(starter);
  };

  const renderCard = (starter, index) => {
    const IconComponent = starter.icon || Sparkles;
    const theme = getColorClasses(starter.color);
    const isPrimarySet = index >= ideas.length && index < ideas.length * 2;

    return (
      <button
        key={`${starter.title}-${index}`}
        type="button"
        draggable={false}
        tabIndex={isPrimarySet ? 0 : -1}
        aria-hidden={!isPrimarySet}
        onClick={() => handlePick(starter)}
        title={`${starter.title} — ${starter.prompt}`}
        className="starter-pop-card group relative shrink-0 flex items-center gap-2.5 text-left pl-3 pr-4 py-2.5 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 select-none"
      >
        <div className={`shrink-0 w-9 h-9 rounded-[0.65rem] flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.06] ${theme.tile}`}>
          <IconComponent size={18} strokeWidth={2.1} />
        </div>

        <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors leading-snug tracking-tight whitespace-nowrap">
          {starter.title}
        </h4>
      </button>
    );
  };

  return (
    <div
      ref={scrollerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onScroll={handleScroll}
      onDragStart={(e) => e.preventDefault()}
      onMouseEnter={() => { autoPausedRef.current = true; }}
      onMouseLeave={() => { autoPausedRef.current = false; }}
      className="starter-row overflow-x-auto py-0.5 cursor-grab active:cursor-grabbing select-none"
    >
      <div ref={trackRef} className="flex gap-2 w-max">
        {tripleIdeas.map((starter, i) => renderCard(starter, i))}
      </div>
    </div>
  );
}

export default function StarterIdeas({ ideas, onPick }) {
  const shuffledIdeas = useMemo(() => shuffle(ideas), [ideas]);

  const rows = useMemo(() => {
    return [0, 1, 2].map((rowIndex) => {
      return shuffledIdeas.filter((_, i) => i % 3 === rowIndex);
    });
  }, [shuffledIdeas]);

  return (
    <div className="space-y-3 animate-fade-in hidden [@media(min-height:720px)]:block" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="w-1.5 h-4 rounded-full bg-indigo-600 dark:bg-indigo-400" />
        <h3 className="font-mono text-xs font-black uppercase tracking-[0.14em] text-slate-900 dark:text-white">
          Starter ideas
        </h3>
      </div>

      <div className="starter-carousel flex flex-col gap-2 -mx-1 px-1 py-1 select-none overflow-hidden">
        {rows.map((rowIdeas, rowIndex) => (
          <StarterRow
            key={rowIndex}
            ideas={rowIdeas}
            rowIndex={rowIndex}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}
