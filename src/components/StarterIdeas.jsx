import { Sparkles, ArrowUpRight } from 'lucide-react';

const getColorClasses = (colorString = '') => {
  if (colorString.includes('amber')) {
    return {
      bg: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
      badge: 'starter-badge-amber',
      hoverBorder: 'hover:border-amber-500 dark:hover:border-amber-400 hover:shadow-amber-500/10',
    };
  }
  if (colorString.includes('sky')) {
    return {
      bg: 'bg-sky-500 text-white shadow-sm shadow-sky-500/30',
      badge: 'starter-badge-sky',
      hoverBorder: 'hover:border-sky-500 dark:hover:border-sky-400 hover:shadow-sky-500/10',
    };
  }
  if (colorString.includes('emerald')) {
    return {
      bg: 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30',
      badge: 'starter-badge-emerald',
      hoverBorder: 'hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-emerald-500/10',
    };
  }
  if (colorString.includes('violet')) {
    return {
      bg: 'bg-violet-600 text-white shadow-sm shadow-violet-500/30',
      badge: 'starter-badge-violet',
      hoverBorder: 'hover:border-violet-500 dark:hover:border-violet-400 hover:shadow-violet-500/10',
    };
  }
  if (colorString.includes('rose')) {
    return {
      bg: 'bg-rose-500 text-white shadow-sm shadow-rose-500/30',
      badge: 'starter-badge-rose',
      hoverBorder: 'hover:border-rose-500 dark:hover:border-rose-400 hover:shadow-rose-500/10',
    };
  }
  if (colorString.includes('blue')) {
    return {
      bg: 'bg-blue-600 text-white shadow-sm shadow-blue-500/30',
      badge: 'starter-badge-blue',
      hoverBorder: 'hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-blue-500/10',
    };
  }
  if (colorString.includes('teal')) {
    return {
      bg: 'bg-teal-500 text-white shadow-sm shadow-teal-500/30',
      badge: 'starter-badge-teal',
      hoverBorder: 'hover:border-teal-500 dark:hover:border-teal-400 hover:shadow-teal-500/10',
    };
  }
  return {
    bg: 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30',
    badge: 'starter-badge-indigo',
    hoverBorder: 'hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-indigo-500/10',
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

      <div className="grid grid-cols-2 gap-3">
        {ideas.slice(0, 4).map((starter) => {
          const IconComponent = starter.icon || Sparkles;
          const theme = getColorClasses(starter.color);
          return (
            <button
              key={starter.title}
              type="button"
              onClick={() => onPick(starter)}
              title={`${starter.title} — ${starter.prompt}`}
              className="starter-pop-card group relative flex flex-col justify-between text-left p-4 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20"
            >
              <div className="relative z-10 flex flex-col h-full justify-between w-full">
                <div>
                  <div className="flex items-center justify-between gap-1.5 mb-3">
                    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-bold ${theme.bg} border-b-2 border-black/25 shadow-md transition-transform duration-200 group-hover:scale-110`}>
                      <IconComponent size={18} strokeWidth={2.5} />
                    </div>

                    <div className="flex items-center gap-1.5 min-w-0">
                      {starter.category && (
                        <span className={`text-[10px] font-mono font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md border-b-2 shadow-xs truncate max-w-[95px] ${theme.badge}`}>
                          {starter.category}
                        </span>
                      )}
                      <ArrowUpRight
                        size={15}
                        aria-hidden="true"
                        className="shrink-0 text-slate-400 dark:text-white/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all opacity-0 group-hover:opacity-100 duration-150"
                      />
                    </div>
                  </div>

                  <h4 className="text-sm font-black text-slate-950 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug line-clamp-1">
                    {starter.title}
                  </h4>

                  {starter.prompt && (
                    <p className="starter-card-desc text-xs line-clamp-2 leading-relaxed mt-1.5 font-medium transition-colors">
                      {starter.prompt}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
