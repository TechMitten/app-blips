import { Sparkles, ArrowUpRight } from 'lucide-react';

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

// Empty-state idea cards (presets).
export default function StarterIdeas({ ideas, onPick }) {
  return (
    <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full bg-indigo-600 dark:bg-indigo-400" />
          <h3 className="font-mono text-xs font-black uppercase tracking-[0.14em] text-slate-900 dark:text-white">
            Starter ideas
          </h3>
        </div>
        <span className="starter-templates-badge text-[10px] font-mono font-black px-2.5 py-0.5 rounded-full shadow-2xs">
          Templates
        </span>
      </div>

      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-2.5">
        {ideas.slice(0, 4).map((starter) => {
          const IconComponent = starter.icon || Sparkles;
          const theme = getColorClasses(starter.color);
          return (
            <button
              key={starter.title}
              type="button"
              onClick={() => onPick(starter)}
              title={`${starter.title} — ${starter.prompt}`}
              className="starter-pop-card group relative flex items-center gap-3 text-left p-2.5 sm:p-3 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20"
            >
              {/* Subtle ambient colored corner glow on hover */}
              <div
                className={`absolute -right-6 -top-6 w-20 h-20 rounded-full blur-xl opacity-0 group-hover:opacity-30 dark:group-hover:opacity-20 transition-opacity duration-300 pointer-events-none ${theme.glow}`}
                aria-hidden="true"
              />

              <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center font-bold ${theme.bg} shadow-xs transition-transform duration-200 group-hover:scale-105`}>
                <IconComponent size={15} strokeWidth={2.2} />
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug tracking-tight">
                  {starter.title}
                </h4>
              </div>

              <span
                aria-hidden="true"
                className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/10 text-slate-400 dark:text-white/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 group-hover:border-indigo-300 dark:group-hover:border-indigo-500/40 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/20 transition-all duration-150 shadow-2xs"
              >
                <ArrowUpRight
                  size={12}
                  strokeWidth={2.5}
                  className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-150"
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
