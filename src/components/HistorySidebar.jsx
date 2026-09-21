import { useState } from 'react';
import { PanelLeftClose, History, Clock, ChevronRight, RotateCcw } from 'lucide-react';

// One checkpoint row inside a chat-session group. The whole row is a
// one-click restore target. `idx` is the index into the flat `versions`
// array so restores keep working against App's undo/redo state. The
// restore icon doesn't itself restore -- clicking the row already did
// that -- it just closes the history pane so the user can see the result.
function CheckpointCard({ ver, idx, isActive, onSwitchVersion, onCollapse, reversedIdx }) {
  const handleKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSwitchVersion(idx);
    }
  };

  const handleRestoreClick = (e) => {
    e.stopPropagation();
    onSwitchVersion(idx);
    onCollapse();
  };

  return (
    <div className="relative mb-1 animate-fade-in" style={{ animationDelay: `${reversedIdx * 40}ms` }}>
      {/* Timeline dot */}
      <div className={`absolute z-[2] transition-all duration-300 ${
        isActive
          ? '-left-[20px] top-1/2 -translate-y-1/2 w-[12px] h-[12px] rounded-full bg-indigo-600 border-2 border-surface ring-4 ring-indigo-200/70'
          : '-left-[15px] top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-slate-300'
      }`} />

      {/* Version row — click anywhere to restore */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSwitchVersion(idx)}
        onKeyDown={handleKeyDown}
        aria-label={isActive ? `Version ${idx + 1}, currently active` : `Restore version ${idx + 1}`}
        title={isActive ? 'Current version' : 'Click to restore this version'}
        className={`group relative cursor-pointer rounded-xl px-3 py-2 transition-all duration-150 outline-none ${
          isActive
            ? 'bg-surface border-2 border-indigo-600 active-version-glow shadow-sm'
            : 'history-icon-btn bg-slate-200/60 border-2 border-slate-300 shadow-2xs hover:bg-slate-200 hover:border-slate-400 hover:shadow-sm focus-visible:border-indigo-400'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Prompt + meta */}
          <div className="flex-1 min-w-0">
            <span className={`block text-[13px] 2xl:text-[14px] leading-[1.35] truncate ${
              isActive ? 'text-slate-900 font-bold' : 'text-slate-700 font-medium'
            }`}>
              {ver.prompt}
            </span>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] 2xl:text-[11px] font-medium min-w-0">
              <span className={`shrink-0 font-mono font-bold ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}>
                v{idx + 1}
              </span>
              {idx === 0 && (
                <span className="shrink-0 text-[8px] 2xl:text-[9px] font-bold px-1.5 py-[1px] rounded-full bg-slate-100 text-slate-500 uppercase tracking-wider">
                  Initial
                </span>
              )}
              <span className={`truncate ${isActive ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                {ver.timestamp}
              </span>
              {isActive && (
                <span className="shrink-0 flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] 2xl:text-[10px] font-bold uppercase tracking-wider">
                  <span className="w-1 h-1 rounded-full bg-indigo-600" />
                  Active
                </span>
              )}
            </div>
          </div>

          {/* Restoring already happens on row click -- this button just
              closes the history pane so the restored app is visible. */}
          <button
            type="button"
            onClick={handleRestoreClick}
            title="Restore and close history"
            aria-label={`Restore version ${idx + 1} and close history`}
            className="history-icon-btn shrink-0 p-1.5 rounded-lg text-slate-400 border border-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-blue-100 hover:border-blue-300 hover:text-blue-600 transition-all duration-150"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// The grouped session list. Rendered with `key={activeSessionIndex}` in the
// parent so it remounts -- resetting collapse overrides to the default (only
// the active session expanded) -- whenever the active checkpoint moves into a
// different session via restore, undo/redo, or a new chat's first build.
function SessionGroups({ chatSessions, versions, activeSessionIndex, currentVersionIndex, onSwitchVersion, onCollapse }) {
  const [collapsedSessions, setCollapsedSessions] = useState(() => ({}));

  const isSessionCollapsed = (session, position) =>
    collapsedSessions[session.id] ?? (position !== activeSessionIndex);

  // Negate the *effective* (default-aware) state, not just the raw stored
  // override -- otherwise the first click on a session that's collapsed only
  // via the default (never explicitly toggled) is a no-op, since !undefined
  // and the default both evaluate to `true`.
  const toggleSession = (session, position) => {
    setCollapsedSessions((prev) => ({
      ...prev,
      [session.id]: !isSessionCollapsed(session, position),
    }));
  };

  return [...chatSessions].reverse().map((session, reversedSessionIdx) => {
    // Position of this session in chronological order.
    const position = chatSessions.length - 1 - reversedSessionIdx;
    const isActiveSession = position === activeSessionIndex;
    const isCollapsed = isSessionCollapsed(session, position);
    const sessionVersions = versions.slice(session.start, session.end + 1);
    // Sessions whose prompts were all sent in ask mode are chats; anything
    // else (including legacy versions with no recorded mode) is a build.
    const isAskSession = sessionVersions.length > 0 && sessionVersions.every((ver) => ver.chatMode === 'ask');
    const sessionLabel = `${isAskSession ? 'Chat' : 'Build'} ${position + 1}`;
    const firstPrompt = sessionVersions[0]?.prompt || 'New chat';
    const checkpointCount = sessionVersions.length;
    const sessionTime = sessionVersions[sessionVersions.length - 1]?.timestamp;
    return (
      <section
        key={session.id ?? `session-${session.start}`}
        className="mb-4 animate-fade-in"
        style={{ animationDelay: `${reversedSessionIdx * 40}ms` }}
        aria-label={`${isAskSession ? 'Chat' : 'Build'} session ${position + 1}`}
      >
        {/* Session header — quiet label row, not a card */}
        <div
          onClick={() => toggleSession(session, position)}
          className="group cursor-pointer flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-slate-100/70 transition-colors min-w-0"
          title={isCollapsed ? 'Expand this chat session' : 'Collapse this chat session'}
        >
          <ChevronRight
            size={13}
            className={`shrink-0 transition-all duration-200 ${
              isCollapsed ? 'text-slate-400' : 'rotate-90 text-slate-500'
            }`}
          />
          <span className={`shrink-0 text-[10px] 2xl:text-[11px] font-bold uppercase tracking-[0.12em] text-white px-1.5 py-[1px] rounded-full ${
            isActiveSession ? 'bg-blue-600' : 'bg-blue-400'
          }`}>
            {sessionLabel}
          </span>
          <span className={`flex-1 min-w-0 text-[11px] 2xl:text-xs truncate ${
            isActiveSession ? 'text-slate-700 font-semibold' : 'text-slate-400'
          }`} title={firstPrompt}>
            {firstPrompt}
          </span>
          <span className="shrink-0 text-[10px] 2xl:text-[11px] font-medium text-slate-400 whitespace-nowrap">
            {checkpointCount} · {sessionTime}
          </span>
        </div>

        {/* Checkpoints within this chat session, newest first */}
        {!isCollapsed && (
          <div className="relative pl-6 mt-1.5">
            {/* Timeline line */}
            <div className="absolute left-[14px] top-2 bottom-2 w-[2px] bg-slate-200 rounded-full" />
            {[...sessionVersions].reverse().map((ver, rIdx) => {
              const idx = session.end - rIdx;
              return (
                <CheckpointCard
                  key={ver.id}
                  ver={ver}
                  idx={idx}
                  isActive={currentVersionIndex === idx}
                  onSwitchVersion={onSwitchVersion}
                  onCollapse={onCollapse}
                  reversedIdx={rIdx}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  });
}

// Version-history dropdown, grouped by chat session: each
// group holds the checkpoints created in one continuous chat (split by the
// "+ new chat" button), newest session first. Restoring is a single click on
// any version row; it also re-activates its chat session's history (handled in
// App's switchVersion). Rendered as an overlay from the workspace edge.
export default function HistorySidebar({
  isOpen,
  versions,
  chatSessions = [],
  currentVersionIndex,
  onSwitchVersion,
  onCollapse,
}) {
  const activeSessionIndex = chatSessions.findIndex(
    (s) => currentVersionIndex >= s.start && currentVersionIndex <= s.end
  );

  return (
    <>
      {isOpen && (
        <button type="button" className="history-backdrop absolute inset-0 z-30 bg-scrim xl:hidden" aria-label="Close history" onClick={onCollapse} />
      )}
      {/* History Sidebar */}
      <aside aria-label="Version history" inert={!isOpen} className={`history-sidebar absolute left-0 top-0 bottom-0 flex flex-col z-30 transition-all duration-200 ease-out history-bg noise-texture border-r border-slate-200 panel-edge-right shadow-xl ${
        isOpen ? 'history-sidebar-open w-80 lg:w-[340px] xl:w-[380px] 2xl:w-[420px]' : 'w-0 min-w-0 border-r-0 overflow-hidden opacity-0 pointer-events-none'
      }`}>
        {/* Header */}
        <div className="h-[var(--chrome-row-h)] shrink-0 px-4 sm:px-5 flex items-center justify-between history-header-bg border-b border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onCollapse}
              className="history-icon-btn text-slate-400 hover:text-slate-700 bg-surface hover:bg-slate-200 p-1.5 rounded-lg border border-slate-200/70 hover:border-slate-300 transition-all duration-200 flex-shrink-0"
              title="Hide history panel"
              aria-label="Hide history panel"
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
            <span className="text-[11px] 2xl:text-xs font-bold text-slate-700 bg-surface px-2.5 py-0.5 rounded-full border border-slate-300/80 shadow-2xs whitespace-nowrap">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Version List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3.5 space-y-0 chat-scrollbar relative z-[1]">
          {versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <Clock size={20} />
              </div>
              <h3 className="text-slate-800 font-bold text-sm 2xl:text-base mb-1">No versions yet</h3>
              <p className="text-slate-500 text-xs 2xl:text-sm leading-relaxed max-w-[15rem]">
                Every build is saved here — click any version to restore it.
              </p>
            </div>
          ) : (
            <SessionGroups
              key={activeSessionIndex}
              chatSessions={chatSessions}
              versions={versions}
              activeSessionIndex={activeSessionIndex}
              currentVersionIndex={currentVersionIndex}
              onSwitchVersion={onSwitchVersion}
              onCollapse={onCollapse}
            />
          )}
        </div>
      </aside>
    </>
  );
}
