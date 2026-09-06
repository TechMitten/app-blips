import { RefreshCw, Plus, Sparkles } from 'lucide-react';
// Empty-state idea cards (LLM-generated when refreshed, presets otherwise).
export default function StarterIdeas({ ideas, isGenerating, onRefresh, onPick }) {
  return (
    <div className="space-y-2.5 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Starter ideas
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isGenerating}
          className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Generate new starter ideas"
        >
          <RefreshCw size={12} className={`transition-transform duration-500 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 ${isGenerating ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
          <span>{isGenerating ? 'Generating...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ideas.slice(0, 6).map((starter) => {
          const IconComponent = starter.icon || Sparkles;
          return (
            <button
              key={starter.title}
              onClick={() => onPick(starter)}
              title={`${starter.title} — ${starter.prompt}`}
              className="group relative flex items-center gap-2.5 text-left p-2.5 bg-slate-100/70 hover:bg-slate-200/60 border border-slate-200 hover:border-indigo-400/50 rounded-xl transition-all shadow-2xs hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer min-h-[50px]"
            >
              <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${starter.color}`}>
                <IconComponent size={14} />
              </div>
              <div className="flex-1 text-xs font-semibold text-slate-800 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug text-balance break-words">
                {starter.title}
              </div>
              <Plus
                size={13}
                strokeWidth={2.4}
                aria-hidden="true"
                className="shrink-0 text-indigo-500 opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
