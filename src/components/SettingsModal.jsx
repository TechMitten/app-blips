import { useRef, useState } from 'react';
import { Sun, Moon, Monitor, X, Palette, LayoutGrid, Sparkles } from 'lucide-react';
import Modal from './Modal';
import { CHAT_FONT_OPTIONS, REASONING_EFFORT_OPTIONS } from '../lib/config';

// Settings modal, split into tabs: Appearance (theme from useTheme in App, chat
// font size from useChatFont, build pane side), Workspace (code view, splash)
// and AI (reasoning effort, clarifying questions).
// The LLM endpoint/key/model are fixed server-side (see functions/api/chat.js)
// and are not user-configurable; reasoning effort is a per-user choice.
const CHAT_FONT_LABELS = { small: 'Small', default: 'Default', large: 'Large', xlarge: 'XL' };
// The option buttons show an "A" at the size it selects -- the preview IS the label.
const CHAT_FONT_PREVIEW = { small: 'text-[12px]', default: 'text-sm', large: 'text-base', xlarge: 'text-lg' };
const REASONING_EFFORT_LABELS = { none: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

const TABS = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'workspace', label: 'Workspace', Icon: LayoutGrid },
  { id: 'ai', label: 'AI', Icon: Sparkles },
];
const TAB_STORAGE_KEY = 'orion-settings-tab';

const loadTab = () => {
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    return TABS.some((t) => t.id === stored) ? stored : TABS[0].id;
  } catch {
    return TABS[0].id;
  }
};

// One setting: label + helper text on the left, control on the right. Stacks on
// narrow widths so segmented controls never squeeze the copy.
function SettingRow({ id, title, description, children }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-x-6 gap-y-2.5">
      <div className="min-w-0 sm:max-w-[60%]">
        <h3 id={id} className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-600 leading-snug">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, labelledBy }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
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

function Segmented({ label, value, options, onChange, renderOption }) {
  return (
    <div className="nav-segmented-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          title={option.ariaLabel}
          onClick={() => onChange(option.value)}
          className={`nav-segmented-btn ${value === option.value ? 'nav-segmented-btn-active' : ''}`}
        >
          {renderOption ? renderOption(option) : <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}

export default function SettingsModal({
  onClose,
  themePreference,
  onThemePreferenceChange,
  resolvedTheme,
  chatFont,
  onChatFontChange,
  showCodeView,
  onShowCodeViewChange,
  askClarifyingQuestions,
  onAskClarifyingQuestionsChange,
  skipSplash,
  onSkipSplashChange,
  autoFollowCode,
  onAutoFollowCodeChange,
  liveCodePreview,
  onLiveCodePreviewChange,
  buildPaneSide,
  onBuildPaneSideChange,
  reasoningEffort,
  onReasoningEffortChange,
}) {
  const [tab, setTab] = useState(loadTab);
  const tabRefs = useRef({});

  const selectTab = (id) => {
    setTab(id);
    try { sessionStorage.setItem(TAB_STORAGE_KEY, id); } catch { /* storage unavailable */ }
  };

  // WAI-ARIA tabs pattern: roving tabindex, arrows/Home/End move + activate.
  const onTabKeyDown = (event) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const vertical = window.matchMedia('(min-width: 640px)').matches;
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    let next = null;
    if (event.key === nextKey) next = (index + 1) % TABS.length;
    else if (event.key === prevKey) next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next].id;
    selectTab(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <Modal
      zIndex={60}
      cardClass="w-full max-w-lg sm:max-w-2xl xl:max-w-3xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'settings-title' }}
    >
      <div className="shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 id="settings-title" className="text-xl font-bold text-slate-900">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
        <div
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="vertical"
          onKeyDown={onTabKeyDown}
          className="shrink-0 flex sm:flex-col gap-1 p-2 sm:p-3 sm:w-48 overflow-x-auto border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50/60"
        >
          {TABS.map((t) => {
            const { id, label } = t;
            const Icon = t.Icon;
            const active = tab === id;
            return (
              <button
                key={id}
                ref={(el) => { tabRefs.current[id] = el; }}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(id)}
                className={`flex flex-1 sm:flex-none items-center justify-center sm:justify-start gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                  active
                    ? 'bg-indigo-500/10 text-indigo-600 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Fixed-height panel area so the modal doesn't resize between tabs. */}
        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          tabIndex={0}
          className="flex-1 min-w-0 px-6 py-5 overflow-y-auto custom-scrollbar sm:h-[26rem] divide-y divide-slate-200 focus-visible:outline-none"
        >
          {tab === 'appearance' && (
            <>
              <SettingRow
                id="set-theme"
                title="Theme"
                description={
                  themePreference === 'system'
                    ? `Following your system setting — currently ${resolvedTheme}.`
                    : `Always ${themePreference}. Your system setting is ignored.`
                }
              >
                <Segmented
                  label="Theme"
                  value={themePreference}
                  onChange={onThemePreferenceChange}
                  options={[
                    { value: 'light', label: 'Light', Icon: Sun },
                    { value: 'dark', label: 'Dark', Icon: Moon },
                    { value: 'system', label: 'System', Icon: Monitor },
                  ]}
                  renderOption={(o) => (<><o.Icon size={14} /><span>{o.label}</span></>)}
                />
              </SettingRow>
              <SettingRow
                id="set-font"
                title="Build pane font"
                description="Text size for the entire build pane, including starter ideas, chat conversation, and prompt input."
              >
                <Segmented
                  label="Build pane font size"
                  value={chatFont}
                  onChange={onChatFontChange}
                  options={CHAT_FONT_OPTIONS.map((value) => ({ value, label: CHAT_FONT_LABELS[value], ariaLabel: CHAT_FONT_LABELS[value] }))}
                  renderOption={(o) => (
                    <>
                      <span className={`font-semibold leading-none ${CHAT_FONT_PREVIEW[o.value]}`}>A</span>
                      <span className="sr-only">{o.label}</span>
                    </>
                  )}
                />
              </SettingRow>
              <SettingRow
                id="set-side"
                title="Build pane position"
                description="Show the build pane on the left or right of the preview. Applies on wider screens."
              >
                <Segmented
                  label="Build pane position"
                  value={buildPaneSide}
                  onChange={onBuildPaneSideChange}
                  options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
                />
              </SettingRow>
            </>
          )}

          {tab === 'workspace' && (
            <>
              <SettingRow id="set-code" title="Code view" description="Show the Code tab in the preview toolbar to inspect the generated HTML.">
                <Switch checked={showCodeView} onChange={onShowCodeViewChange} labelledBy="set-code" />
              </SettingRow>
              <SettingRow id="set-follow" title="Auto Follow Code" description="Auto-scroll the Code tab to follow the latest line as the app is generated.">
                <Switch checked={autoFollowCode} onChange={onAutoFollowCodeChange} labelledBy="set-follow" />
              </SettingRow>
              <SettingRow id="set-livecode" title="Live code preview" description="Show the code being written in the preview pane while an app is generated.">
                <Switch checked={liveCodePreview} onChange={onLiveCodePreviewChange} labelledBy="set-livecode" />
              </SettingRow>
              <SettingRow id="set-splash" title="Skip splash screen" description="Skip the intro animation on launch. Takes effect on the next page load.">
                <Switch checked={skipSplash} onChange={onSkipSplashChange} labelledBy="set-splash" />
              </SettingRow>
            </>
          )}

          {tab === 'ai' && (
            <>
              <SettingRow
                id="set-reasoning"
                title="Reasoning effort"
                description="How much the AI reasons before generating or answering. Higher effort can improve complex apps, but is slower and uses more tokens."
              >
                <Segmented
                  label="Reasoning effort"
                  value={reasoningEffort}
                  onChange={onReasoningEffortChange}
                  options={REASONING_EFFORT_OPTIONS.map((value) => ({ value, label: REASONING_EFFORT_LABELS[value] }))}
                />
              </SettingRow>
              <SettingRow id="set-clarify" title="Clarifying questions" description="Allow the AI to ask helpful clarifying questions about your prompt before generating the code.">
                <Switch checked={askClarifyingQuestions} onChange={onAskClarifyingQuestionsChange} labelledBy="set-clarify" />
              </SettingRow>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="brand-fill-text rounded-lg px-5 py-2 bg-brand text-white font-semibold text-sm hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
