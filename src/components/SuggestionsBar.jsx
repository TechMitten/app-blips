import { Sparkles, RefreshCw, ChevronRight, Plus } from 'lucide-react';

// Collapsible contextual-suggestion chips above the prompt input. Rendered by
// BuildPanel only when code exists, the mode is 'build', and something is
// loading or loaded.
export default function SuggestionsBar({
  suggestions,
  isLoading,
  isExpanded,
  setIsExpanded,
  onRefresh,
  onPick,
}) {
  return (
    <div className="mb-2 animate-fade-in">
      <div className="flex items-center justify-between px-0.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          aria-controls="suggestions-content"
          aria-label={isExpanded ? 'Collapse suggestions' : 'Expand suggestions'}
          className="group/toggle inline-flex items-center gap-1.5 rounded-lg py-0.5 px-1 -ml-1 text-xs font-bold text-slate-500 hover:text-indigo-600 uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface cursor-pointer select-none"
        >
          <span className="suggestion-spark" aria-hidden="true">
            <Sparkles size={13} />
          </span>
          <span className="font-mono uppercase tracking-[0.14em]">Suggestions</span>
          {suggestions.length > 0 && (
            <span
              className={`inline-flex items-center transition-all duration-200 overflow-hidden ${
                isExpanded ? 'max-w-0 opacity-0 -ml-1' : 'max-w-[36px] opacity-100'
              }`}
            >
              <span className="px-1.5 py-0.5 rounded-full text-[10px] tracking-normal font-semibold bg-slate-100 text-slate-500 group-hover/toggle:bg-indigo-50 group-hover/toggle:text-indigo-600 transition-colors">
                {suggestions.length}
              </span>
            </span>
          )}
          <ChevronRight
            size={13}
            className={`transition-transform duration-200 text-slate-400 group-hover/toggle:text-indigo-600 ${
              isExpanded ? 'rotate-90 text-indigo-600' : ''
            }`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Regenerate suggestions"
          className="group/refresh inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-400 hover:text-indigo-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : 'transition-transform duration-500 group-hover/refresh:rotate-180'} />
          <span>New</span>
        </button>
      </div>
      <div
        id="suggestions-content"
        className={`suggestions-collapse-wrapper ${isExpanded ? 'is-expanded' : ''}`}
        aria-hidden={!isExpanded}
      >
        <div className="suggestions-collapse-inner">
          <div className="pt-2 pb-0.5 flex flex-wrap gap-2">
            {suggestions.length > 0 ? (
              suggestions.map((suggestion, idx) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onPick(suggestion)}
                  tabIndex={isExpanded ? 0 : -1}
                  className={`suggestion-chip group inline-flex items-center gap-2 text-left pl-2 pr-3.5 py-1.5 text-xs sm:text-sm leading-snug font-medium rounded-xl border border-slate-200 bg-surface text-slate-800 shadow-2xs transition-all hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-800 animate-stagger-${Math.min(idx + 1, 5)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
                >
                  <span className="suggestion-chip-icon shrink-0" aria-hidden="true">
                    <Plus size={13} strokeWidth={2.5} />
                  </span>
                  <span>{suggestion}</span>
                </button>
              ))
            ) : (
              [0, 1, 2, 3].map((idx) => (
                <span key={idx} className="suggestion-skeleton h-8 rounded-xl w-[46%]" aria-hidden="true" />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
