import { useMemo, useRef } from 'react';
import { Sparkles } from 'lucide-react';

// Drag-to-scroll threshold (px) below which a mouse interaction still
// counts as a click rather than a pan, so picking a card stays reliable.
const DRAG_CLICK_THRESHOLD = 5;

const getColorClasses = (colorString = '') => {
  if (colorString.includes('amber')) {
    return {
      bg: 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md shadow-amber-500/25',
      glow: 'bg-amber-500',
    };
  }
  if (colorString.includes('sky')) {
    return {
      bg: 'bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/25',
      glow: 'bg-sky-500',
    };
  }
  if (colorString.includes('emerald')) {
    return {
      bg: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-500/25',
      glow: 'bg-emerald-500',
    };
  }
  if (colorString.includes('violet')) {
    return {
      bg: 'bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-md shadow-violet-500/25',
      glow: 'bg-violet-500',
    };
  }
  if (colorString.includes('rose')) {
    return {
      bg: 'bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-md shadow-rose-500/25',
      glow: 'bg-rose-500',
    };
  }
  if (colorString.includes('blue')) {
    return {
      bg: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25',
      glow: 'bg-blue-500',
    };
  }
  if (colorString.includes('teal')) {
    return {
      bg: 'bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-md shadow-teal-500/25',
      glow: 'bg-teal-500',
    };
  }
  return {
    bg: 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/25',
    glow: 'bg-indigo-500',
  };
};

const shuffle = (items) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Empty-state idea cards (presets). This component mounts fresh each time
// showStarterIdeas flips true (new/empty project), so shuffling once on
// mount re-randomizes the order every time it's shown.
export default function StarterIdeas({ ideas, onPick }) {
  const shuffledIdeas = useMemo(() => shuffle(ideas), [ideas]);
  const scrollerRef = useRef(null);
  const dragRef = useRef({ isDown: false, startX: 0, startScrollLeft: 0, moved: false, pendingDelta: 0, rafId: null });

  const applyPendingScroll = () => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    drag.rafId = null;
    if (scroller) scroller.scrollLeft = drag.startScrollLeft - drag.pendingDelta;
  };

  const handlePointerDown = (e) => {
    // Touch/pen already get native drag-scroll from overflow-x-auto; only
    // take over panning for mouse so we don't fight the browser's own
    // momentum scrolling on touch devices.
    if (e.pointerType !== 'mouse') return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.setPointerCapture(e.pointerId);
    dragRef.current = { isDown: true, startX: e.clientX, startScrollLeft: scroller.scrollLeft, moved: false, pendingDelta: 0, rafId: null };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.isDown) return;
    const delta = e.clientX - drag.startX;
    if (Math.abs(delta) > DRAG_CLICK_THRESHOLD) {
      drag.moved = true;
      if (scrollerRef.current) scrollerRef.current.classList.add('is-dragging');
    }
    if (drag.moved) {
      e.preventDefault();
      drag.pendingDelta = delta;
      if (drag.rafId == null) drag.rafId = requestAnimationFrame(applyPendingScroll);
    }
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (drag.rafId != null) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }
    drag.isDown = false;
    if (scroller) {
      scroller.classList.remove('is-dragging');
      if (e?.pointerId != null && scroller.hasPointerCapture?.(e.pointerId)) {
        scroller.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handlePick = (starter) => {
    // Swallow the click that follows a drag-release so panning the
    // carousel doesn't also fire the card underneath the cursor.
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    onPick(starter);
  };

  return (
    <div className="space-y-3 animate-fade-in hidden [@media(min-height:720px)]:block" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="w-1.5 h-4 rounded-full bg-indigo-600 dark:bg-indigo-400" />
        <h3 className="font-mono text-xs font-black uppercase tracking-[0.14em] text-slate-900 dark:text-white">
          Starter ideas
        </h3>
      </div>

      <div
        ref={scrollerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="starter-carousel flex flex-col gap-2 overflow-x-auto -mx-0.5 px-0.5 py-0.5 cursor-grab active:cursor-grabbing select-none"
      >
        {[0, 1, 2].map(rowIndex => (
          <div key={rowIndex} className={`flex gap-2 w-max ${rowIndex === 1 ? 'ml-12' : ''}`}>
            {shuffledIdeas.filter((_, i) => i % 3 === rowIndex).map((starter) => {
              const IconComponent = starter.icon || Sparkles;
              const theme = getColorClasses(starter.color);
              return (
                <button
                  key={starter.title}
                  type="button"
                  draggable={false}
                  onClick={() => handlePick(starter)}
                  title={`${starter.title} — ${starter.prompt}`}
                  className="starter-pop-card group relative shrink-0 flex items-center gap-2.5 text-left pl-3 pr-4 py-2.5 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 select-none"
                >
                  {/* Subtle ambient colored corner glow on hover */}
                  <div
                    className={`absolute -right-4 -top-4 w-16 h-16 rounded-full blur-lg opacity-0 group-hover:opacity-30 dark:group-hover:opacity-20 transition-opacity duration-300 pointer-events-none ${theme.glow}`}
                    aria-hidden="true"
                  />

                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold ${theme.bg} shadow-xs transition-transform duration-200 group-hover:scale-105`}>
                    <IconComponent size={15} strokeWidth={2.2} />
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug tracking-tight whitespace-nowrap">
                    {starter.title}
                  </h4>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
