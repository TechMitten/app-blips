import { RefreshCw, Plus } from 'lucide-react';
// Empty-state idea cards (LLM-generated when refreshed, presets otherwise).
export default function StarterIdeas({ ideas, isGenerating, onRefresh, onPick }) {
  return (
    <div className="space-y-3 animate-fade-in @container" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] @2xl:text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Starter ideas
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isGenerating}
          className="group inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs @2xl:text-sm font-semibold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Generate new starter ideas"
        >
          <RefreshCw size={13} className={`transition-transform duration-500 text-slate-400 group-hover:text-indigo-600 ${isGenerating ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
          <span>{isGenerating ? 'Generating...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2.5 @xl:gap-3 @2xl:gap-3.5">
        {ideas.map((starter) => {
          const IconComponent = starter.icon;
          return (
            <button
              key={starter.title}
              onClick={() => onPick(starter)}
              className="group flex items-center gap-3 @2xl:gap-3.5 text-left p-3 @xl:p-3.5 bg-slate-50/80 hover:bg-surface border border-slate-200/90 hover:border-indigo-300 rounded-xl @xl:rounded-2xl transition-all hover:shadow-premium-md suggestion-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <div className={`shrink-0 w-9 h-9 2xl:w-10 2xl:h-10 rounded-lg 2xl:rounded-xl flex items-center justify-center ${starter.color} border border-black/5 dark:border-white/10 shadow-2xs transition-transform duration-200 group-hover:scale-105`}>
                <IconComponent size={17} />
              </div>
              <div className="flex-1 text-sm font-bold text-slate-800 group-hover:text-indigo-600 transition-colors leading-snug text-balance">
                {starter.title}
              </div>
              <Plus
                size={16}
                strokeWidth={2.4}
                aria-hidden="true"
                className="shrink-0 text-indigo-500 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
