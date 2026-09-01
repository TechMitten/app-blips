import { RefreshCw, Plus } from 'lucide-react';

// Empty-state idea cards (LLM-generated when refreshed, presets otherwise).
export default function StarterIdeas({ ideas, isGenerating, onRefresh, onPick }) {
  return (
    <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-indigo-500" aria-hidden="true" />
          <h3 className="text-xs 2xl:text-sm font-bold text-slate-500 uppercase tracking-[0.2em]">
            Starter Ideas
          </h3>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isGenerating}
          className="group inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs 2xl:text-sm font-semibold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Generate new starter ideas"
        >
          <RefreshCw size={13} className={`transition-transform duration-500 text-slate-400 group-hover:text-indigo-600 ${isGenerating ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
          <span>{isGenerating ? 'Generating...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 xl:gap-3 2xl:gap-3.5">
        {ideas.map((starter) => {
          const IconComponent = starter.icon;
          return (
            <button
              key={starter.title}
              onClick={() => onPick(starter)}
              className="group flex flex-col justify-between text-left p-3 xl:p-3.5 2xl:p-4 bg-slate-50/80 hover:bg-surface border border-slate-200/90 hover:border-indigo-300 rounded-xl xl:rounded-2xl transition-all hover:shadow-premium-md suggestion-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <div className="flex items-center justify-between w-full mb-2">
                <div className={`w-7 h-7 2xl:w-8 2xl:h-8 rounded-lg 2xl:rounded-xl flex items-center justify-center ${starter.color} border border-black/5 dark:border-white/10 shadow-2xs`}>
                  <IconComponent size={15} />
                </div>
                <span className="text-[10px] 2xl:text-xs font-bold text-slate-500 uppercase tracking-wider bg-surface px-1.5 py-0.5 rounded-md border border-slate-200/80">
                  {starter.category}
                </span>
              </div>
              <div className="text-sm sm:text-base font-bold text-slate-800 group-hover:text-indigo-600 transition-colors mb-0.5">
                {starter.title}
              </div>
              <p className="text-xs sm:text-sm text-slate-500 leading-snug">
                {starter.prompt}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
