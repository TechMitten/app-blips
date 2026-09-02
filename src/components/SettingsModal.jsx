import { Sun, Moon, Monitor, X } from 'lucide-react';
import Modal from './Modal';
import { CHAT_FONT_OPTIONS } from '../lib/config';

// Settings modal: appearance (theme preference comes from useTheme in App,
// chat font size from useChatFont) and the code-view toggle. The LLM
// endpoint/key/model are fixed server-side (see functions/api/chat.js) and are
// not user-configurable.
const CHAT_FONT_LABELS = { small: 'Small', default: 'Default', large: 'Large', xlarge: 'XL' };
// The option buttons show an "A" at the size it selects -- the preview IS the label.
const CHAT_FONT_PREVIEW = { small: 'text-[12px]', default: 'text-sm', large: 'text-base', xlarge: 'text-lg' };

export default function SettingsModal({
  onClose,
  themePreference,
  onThemePreferenceChange,
  resolvedTheme,
  chatFont,
  onChatFontChange,
  showCodeView,
  onShowCodeViewChange,
}) {
  return (
    <Modal
      zIndex={60}
      cardClass="w-full max-w-lg xl:max-w-xl 2xl:max-w-2xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col"
    >
      <div className="shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-6 py-5 space-y-5 overflow-y-auto custom-scrollbar">

        {/* Appearance */}
        <section className="space-y-2" aria-label="Appearance">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
            <h3 className="text-xs 2xl:text-sm font-bold uppercase tracking-[0.14em] text-indigo-600">
              Appearance
            </h3>
            <div className="nav-segmented-group" role="group" aria-label="Theme">
              {[
                { value: 'light', label: 'Light', Icon: Sun },
                { value: 'dark', label: 'Dark', Icon: Moon },
                { value: 'system', label: 'System', Icon: Monitor }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={themePreference === option.value}
                  onClick={() => onThemePreferenceChange(option.value)}
                  className={`nav-segmented-btn ${themePreference === option.value ? 'nav-segmented-btn-active' : ''}`}
                >
                  <option.Icon size={14} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-snug">
            {themePreference === 'system'
              ? `Following your system setting — currently ${resolvedTheme}.`
              : `Always ${themePreference}. Your system setting is ignored.`}
          </p>
        </section>

        {/* Chat font size */}
        <section className="space-y-2" aria-label="Chat font size">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
            <h3 className="text-xs 2xl:text-sm font-bold uppercase tracking-[0.14em] text-indigo-600">
              Chat font
            </h3>
            <div className="nav-segmented-group" role="group" aria-label="Chat font size">
              {CHAT_FONT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={chatFont === option}
                  aria-label={CHAT_FONT_LABELS[option]}
                  title={CHAT_FONT_LABELS[option]}
                  onClick={() => onChatFontChange(option)}
                  className={`nav-segmented-btn ${chatFont === option ? 'nav-segmented-btn-active' : ''}`}
                >
                  <span className={`font-semibold leading-none ${CHAT_FONT_PREVIEW[option]}`}>A</span>
                  <span className="sr-only">{CHAT_FONT_LABELS[option]}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-snug">
            Text size for the build conversation, including replies and code snippets.
          </p>
        </section>

        {/* Code view toggle */}
        <section className="space-y-2" aria-label="Code view">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
            <h3 className="text-xs 2xl:text-sm font-bold uppercase tracking-[0.14em] text-indigo-600">
              Code view
            </h3>
            <button
              type="button"
              role="switch"
              aria-checked={showCodeView}
              aria-label="Show Code tab"
              onClick={() => onShowCodeViewChange(!showCodeView)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                showCodeView
                  ? 'brand-fill-text bg-brand border-transparent'
                  : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  showCodeView ? 'translate-x-[23px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-slate-600 leading-snug">
            Show the Code tab in the preview toolbar to inspect the generated HTML.
          </p>
        </section>
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
