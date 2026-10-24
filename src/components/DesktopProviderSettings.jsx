import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Loader2, CircleCheck, CircleAlert, TriangleAlert, ExternalLink, Sparkles } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import ModelCombobox from './ModelCombobox';
import CodeInput from './CodeInput';
import { CODE_LENGTH, codeValue, isCodeComplete } from '../lib/signInCode';
import useProviderModels from '../hooks/useProviderModels';
import { SettingRow, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import { ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';
import { creditsStatus, creditsConnect, creditsVerify, creditsCheckout, creditsSignOut, CREDIT_PACKS, FREE_TRIAL_PACK } from '../lib/credits';
import { requestModelText, CHAT_REASONING_EFFORT } from '../lib/llm';
import { logError } from '../lib/errorLog';
import { USER_PROVIDER_OPTIONS } from '../../electron/server/providers.js';

// Settings → AI. In the desktop app the key is saved in the main process,
// encrypted with the OS keychain (electron/providerStore.js); in the browser
// version AppBlips' own server keeps it (electron/server/keyFile.js). Either
// way it is attached to requests there, and the page only learns
// { id, model, hasKey }, so the key field is write-only: blank means "keep the
// saved key".
// Edits are a draft until Save; `guardRef` lets SettingsModal stop the user
// leaving with unsaved edits (see useProviderGuard there).

const SELECT_COLORS = { backgroundColor: 'var(--color-surface)', color: 'var(--color-slate-900)' };
const INPUT_CLASS = `mt-1.5 ${FIELD_CLASS}`;
const providerLabel = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.label || id;

function AppBlipsCreditsRow({ byokActive, onClearByok }) {
  const [info, setInfo] = useState(null); // { signedIn, email, remaining, totalGranted, totalUsed }
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'sending' | 'connecting' | 'checking' | packId
  const [waitingPack, setWaitingPack] = useState(null);
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }
  // The email a sign-in code went to; connecting needs that code, so knowing
  // a customer's email isn't enough to spend their credits.
  const [codeSentTo, setCodeSentTo] = useState('');
  const [code, setCode] = useState('');
  const mounted = useRef(true);

  const loadStatus = async (silent = false) => {
    if (!silent) setBusy('checking');
    const res = await creditsStatus();
    if (!mounted.current) return;
    if (!silent) setBusy('');
    if (!res.error) {
      setInfo(res);
      if (res.email && !email) setEmail(res.email);
    }
  };

  useEffect(() => {
    mounted.current = true;
    loadStatus(true);
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = (res) => {
    setWaitingPack(null);
    setCodeSentTo('');
    setCode('');
    setInfo(res);
    setMessage({ kind: 'ok', text: `Connected! ${typeof res.remaining === 'number' ? `${res.remaining.toLocaleString()} AI Credits ready.` : 'Ready to build.'}` });
  };

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage({ kind: 'error', text: 'Enter the email address you used at checkout.' });
      return;
    }
    setBusy('sending');
    setMessage(null);
    const res = await creditsConnect(trimmed);
    if (!mounted.current) return;
    setBusy('');
    if (res.error) {
      setMessage({ kind: 'error', text: res.error });
      return;
    }
    if (res.signedIn) return connected(res);
    setCode('');
    setCodeSentTo(res.email || trimmed);
    setMessage({ kind: 'ok', text: `We sent a sign-in code to ${res.email || trimmed}. It comes from Polar, our payment service.` });
  };

  const verifyCode = async () => {
    if (!isCodeComplete(code)) {
      setMessage({ kind: 'error', text: `Enter all ${CODE_LENGTH} characters of the code from the email.` });
      return;
    }
    setBusy('connecting');
    setMessage(null);
    const res = await creditsVerify(codeSentTo, codeValue(code));
    if (!mounted.current) return;
    setBusy('');
    if (res.error) {
      setMessage({ kind: 'error', text: res.error });
      return;
    }
    connected(res);
  };

  const startPackCheckout = async (pack) => {
    setMessage(null);
    setBusy(pack.id);
    const res = await creditsCheckout(pack.id, email.trim());
    if (!mounted.current) return;
    setBusy('');
    if (res.error || !res.checkoutUrl) {
      setMessage({ kind: 'error', text: res.error || 'Could not open checkout.' });
      return;
    }
    try { window.open(res.checkoutUrl, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    setWaitingPack(pack);
  };

  const signOut = async () => {
    setWaitingPack(null);
    const res = await creditsSignOut();
    if (!mounted.current) return;
    setInfo(res);
    setMessage(null);
  };

  const signedIn = Boolean(info?.signedIn);
  const creditsSummary = !info
    ? 'Checking your AppBlips Credits…'
    : signedIn
      ? `Connected as ${info.email}${typeof info.remaining === 'number' ? ` · ${info.remaining.toLocaleString()} AI Credits remaining` : ''}.${byokActive ? ' (Paused while custom provider below is active.)' : ' Active for all builds.'}`
      : 'Build without an API key. Buy a pay-as-you-go credit pack or connect with your checkout email.';

  return (
    <SettingRow
      id="set-appblips-credits"
      title="AppBlips AI Credits (No API key required)"
      description={creditsSummary}
      details={(
        <div className="space-y-3">
          {signedIn ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <CircleCheck size={14} className="shrink-0" />
                  Connected as {info.email}
                </span>
                {typeof info.remaining === 'number' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                    <Sparkles size={12} />
                    {info.remaining.toLocaleString()} Credits left
                  </span>
                )}
              </div>
              {typeof info.totalGranted === 'number' && (
                <p className="text-xs text-slate-500">
                  Used {(info.totalUsed || 0).toLocaleString()} of {info.totalGranted.toLocaleString()} total credits.
                  {info.trialActive && info.trialExpiresAt
                    ? ` 3-day free trial active until ${new Date(info.trialExpiresAt).toLocaleDateString()}.`
                    : info.trialExpired
                      ? ' Your 3-day free trial has expired — buy a credit pack below to continue.'
                      : ' Paid credits never expire.'}
                </p>
              )}
              {byokActive && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <span>Your custom API key below is currently overriding AppBlips Credits.</span>
                  <button type="button" onClick={onClearByok} className={SECONDARY_BUTTON}>
                    Use AppBlips Credits instead
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={() => loadStatus(false)} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                  {busy === 'checking' ? 'Refreshing…' : 'Refresh balance'}
                </button>
                <button type="button" onClick={signOut} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {codeSentTo ? (
                <>
                  <div className="text-sm text-slate-600">
                    Code from the email sent to {codeSentTo}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) verifyCode(); }}>
                      <CodeInput
                        value={code}
                        onChange={(next) => { setCode(next); setMessage(null); }}
                        label="Code from the email"
                        disabled={Boolean(busy)}
                        className="flex gap-1.5"
                        boxClassName="h-10 w-10 rounded-lg border border-slate-300 bg-surface text-center font-mono text-base font-semibold uppercase text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-400/30 disabled:opacity-60"
                        autoFocus
                      />
                      <button type="button" onClick={verifyCode} disabled={Boolean(busy) || !isCodeComplete(code)} className={`${PRIMARY_BUTTON} shrink-0`}>
                        {busy === 'connecting' ? 'Connecting…' : 'Connect Credits'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={sendCode} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                      {busy === 'sending' ? 'Sending…' : 'Send a new code'}
                    </button>
                    <button type="button" onClick={() => { setCodeSentTo(''); setCode(''); setMessage(null); }} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                      Use a different email
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-sm text-slate-600">
                    Checkout email
                    <div className="mt-1.5 flex flex-wrap sm:flex-nowrap gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setMessage(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendCode(); }}
                        placeholder="you@example.com (email used at checkout)"
                        className={FIELD_CLASS}
                      />
                      <button type="button" onClick={sendCode} disabled={Boolean(busy) || !email.trim()} className={`${PRIMARY_BUTTON} shrink-0`}>
                        {busy === 'sending' ? 'Sending…' : 'Email me a code'}
                      </button>
                    </div>
                  </label>
                  <p className="text-xs text-slate-500 leading-snug">
                    Already bought a credit pack? Enter the email you used at checkout and we'll email you a code to connect. Need credits? Pick a pack below:
                  </p>
                </>
              )}
            </div>
          )}

          {!signedIn && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                  <Sparkles size={13} />
                  {FREE_TRIAL_PACK.name} ($0)
                </span>
                <p className="text-xs text-emerald-700">
                  {FREE_TRIAL_PACK.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startPackCheckout(FREE_TRIAL_PACK)}
                disabled={Boolean(busy)}
                className={PRIMARY_BUTTON}
              >
                {busy === FREE_TRIAL_PACK.id ? 'Starting…' : <>Start 3-Day Free Trial <ExternalLink size={12} /></>}
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {signedIn ? 'Top up AI Credits (One-time · Never expires)' : 'Buy AI Credits (One-time · Never expires)'}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => startPackCheckout(pack)}
                  disabled={Boolean(busy)}
                  className="rounded-xl border border-slate-200 hover:border-slate-400 bg-surface p-3 text-left transition-colors flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-xs font-bold text-slate-900">{pack.shortName}</span>
                    <span className="text-xs font-extrabold text-indigo-600">${pack.priceUsd}</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-700">
                    {pack.credits.toLocaleString()} Credits
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                    {busy === pack.id ? 'Opening…' : <>Buy pack <ExternalLink size={10} /></>}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {waitingPack && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">
                Complete your {waitingPack.shortName} (${waitingPack.priceUsd}) purchase in the browser tab that opened.
              </p>
              <p>
                {signedIn
                  ? <>Once finished, click <strong>Refresh balance</strong>.</>
                  : <>Once finished, enter your checkout email above and click <strong>Email me a code</strong>.</>}
              </p>
            </div>
          )}

          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`inline-flex items-center gap-1.5 text-xs ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-600'}`}
            >
              {message.kind === 'ok' ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
              {message.text}
            </p>
          )}
        </div>
      )}
    />
  );
}


export default function DesktopProviderSettings({ guardRef }) {
  const [saved, setSaved] = useState(null); // provider.get() result
  const [draft, setDraft] = useState({ id: USER_PROVIDER_OPTIONS[0].id, model: '', baseUrl: '', apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'busy' | 'ok' | 'error', text }
  const modelList = useProviderModels({
    ...draft,
    hasSavedKey: Boolean(saved?.hasKey && saved.id === draft.id),
  });

  useEffect(() => {
    providerApi.get().then((info) => {
      setSaved(info);
      if (info.id) setDraft({ id: info.id, model: info.model, baseUrl: info.baseUrl || '', apiKey: '' });
    }).catch((err) => {
      logError('Could not read the AI settings', err);
      setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not read the AI settings.' });
    });
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
      logError(`Could not save the AI provider settings (${draft.id})`, err);
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
      logError(`AI provider test request failed (${draft.id}, ${draft.model.trim()})`, err);
      setStatus({ kind: 'error', text: err?.message || 'The test request failed.' });
    }
  };

  const onClear = async () => {
    setConfirmClear(false);
    try {
      const next = await providerApi.clear();
      setSaved((prev) => ({ ...prev, ...next }));
      setDraft({ id: USER_PROVIDER_OPTIONS[0].id, model: '', baseUrl: '', apiKey: '' });
      setShowKey(false);
      setStatus(null);
    } catch (err) {
      logError('Could not clear the AI provider settings', err);
      setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not clear.' });
    }
  };

  const busy = status?.kind === 'busy';

  return (
    <>
    <AppBlipsCreditsRow byokActive={Boolean(active)} onClearByok={onClear} />
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
            {local ? 'Start your local server and load a model that supports tool calling. The server URL must include /v1. No API key is required unless your server uses authentication.' : <>{isDesktop
              ? 'Your key is encrypted with your system keychain and stored only on this computer, never in your projects.'
              : 'Your key is saved by AppBlips on this computer, in a file only you can read. It is never stored in the browser or in your projects.'}</>}
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
            <button type="button" onClick={() => setConfirmClear(true)} disabled={!saved?.id || busy} className={SECONDARY_BUTTON}>
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
    {/* Portaled out of the settings card: a fixed overlay inside it would be
        clipped by the card's overflow. */}
    {confirmClear && createPortal(
      <ConfirmModal
        title="Clear AI provider?"
        subtitle="This removes your saved settings."
        onClose={() => setConfirmClear(false)}
        onConfirm={onClear}
        confirmLabel="Clear"
        confirmClass="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
      >
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
          <TriangleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
          <span>
            Your saved provider, model and API key will be removed. You'll need to enter them again before you can build.
          </span>
        </div>
      </ConfirmModal>,
      document.body,
    )}
    </>
  );
}
