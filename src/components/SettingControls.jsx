import { useRef } from 'react';

// Building blocks shared by the settings-style modals (SettingsModal,
// DeployModal), so their rows, switches and buttons stay identical.

export const FIELD_CLASS = 'w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400';
export const PRIMARY_BUTTON = 'brand-fill-text inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2 bg-brand text-white font-semibold text-sm hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';
export const SECONDARY_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50';

// One setting: label + helper text on the left, control on the right. Stacks on
// narrow widths so segmented controls never squeeze the copy. `details` is
// optional full-width content below the row (e.g. fields revealed by a switch).
export function SettingRow({ id, title, description, children, details }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-x-6 gap-y-2.5">
        <div className="min-w-0 sm:max-w-[60%]">
          <h3 id={id} className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-600 leading-snug">{description}</p>}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
      {details && <div className="mt-3.5">{details}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, labelledBy, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? 'bg-emerald-500 border-transparent'
          : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70 dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600/70'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-5.75 bg-white' : 'translate-x-0.75 bg-white dark:bg-slate-300'
        }`}
      />
    </button>
  );
}

// Tab panel beside a TabList. Fixed height on wider screens so the modal
// doesn't resize between tabs.
export const TAB_PANEL_CLASS = 'flex-1 min-w-0 px-6 py-5 overflow-y-auto custom-scrollbar sm:h-[26rem] focus-visible:outline-none';

// Vertical tab sidebar (a grid above the panel under 640px). WAI-ARIA tabs
// pattern: roving tabindex, arrows/Home/End move + activate. Each tab is
// { id, label, Icon, attention? }; `attention` marks a tab whose contents
// currently block the modal's main action, since they may be out of view.
// Ids are `${idPrefix}-tab-${id}` / `${idPrefix}-panel-${id}`.
export function TabList({ tabs, active, onSelect, idPrefix, label }) {
  const tabRefs = useRef({});

  const onKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.id === active);
    const vertical = window.matchMedia('(min-width: 640px)').matches;
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    let next = null;
    if (event.key === nextKey) next = (index + 1) % tabs.length;
    else if (event.key === prevKey) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = tabs[next].id;
    onSelect(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className={`shrink-0 grid ${tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} sm:flex sm:flex-col gap-1 p-2 sm:p-3 sm:w-48 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50/60`}
    >
      {tabs.map(({ id, label: tabLabel, Icon, attention }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            ref={(el) => { tabRefs.current[id] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            className={`flex min-w-0 items-center justify-center sm:justify-start gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              selected
                ? 'bg-indigo-500/10 text-indigo-600 font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Icon size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{tabLabel}</span>
            {attention && (
              <>
                <span aria-hidden="true" className="sm:ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="sr-only">(needs attention)</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
