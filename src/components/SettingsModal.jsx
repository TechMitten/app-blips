import { Sun, Moon, Monitor, X } from 'lucide-react';
import Modal from './Modal';

// Settings modal: appearance (theme preference comes from useTheme in App).
// The LLM endpoint/key/model are fixed server-side (see functions/api/chat.js)
// and are not user-configurable.
export default function SettingsModal({ onClose, themePreference, onThemePreferenceChange, resolvedTheme }) {
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
