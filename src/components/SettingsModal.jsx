import { useState, useCallback } from 'react';
import { ShieldAlert, Sun, Moon, Monitor, Eye, EyeOff, X } from 'lucide-react';
import Modal from './Modal';
import {
  loadLlmConfig, saveLlmConfig, saveRememberKey, loadRememberKey, isInsecureEndpoint
} from '../lib/config';

// Settings modal: appearance (theme preference comes from useTheme in App) and
// the OpenAI-compatible LLM endpoint config. The LLM config state lives here --
// every change is persisted immediately, so unmounting/remounting loses nothing.
export default function SettingsModal({ onClose, themePreference, onThemePreferenceChange, resolvedTheme }) {
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(loadRememberKey);

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

  return (
    <Modal
      zIndex={60}
      cardClass="w-full max-w-lg xl:max-w-xl 2xl:max-w-2xl max-h-[90vh] bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col"
    >
      <div className="shrink-0 px-8 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
        <div className="space-y-3">
          <label className="text-base font-bold text-slate-900 uppercase tracking-wider">Appearance</label>
          <p className="text-slate-900 text-sm lg:text-base leading-relaxed">
            Choose how Orion looks on this device.
          </p>
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
          <p className="text-slate-500 text-xs lg:text-sm leading-snug">
            {themePreference === 'system'
              ? `Following your system setting \u2014 currently ${resolvedTheme}.`
              : `Always ${themePreference}. Your system setting is ignored.`}
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-base font-bold text-slate-900 uppercase tracking-wider">API Endpoint</label>
          <p className="text-slate-900 text-sm lg:text-base leading-relaxed">
            Connect any OpenAI-compatible API. Enter the endpoint URL, key and model — changes save automatically.
          </p>
          <div>
            <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Base URL</span>
            <input
              type="text"
              value={llmConfig.baseUrl}
              onChange={(e) => handleLlmConfigChange('baseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            {isInsecureEndpoint(llmConfig.baseUrl) && (
              <p className="mt-2 flex items-start gap-2 text-sm lg:text-base font-semibold text-amber-700">
                <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                <span>This endpoint is plain http, so your API key will cross the network unencrypted. Use https for anything outside your own machine.</span>
              </p>
            )}
          </div>
          <div>
            <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">API Key</span>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={llmConfig.apiKey}
                onChange={(e) => handleLlmConfigChange('apiKey', e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 pr-10 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-600 hover:text-slate-900 transition-colors"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm lg:text-base font-semibold text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => handleRememberKeyChange(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <span>Remember on this device</span>
            </label>
            <p className="text-slate-500 text-xs lg:text-sm leading-snug">
              {rememberKey
                ? 'Stored in this browser until you clear it.'
                : 'Kept for this tab only — you will re-enter it next time.'}
            </p>
          </div>
          <div>
            <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Model</span>
            <input
              type="text"
              value={llmConfig.model}
              onChange={(e) => handleLlmConfigChange('model', e.target.value)}
              placeholder="gpt-4o"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <div>
            <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Max Tokens (Optional)</span>
            <input
              type="number"
              value={llmConfig.max_tokens}
              onChange={(e) => handleLlmConfigChange('max_tokens', e.target.value)}
              placeholder="Leave blank for model default"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              min="1"
            />
          </div>
          <div>
            <span className="block text-sm lg:text-base font-bold text-slate-900 mb-1">Reasoning / Thinking</span>
            <p className="text-slate-600 text-xs lg:text-sm leading-snug mb-3">
              Let the model think before answering. Disable for faster responses on standard models, or choose intensity for reasoning models.
            </p>
            <select
              value={llmConfig.reasoning === true ? 'medium' : (llmConfig.reasoning === false ? 'none' : llmConfig.reasoning)}
              onChange={(e) => handleLlmConfigChange('reasoning', e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 text-base font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            >
              <option value="none">None (Disabled)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </div>
      <div className="shrink-0 bg-slate-50 px-8 py-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleDone}
          className="brand-fill-text rounded-lg px-6 py-2.5 bg-brand text-white font-semibold text-base hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
