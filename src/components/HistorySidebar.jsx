import { PanelLeftClose, PanelLeftOpen, History, Clock, ChevronRight, Play, Copy, Download } from 'lucide-react';

// Version-history drawer with its collapse tab. Rendered as a fragment: the
// tab sits in the flex row next to the sidebar when the sidebar is closed.
export default function HistorySidebar({
  isOpen,
  versions,
  currentVersionIndex,
  expandedVersionIndex,
  onToggleExpand,
  onSwitchVersion,
  onCopyVersion,
  onDownloadVersion,
  onExpand,
  onCollapse,
}) {
  return (
    <>
      {/* Collapse toggle tab — visible only when sidebar is closed */}
      {!isOpen && (
        <button
          onClick={onExpand}
          className="hidden md:flex items-center justify-center w-7 2xl:w-8 bg-surface border-y border-r border-slate-300 rounded-r-lg shadow-sm hover:bg-slate-50 hover:text-indigo-600 transition-all duration-200 z-20 flex-shrink-0 -ml-px group"
          title="Show history panel"
        >
          <PanelLeftOpen size={16} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
        </button>
      )}
      {/* History Sidebar */}
      <aside className={`hidden md:flex flex-col z-10 transition-all duration-300 ease-out relative history-bg noise-texture border-r border-slate-300/80 panel-edge-right ${
        isOpen ? 'w-80 lg:w-[340px] xl:w-[380px] 2xl:w-[420px]' : 'w-0 min-w-0 border-r-0 overflow-hidden opacity-0'
      }`}>
        {/* Header */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between history-header-bg border-b border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onCollapse}
              className="text-slate-400 hover:text-slate-700 hover:bg-surface p-1.5 rounded-lg border border-transparent hover:border-slate-200 transition-all duration-200 flex-shrink-0"
              title="Hide history panel"
            >
              <PanelLeftClose size={16} />
            </button>
            <div className="h-7 w-7 2xl:h-8 2xl:w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-200/80 shadow-2xs">
              <History size={15} />
            </div>
            <h2 className="text-sm 2xl:text-base font-bold text-slate-900 whitespace-nowrap tracking-tight">
              History
            </h2>
          </div>
          {versions.length > 0 && (
            <span className="text-[11px] 2xl:text-xs font-bold text-slate-700 bg-surface px-2.5 py-0.5 rounded-full border border-slate-300/80 shadow-2xs">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Version List */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3.5 space-y-0 chat-scrollbar relative z-[1]">
          {versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 2xl:w-20 2xl:h-20 rounded-2xl bg-surface flex items-center justify-center border border-slate-200/90 shadow-sm">
                  <div className="w-9 h-9 2xl:w-11 2xl:h-11 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                    <Clock size={20} />
                  </div>
                </div>
                <div className="absolute inset-0 rounded-2xl animate-pulse pulse-ring" />
              </div>
              <h3 className="text-slate-800 font-bold text-sm 2xl:text-base mb-1">No versions yet</h3>
              <p className="text-slate-500 text-xs 2xl:text-sm leading-relaxed max-w-[15rem]">
                Each build creates a version snapshot you can inspect or restore anytime.
              </p>
            </div>
          ) : (
            <div className="relative pl-6">
              {/* Timeline line */}
              <div className="absolute left-[14px] top-2 bottom-2 w-[2px] bg-slate-300/90 rounded-full" />
              {[...versions].reverse().map((ver, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isActive = currentVersionIndex === idx;
                const isExpanded = expandedVersionIndex === idx;
                return (
                  <div key={ver.id} className="relative mb-2 animate-fade-in" style={{ animationDelay: `${reversedIdx * 40}ms` }}>
                    {/* Timeline dot */}
                    <div className={`absolute z-[2] transition-all duration-300 ${
                      isActive
                        ? '-left-[20px] top-[13px] w-[12px] h-[12px] rounded-full bg-indigo-600 border-2 border-surface ring-4 ring-indigo-200/70 shadow-sm'
                        : '-left-[19px] top-[14px] w-[10px] h-[10px] rounded-full bg-slate-300 border-2 border-surface ring-1 ring-slate-400/40'
                    }`} />

                    {/* Version card */}
                    <div
                      onClick={() => onToggleExpand(idx)}
                      className={`relative cursor-pointer rounded-xl transition-all duration-200 overflow-hidden ${
                        isActive
                          ? 'bg-surface border-2 border-indigo-600 active-version-glow shadow-sm'
                          : 'bg-surface border border-slate-200/90 hover:border-slate-300 hover:shadow-sm shadow-2xs group'
                      }`}
                    >
                      <div className="px-3.5 py-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Version badge */}
                          <div className={`shrink-0 h-[22px] min-w-[38px] px-2 rounded-md flex items-center justify-center text-[10px] font-bold tracking-wide transition-all duration-200 ${
                            isActive
                              ? 'brand-fill-text bg-brand text-white shadow-xs shadow-indigo-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200 group-hover:bg-slate-200'
                          }`}>
                            v{idx + 1}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span className={`block text-[13px] 2xl:text-[14px] leading-[1.35] transition-colors truncate ${
                                isActive ? 'text-slate-900 font-bold' : 'text-slate-800 font-medium group-hover:text-slate-900'
                              }`}>
                                {ver.prompt}
                              </span>
                              {idx === 0 && (
                                <span className="shrink-0 text-[8px] 2xl:text-[9px] font-bold px-1.5 py-[2px] rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider mt-0.5">
                                  Initial
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] 2xl:text-[11px] font-medium">
                              <span className={isActive ? 'text-indigo-600 font-semibold' : 'text-slate-500'}>
                                {ver.timestamp}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 px-1.5 py-[2px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] 2xl:text-[10px] font-bold uppercase tracking-wider">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                                  Active
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight
                            size={14}
                            className={`shrink-0 mt-1 transition-all duration-200 ${
                              isExpanded ? 'rotate-90 text-indigo-600' : isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="mt-2 ml-2 mr-0 mb-2 version-expand-enter">
                        <div className="bg-surface border border-slate-200/90 rounded-xl p-4 shadow-premium-md">
                          <div className="space-y-4">
                            {/* Prompt */}
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-1.5 h-3 rounded-full bg-indigo-500" />
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">Prompt</span>
                              </div>
                              <div className="text-[13px] 2xl:text-[14px] text-slate-800 font-medium leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                                {ver.prompt}
                              </div>
                            </div>

                            {/* Metadata */}
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-slate-200">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.10em]">Modified</span>
                                <span className="text-xs text-slate-700 font-semibold mt-0.5">{ver.timestamp}</span>
                              </div>
                              {ver.editSummary && (
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.10em]">Summary</span>
                                  <span className="text-xs text-slate-700 font-semibold mt-0.5 truncate">{ver.editSummary}</span>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); onSwitchVersion(idx); }}
                                className="btn-premium btn-premium-primary py-2 text-xs font-semibold"
                              >
                                <Play size={13} />
                                Restore
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onCopyVersion(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs font-semibold hover:border-slate-300"
                              >
                                <Copy size={13} />
                                Copy
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDownloadVersion(ver); }}
                                className="btn-premium btn-premium-secondary py-2 text-xs font-semibold hover:border-slate-300"
                              >
                                <Download size={13} />
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
