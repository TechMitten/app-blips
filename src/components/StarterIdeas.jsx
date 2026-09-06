import { RefreshCw, Sparkles, ArrowUpRight } from 'lucide-react';

const getColorClasses = (colorString = '') => {
  if (colorString.includes('amber')) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-500/10',
      border: 'border-amber-200/70 dark:border-amber-500/25',
      text: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (colorString.includes('sky')) {
    return {
      bg: 'bg-sky-50 dark:bg-sky-500/10',
      border: 'border-sky-200/70 dark:border-sky-500/25',
      text: 'text-sky-600 dark:text-sky-400',
    };
  }
  if (colorString.includes('emerald')) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-500/10',
      border: 'border-emerald-200/70 dark:border-emerald-500/25',
      text: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (colorString.includes('violet')) {
    return {
      bg: 'bg-violet-50 dark:bg-violet-500/10',
      border: 'border-violet-200/70 dark:border-violet-500/25',
      text: 'text-violet-600 dark:text-violet-400',
    };
  }
  if (colorString.includes('rose')) {
    return {
      bg: 'bg-rose-50 dark:bg-rose-500/10',
      border: 'border-rose-200/70 dark:border-rose-500/25',
      text: 'text-rose-600 dark:text-rose-400',
    };
  }
  if (colorString.includes('blue')) {
    return {
      bg: 'bg-blue-50 dark:bg-blue-500/10',
      border: 'border-blue-200/70 dark:border-blue-500/25',
      text: 'text-blue-600 dark:text-blue-400',
    };
  }
  if (colorString.includes('teal')) {
    return {
      bg: 'bg-teal-50 dark:bg-teal-500/10',
      border: 'border-teal-200/70 dark:border-teal-500/25',
      text: 'text-teal-600 dark:text-teal-400',
    };
  }
  return {
    bg: 'bg-indigo-50 dark:bg-indigo-500/10',
    border: 'border-indigo-200/70 dark:border-indigo-500/25',
    text: 'text-indigo-600 dark:text-indigo-400',
  };
};

// Empty-state idea cards (LLM-generated when refreshed, presets otherwise).
export default function StarterIdeas({ ideas, isGenerating, onRefresh, onPick }) {
  return (
    <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Starter ideas
          </h3>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isGenerating}
          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Generate new starter ideas"
        >
          <RefreshCw
            size={12}
            className={`transition-transform duration-500 ${isGenerating ? 'animate-spin text-indigo-600 dark:text-indigo-400' : 'group-hover:rotate-180'}`}
          />
          <span>{isGenerating ? 'Generating...' : 'Refresh'}</span>
        </button>
      </div>

      <div className={`grid grid-cols-2 gap-2.5 transition-opacity duration-200 ${isGenerating ? 'opacity-60 pointer-events-none' : ''}`}>
        {ideas.slice(0, 6).map((starter) => {
          const IconComponent = starter.icon || Sparkles;
          const theme = getColorClasses(starter.color);
          return (
            <button
              key={starter.title}
              type="button"
              onClick={() => onPick(starter)}
              title={`${starter.title} — ${starter.prompt}`}
              className="group relative flex flex-col justify-between text-left p-2.5 sm:p-3 rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden
                bg-white/80 dark:bg-white/[0.04]
                hover:bg-white dark:hover:bg-white/[0.08]
                border-slate-200/90 dark:border-white/10
                hover:border-indigo-300 dark:hover:border-indigo-500/50
                shadow-2xs hover:shadow-md hover:shadow-indigo-500/5
                hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {/* Ambient hover gradient wash */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-indigo-500/5 dark:to-indigo-500/15 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

              <div className="relative z-10 flex flex-col h-full justify-between w-full">
                <div>
                  <div className="flex items-center justify-between gap-1.5 mb-2">
                    <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border ${theme.bg} ${theme.border} ${theme.text} transition-transform duration-200 group-hover:scale-105 shadow-2xs`}>
                      <IconComponent size={14} />
                    </div>

                    <div className="flex items-center gap-1 min-w-0">
                      {starter.category && (
                        <span className="text-[9.5px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100/90 dark:bg-white/[0.08] text-slate-700 dark:text-white/80 border border-slate-200/80 dark:border-white/10 truncate max-w-[85px]">
                          {starter.category}
                        </span>
                      )}
                      <ArrowUpRight
                        size={12}
                        aria-hidden="true"
                        className="shrink-0 text-slate-400 dark:text-white/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all opacity-0 group-hover:opacity-100 duration-150"
                      />
                    </div>
                  </div>

                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug line-clamp-2">
                    {starter.title}
                  </h4>

                  {starter.prompt && (
                    <p className="text-[11px] text-slate-700 dark:text-white/75 line-clamp-2 leading-relaxed mt-1 font-medium group-hover:text-slate-950 dark:group-hover:text-white transition-colors">
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
