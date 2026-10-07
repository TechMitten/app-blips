import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react';
import { SettingRow, FIELD_CLASS, SECONDARY_BUTTON } from './SettingControls';
import { desktopBridge, ipcErrorMessage } from '../lib/desktop';
import { requestModelText, CHAT_REASONING_EFFORT } from '../lib/llm';
import { USER_PROVIDER_OPTIONS } from '../../functions/_lib/providers.js';

// Settings → AI in the desktop app. The web build's UserProviderSettings keeps
// the key in browser storage and sends it with each request; here it is saved
// in the main process, encrypted with the OS keychain (electron/providerStore.js),
// and attached to requests there. The renderer only learns { id, model, hasKey },
// so the key field is write-only: blank means "keep the saved key".
// Edits are a draft until Save; `guardRef` lets SettingsModal stop the user
// leaving with unsaved edits (see useProviderGuard there).

const INPUT_CLASS = `mt-1.5 ${FIELD_CLASS}`;
const providerLabel = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.label || id;
const providerModels = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.models || [];

export default function DesktopProviderSettings({ guardRef }) {
  const [saved, setSaved] = useState(null); // provider.get() result
  const [draft, setDraft] = useState({ id: USER_PROVIDER_OPTIONS[0].id, model: '', apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'busy' | 'ok' | 'error', text }

  useEffect(() => {
    desktopBridge.provider.get().then((info) => {
      setSaved(info);
      if (info.id) setDraft({ id: info.id, model: info.model, apiKey: '' });
    }).catch((err) => setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not read the AI settings.' }));
  }, []);

  const update = (fields) => {
    setDraft((d) => ({ ...d, ...fields }));
    setStatus(null);
  };

  const keepsSavedKey = Boolean(saved?.hasKey && saved.id === draft.id);
  const complete = draft.model.trim() && (draft.apiKey.trim() || keepsSavedKey);
  const dirty = !saved?.enabled || saved.id !== draft.id || saved.model !== draft.model.trim() || Boolean(draft.apiKey.trim());
  const active = saved?.enabled && saved.id && saved.model && saved.hasKey;
  // Anything typed that Save hasn't stored yet.
  const base = saved?.id ? { id: saved.id, model: saved.model } : { id: USER_PROVIDER_OPTIONS[0].id, model: '' };
  const unsaved = Boolean(saved) && (draft.id !== base.id || draft.model.trim() !== base.model || Boolean(draft.apiKey.trim()));

  const summary = !saved
    ? 'Loading…'
    : active
      ? `Using ${providerLabel(saved.id)} · ${saved.model}.`
      : saved.envConfigured
        ? 'Using the provider from your environment variables. Save one here to use it instead.'
        : 'Not set up yet. Choose a model and enter your OpenRouter API key to start building.';

  // Returns whether it saved, for the leave-with-unsaved-changes dialog.
  const onSave = async () => {
    setStatus({ kind: 'busy', text: 'Saving…' });
    try {
      const next = await desktopBridge.provider.set({
        enabled: true,
        id: draft.id,
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      setSaved((prev) => ({ ...prev, ...next }));
      setDraft((d) => ({ ...d, model: d.model.trim(), apiKey: '' }));
      setShowKey(false);
      setStatus({ kind: 'ok', text: 'Saved.' });
      return true;
    } catch (err) {
      setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not save.' });
      return false;
    }
  };

  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = { unsaved, complete: Boolean(complete), save: onSave };
    return () => { guardRef.current = null; };
  });

  // An empty apiKey asks the main process to use the saved key for this provider.
  const onTest = async () => {
    setStatus({ kind: 'busy', text: 'Testing…' });
    try {
      await requestModelText({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        askMode: true,
        // The same effort the app's own chat calls use. 'none' would ask
        // some models to switch thinking off, which always-thinking models
        // (e.g. Z.ai glm-5.3-flash) reject, failing a working setup.
        reasoningEffort: CHAT_REASONING_EFFORT,
        userProvider: { id: draft.id, model: draft.model.trim(), apiKey: draft.apiKey.trim() },
        retry: false,
      });
      setStatus({ kind: 'ok', text: `Connected to ${providerLabel(draft.id)}.` });
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || 'The test request failed.' });
    }
  };

  const onClear = async () => {
    try {
      const next = await desktopBridge.provider.clear();
      setSaved((prev) => ({ ...prev, ...next }));
      setDraft({ id: USER_PROVIDER_OPTIONS[0].id, model: '', apiKey: '' });
      setShowKey(false);
      setStatus(null);
    } catch (err) {
      setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not clear.' });
    }
  };

  const busy = status?.kind === 'busy';

  return (
    <SettingRow
      id="set-desktop-provider"
      title="OpenRouter"
      description={summary}
      details={(
        <div className="space-y-3">
          <label className="block text-sm text-slate-600">
            Model
            <select
              value={draft.model}
              onChange={(e) => update({ model: e.target.value })}
              className={`${INPUT_CLASS} bg-surface`}
            >
              <option value="" className="bg-surface text-slate-900">Select a coding model…</option>
              {providerModels(draft.id).map((model) => (
                <option key={model.id} value={model.id} className="bg-surface text-slate-900">{model.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-600">
            OpenRouter API key
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={keepsSavedKey ? 'Saved (encrypted) — type to replace' : `Your ${providerLabel(draft.id)} API key`}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT_CLASS} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute inset-y-0 right-0 mt-1.5 flex items-center px-3.5 text-slate-400 hover:text-slate-700 transition-colors"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <p className="text-xs text-slate-500 leading-snug">
            Your key is encrypted with your system keychain and stored only on this computer, never in your projects.
            Apps you open in a new tab use it too; exported HTML files ask whoever runs them for their own key.
          </p>
          {saved?.weakEncryption && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 leading-snug">
              <TriangleAlert size={14} className="shrink-0 mt-px" />
              No system keychain was found, so the key is stored with weak encryption. Installing GNOME Keyring or KWallet protects it properly.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!complete || !dirty || busy}
              className="brand-fill-text rounded-lg px-4 py-1.5 bg-brand text-white font-semibold text-sm hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" onClick={onTest} disabled={!complete || busy} className={SECONDARY_BUTTON}>
              Test connection
            </button>
            <button type="button" onClick={onClear} disabled={!saved?.id || busy} className={SECONDARY_BUTTON}>
              Clear
            </button>
            {status && (
              <span
                role={status.kind === 'error' ? 'alert' : 'status'}
                className={`inline-flex items-center gap-1.5 text-xs ${status.kind === 'error' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-600' : 'text-slate-500'}`}
              >
                {status.kind === 'busy' && <Loader2 size={14} className="animate-spin" />}
                {status.kind === 'ok' && <CircleCheck size={14} />}
                {status.kind === 'error' && <CircleAlert size={14} />}
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}
    />
  );
}
