import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

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

// Row rotation configurations: each row moves individually in alternating directions
// with distinct speeds and phase offsets so they never feel synchronized.
const ROW_CONFIGS = [
  { direction: 'normal', duration: '34s', delay: '0s' },
  { direction: 'reverse', duration: '38s', delay: '-6s' },
  { direction: 'normal', duration: '30s', delay: '-14s' },
];

const getRowConfig = (rowIndex) => {
  if (ROW_CONFIGS[rowIndex]) return ROW_CONFIGS[rowIndex];
  return {
    direction: rowIndex % 2 === 1 ? 'reverse' : 'normal',
    duration: `${32 + (rowIndex * 4) % 10}s`,
    delay: `-${(rowIndex * 7) % 20}s`,
  };
};

// Empty-state idea cards (presets). Shuffling once on mount re-randomizes
// the order every time it's shown. Each row rotates continuously in its
// own direction, pausing on hover so the user can easily read and pick an idea.
export default function StarterIdeas({ ideas, onPick }) {
  const shuffledIdeas = useMemo(() => shuffle(ideas), [ideas]);

  const rows = useMemo(() => {
    return [0, 1, 2].map((rowIndex) => {
      const items = shuffledIdeas.filter((_, i) => i % 3 === rowIndex);
      // Ensure each copy has enough cards to span beyond wide viewports before looping
      let extended = [...items];
      while (extended.length > 0 && extended.length < 8) {
        extended = [...extended, ...items];
      }
      return extended;
    });
  }, [shuffledIdeas]);

  const renderCard = (starter, key, isDuplicate = false) => {
    const IconComponent = starter.icon || Sparkles;
    const theme = getColorClasses(starter.color);
    return (
      <button
        key={key}
        type="button"
        draggable={false}
        tabIndex={isDuplicate ? -1 : 0}
        onClick={() => onPick(starter)}
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
  };

  return (
    <div className="space-y-3 animate-fade-in hidden [@media(min-height:720px)]:block" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="w-1.5 h-4 rounded-full bg-indigo-600 dark:bg-indigo-400" />
        <h3 className="font-mono text-xs font-black uppercase tracking-[0.14em] text-slate-900 dark:text-white">
          Starter ideas
        </h3>
      </div>

      <div className="starter-carousel flex flex-col gap-2 -mx-1 px-1 py-1 select-none overflow-hidden">
        {rows.map((rowIdeas, rowIndex) => {
          const config = getRowConfig(rowIndex);
          return (
            <div
              key={rowIndex}
              className="starter-row relative overflow-hidden py-1"
            >
              <div
                className="starter-track flex w-max items-center"
                style={{
                  animationDuration: config.duration,
                  animationDirection: config.direction,
                  animationDelay: config.delay,
                }}
              >
                {/* Primary copy */}
                <div className="flex shrink-0 items-center gap-2 pr-2">
                  {rowIdeas.map((starter, i) => renderCard(starter, `row-${rowIndex}-c1-${i}`, false))}
                </div>
                {/* Loop copy for seamless rotation */}
                <div className="flex shrink-0 items-center gap-2 pr-2" aria-hidden="true">
                  {rowIdeas.map((starter, i) => renderCard(starter, `row-${rowIndex}-c2-${i}`, true))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
