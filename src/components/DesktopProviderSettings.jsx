import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react';
import ModelCombobox from './ModelCombobox';
import useProviderModels from '../hooks/useProviderModels';
import { SettingRow, FIELD_CLASS, SECONDARY_BUTTON } from './SettingControls';
import { ipcErrorMessage, providerApi } from '../lib/desktop';
import { requestModelText, CHAT_REASONING_EFFORT } from '../lib/llm';
import { USER_PROVIDER_OPTIONS } from '../../electron/server/providers.js';

// Settings → AI in the desktop app. The web build's UserProviderSettings keeps
// the key in browser storage and sends it with each request; here it is saved
// in the main process, encrypted with the OS keychain (electron/providerStore.js),
// and attached to requests there. The renderer only learns { id, model, hasKey },
// so the key field is write-only: blank means "keep the saved key".
// Edits are a draft until Save; `guardRef` lets SettingsModal stop the user
// leaving with unsaved edits (see useProviderGuard there).

const SELECT_COLORS = { backgroundColor: 'var(--color-surface)', color: 'var(--color-slate-900)' };
const INPUT_CLASS = `mt-1.5 ${FIELD_CLASS}`;
const providerLabel = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.label || id;


export default function DesktopProviderSettings({ guardRef }) {
  const [saved, setSaved] = useState(null); // provider.get() result
  const [draft, setDraft] = useState({ id: USER_PROVIDER_OPTIONS[0].id, model: '', baseUrl: '', apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'busy' | 'ok' | 'error', text }
  const modelList = useProviderModels({
    ...draft,
    hasSavedKey: Boolean(saved?.hasKey && saved.id === draft.id),
  });

  useEffect(() => {
    providerApi.get().then((info) => {
      setSaved(info);
      if (info.id) setDraft({ id: info.id, model: info.model, baseUrl: info.baseUrl || '', apiKey: '' });
    }).catch((err) => setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not read the AI settings.' }));
  }, []);

  const update = (fields) => {
    setDraft((d) => ({ ...d, ...fields }));
    setStatus(null);
  };

  const option = USER_PROVIDER_OPTIONS.find((p) => p.id === draft.id);
  const local = option.local;
  const keepsSavedKey = Boolean(saved?.hasKey && saved.id === draft.id);
  const complete = draft.model.trim() && (local || draft.apiKey.trim() || keepsSavedKey);
  const dirty = !saved?.enabled || saved.id !== draft.id || saved.model !== draft.model.trim() || (saved.baseUrl || '') !== draft.baseUrl.trim() || Boolean(draft.apiKey.trim());
  const active = saved?.enabled && saved.id && saved.model && (saved.local || saved.hasKey);
  // Anything typed that Save hasn't stored yet.
  const base = saved?.id ? { id: saved.id, model: saved.model } : { id: USER_PROVIDER_OPTIONS[0].id, model: '' };
  const unsaved = Boolean(saved) && (draft.id !== base.id || draft.model.trim() !== base.model || draft.baseUrl.trim() !== (saved?.baseUrl || '') || Boolean(draft.apiKey.trim()));

  const summary = !saved
    ? 'Loading…'
    : active
      ? `Using ${providerLabel(saved.id)} · ${saved.model}.`
      : saved.envConfigured
        ? 'Using the provider from your environment variables. Save one here to use it instead.'
        : 'Not set up yet. Choose a provider and coding model to start building.';

  // Returns whether it saved, for the leave-with-unsaved-changes dialog.
  const onSave = async () => {
    setStatus({ kind: 'busy', text: 'Saving…' });
    try {
      const next = await providerApi.set({
        enabled: true,
        id: draft.id,
        model: draft.model.trim(),
        baseUrl: draft.baseUrl.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      setSaved((prev) => ({ ...prev, ...next }));
      setDraft((d) => ({ ...d, model: d.model.trim(), baseUrl: next.baseUrl || '', apiKey: '' }));
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

  // An empty apiKey reuses this provider’s saved key in desktop or browser mode.
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
        userProvider: { id: draft.id, model: draft.model.trim(), baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() },
        retry: false,
      });
      setStatus({ kind: 'ok', text: `Connected to ${providerLabel(draft.id)}.` });
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || 'The test request failed.' });
    }
  };

  const onClear = async () => {
    try {
      const next = await providerApi.clear();
      setSaved((prev) => ({ ...prev, ...next }));
      setDraft({ id: USER_PROVIDER_OPTIONS[0].id, model: '', baseUrl: '', apiKey: '' });
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
      title="AI coding provider"
      description={summary}
      details={(
        <div className="space-y-3">
          <label className="block text-sm text-slate-600">
            Provider
            <select value={draft.id} onChange={(e) => update({ id: e.target.value, model: '', apiKey: '', baseUrl: '' })} className={INPUT_CLASS} style={SELECT_COLORS}>
              {USER_PROVIDER_OPTIONS.map((p) => <option key={p.id} value={p.id} style={SELECT_COLORS}>{p.label}</option>)}
            </select>
          </label>
          {local && <label className="block text-sm text-slate-600">
            Local server URL
            <input value={draft.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder={option.baseUrl} className={INPUT_CLASS} />
          </label>}
          <label className="block text-sm text-slate-600">
            {local ? 'API key (optional)' : `${providerLabel(draft.id)} API key`}
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
            {local ? 'Start your local server and load a model that supports tool calling. The server URL must include /v1. No API key is required unless your server uses authentication.' : <>Your key is encrypted with your system keychain and stored only on this computer, never in your projects.
            Apps you open in a new tab use it too; exported HTML files ask whoever runs them for their own key.</>}
          </p>
          {['anthropic', 'openai', 'gemini', 'deepseek'].includes(draft.id) && <p className="text-xs text-slate-500">
            <a href={draft.id === 'gemini' ? 'https://aistudio.google.com/apikey' : draft.id === 'openai' ? 'https://platform.openai.com/api-keys' : draft.id === 'anthropic' ? 'https://platform.claude.com/settings/keys' : 'https://platform.deepseek.com/api_keys'} target="_blank" rel="noopener noreferrer">Create a {providerLabel(draft.id)} API key</a>.
          </p>}
          {!local && saved?.weakEncryption && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 leading-snug">
              <TriangleAlert size={14} className="shrink-0 mt-px" />
              No system keychain was found, so the key is stored with weak encryption. Installing GNOME Keyring or KWallet protects it properly.
            </p>
          )}
          <label className="block text-sm text-slate-600">
            Model
            <ModelCombobox
              value={draft.model}
              onChange={(model) => update({ model })}
              models={modelList.models}
              loading={modelList.loading}
              allowCustom
              placeholder="Select a model or enter its ID…"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <button type="button" onClick={modelList.refresh} disabled={modelList.loading || modelList.needsKey} className={SECONDARY_BUTTON}>Refresh models</button>
            {modelList.needsKey && <span>Enter your API key to load models, or enter a model ID manually.</span>}
            {modelList.error && <span role="status">{modelList.error} Type a model ID to continue.</span>}
          </div>
          {draft.id === 'openai' && <p className="text-xs text-slate-500">
            Choose an OpenAI model that supports tool calling through Chat Completions.
          </p>}
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
