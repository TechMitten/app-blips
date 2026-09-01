import { useState, useCallback } from 'react';
import { ShieldAlert, Sun, Moon, Monitor, Eye, EyeOff, X } from 'lucide-react';
import Modal from './Modal';
import {
  loadLlmConfig, saveLlmConfig, saveRememberKey, loadRememberKey, isInsecureEndpoint,
  toChatCompletionsUrl
} from '../lib/config';

const inputClass = 'w-full bg-surface border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-xs hover:border-slate-400 focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 outline-none transition-all';

// The connection section reads as a signal chain: a rail of numbered nodes in
// request order (endpoint -> key -> model). The numbering encodes the request
// path, so it stays to the three identity fields; tuning knobs sit outside it.
function ChainNode({ index }) {
  return (
    <span
      aria-hidden="true"
      className="relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface font-mono text-[10px] font-semibold text-indigo-600 shadow-2xs"
    >
      {index}
    </span>
  );
}

// Settings modal: appearance (theme preference comes from useTheme in App) and
// the OpenAI-compatible LLM endpoint config. The LLM config state lives here --
// every change is persisted immediately, so unmounting/remounting loses nothing.
export default function SettingsModal({ onClose, themePreference, onThemePreferenceChange, resolvedTheme }) {
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(loadRememberKey);

  const resolvedUrl = toChatCompletionsUrl(llmConfig.baseUrl);

  const handleLlmConfigChange = useCallback((field, value) => {
    setLlmConfig((prev) => {
      const next = { ...prev, [field]: value };
      saveLlmConfig(next, rememberKey);
      return next;
    });
  }, [rememberKey]);

  const handleRememberKeyChange = useCallback((next) => {
    setRememberKey(next);
    saveRememberKey(next, llmConfig);
  }, [llmConfig]);

  const handleDone = () => {
    saveLlmConfig(llmConfig, rememberKey);
    onClose();
  };

  const storageOptions = [
    { value: true, label: 'This device', caption: 'Key stays after you close the browser.' },
    { value: false, label: 'This tab only', caption: 'Key is erased when the tab closes.' },
  ];

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
              ? `Following your system setting \u2014 currently ${resolvedTheme}.`
              : `Always ${themePreference}. Your system setting is ignored.`}
          </p>
        </section>

        {/* Connection -- the request chain */}
        <section className="space-y-3" aria-label="Connection">
          <div className="space-y-1">
            <h3 className="text-xs 2xl:text-sm font-bold uppercase tracking-[0.14em] text-indigo-600">
              Connection
            </h3>
            <p className="text-slate-600 text-xs leading-snug">
              Point Orion at any OpenAI-compatible API. Changes save as you type.
            </p>
          </div>

          <ol className="relative space-y-5">
            <li className="relative grid grid-cols-[24px_1fr] gap-x-3">
              <ChainNode index={1} />
              <div aria-hidden="true" className="absolute left-[11px] top-6 -bottom-6 w-px bg-slate-300" />
              <div>
                <label htmlFor="settings-base-url" className="block text-sm font-semibold text-slate-800 mb-1">
                  Base URL
                </label>
                <input
                  id="settings-base-url"
                  type="text"
                  value={llmConfig.baseUrl}
                  onChange={(e) => handleLlmConfigChange('baseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs leading-snug text-slate-600">
                  {resolvedUrl ? (
                    <>
                      <span className="text-slate-500">Requests go to </span>
                      <span className="font-mono text-[11px] font-medium text-slate-900 break-all">
                        POST {resolvedUrl}
                      </span>
                    </>
                  ) : (
                    'Add an endpoint URL to see where requests land.'
                  )}
                </p>
                {isInsecureEndpoint(llmConfig.baseUrl) && (
                  <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                    <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                    <span>This endpoint is plain http, so your API key will cross the network unencrypted. Use https for anything outside your own machine.</span>
                  </p>
                )}
              </div>
            </li>

            <li className="relative grid grid-cols-[24px_1fr] gap-x-3">
              <ChainNode index={2} />
              <div aria-hidden="true" className="absolute left-[11px] top-6 -bottom-6 w-px bg-slate-300" />
              <div>
                <label htmlFor="settings-api-key" className="block text-sm font-semibold text-slate-800 mb-1">
                  API key
                </label>
                <div className="relative">
                  <input
                    id="settings-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={llmConfig.apiKey}
                    onChange={(e) => handleLlmConfigChange('apiKey', e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    className={`${inputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-900 transition-colors"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <fieldset className="mt-2.5">
                  <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Where the key lives
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {storageOptions.map((opt) => (
                      <label key={opt.label} className="cursor-pointer">
                        <input
                          type="radio"
                          name="settings-key-storage"
                          className="peer sr-only"
                          checked={rememberKey === opt.value}
                          onChange={() => handleRememberKeyChange(opt.value)}
                        />
                        <span className="block rounded-lg border border-slate-300 bg-surface px-2.5 py-1.5 transition-all peer-hover:border-slate-400 peer-checked:border-indigo-500 peer-checked:ring-1 peer-checked:ring-indigo-500/30 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40">
                          <span className={`block text-sm font-semibold ${rememberKey === opt.value ? 'text-indigo-600' : 'text-slate-800'}`}>
                            {opt.label}
                          </span>
                          <span className="block text-xs text-slate-600 leading-snug mt-0.5">
                            {opt.caption}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </li>

            <li className="relative grid grid-cols-[24px_1fr] gap-x-3">
              <ChainNode index={3} />
              <div>
                <label htmlFor="settings-model" className="block text-sm font-semibold text-slate-800 mb-1">
                  Model
                </label>
                <input
                  id="settings-model"
                  type="text"
                  value={llmConfig.model}
                  onChange={(e) => handleLlmConfigChange('model', e.target.value)}
                  placeholder="gpt-4o"
                  className={inputClass}
                />
              </div>
            </li>
          </ol>

          {/* Request tuning -- knobs, not identity, so they sit outside the chain */}
          <div className="rounded-xl border border-slate-200 bg-slate-100/50 p-3 space-y-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.12em]">
              Request tuning
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="settings-max-tokens" className="block text-sm font-semibold text-slate-800 mb-1">
                  Max tokens <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  id="settings-max-tokens"
                  type="number"
                  value={llmConfig.max_tokens}
                  onChange={(e) => handleLlmConfigChange('max_tokens', e.target.value)}
                  placeholder="Model default"
                  className={inputClass}
                  min="1"
                />
              </div>
              <div>
                <label htmlFor="settings-reasoning" className="block text-sm font-semibold text-slate-800 mb-1">
                  Reasoning
                </label>
                <select
                  id="settings-reasoning"
                  value={llmConfig.reasoning === true ? 'medium' : (llmConfig.reasoning === false ? 'none' : llmConfig.reasoning)}
                  onChange={(e) => handleLlmConfigChange('reasoning', e.target.value)}
                  className={inputClass}
                >
                  <option value="none">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <p className="mt-1 text-xs leading-snug text-slate-600">
                  Higher settings trade speed for deeper thinking.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleDone}
          className="brand-fill-text rounded-lg px-5 py-2 bg-brand text-white font-semibold text-sm hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
