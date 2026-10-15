import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, Cpu, Eye, EyeOff,
  KeyRound, Laptop, Loader2, Sparkles, X, Zap,
} from 'lucide-react';
import { ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';
import { logError, logWarn } from '../lib/errorLog';
import { USER_PROVIDER_OPTIONS } from '../../electron/server/providers.js';
import ModelCombobox from './ModelCombobox';
import useProviderModels from '../hooks/useProviderModels';

const defaultProvider = USER_PROVIDER_OPTIONS[0];

// One labelled field. `error` appears only after the user has tried to
// continue, so an untouched form doesn't open covered in red.
function SetupField({ title, optional, error, children }) {
  return (
    <div className={`onboarding-field ${error ? 'is-invalid' : ''}`}>
      <span className="onboarding-field-label">{title}{optional && <em>Optional</em>}</span>
      {children}
      {error && <p className="onboarding-field-error" role="alert"><CircleAlert size={15} /> {error}</p>}
    </div>
  );
}

// OpenRouter's mark (two routes merging); the other providers get a generic
// glyph rather than a copied logo.
function ProviderGlyph({ id }) {
  if (id !== 'openrouter') return <Cpu size={18} />;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12h3.5c2.5 0 3.5-5 7-5H17" /><path d="M2 12h3.5c2.5 0 3.5 5 7 5H17" />
      <path d="M15 4.5 18 7l-3 2.5" /><path d="M15 14.5 18 17l-3 2.5" />
    </svg>
  );
}

function SetupForm({ formRef, onSubmit, provider, setProviderId, baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption, errors }) {
  const modelList = useProviderModels({ id: provider.id, apiKey, baseUrl });
  const keyUrl = provider.id === 'gemini' ? 'https://aistudio.google.com/apikey' : provider.id === 'deepseek' ? 'https://platform.deepseek.com/api_keys' : provider.id === 'openai' ? 'https://platform.openai.com/api-keys' : provider.id === 'anthropic' ? 'https://platform.claude.com/settings/keys' : 'https://openrouter.ai/settings/keys';

  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Provider">
        <span className="onboarding-select-wrap">
          <ProviderGlyph id={provider.id} />
          <select value={provider.id} onChange={(event) => setProviderId(event.target.value)} className="onboarding-select" aria-label="AI provider">
            {USER_PROVIDER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <ChevronDown size={18} />
        </span>
        {provider.local && (
          <>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={provider.baseUrl} className="onboarding-select onboarding-url" aria-label="Local server URL" />
            <p className="onboarding-key-help">Start your local server and load a model that supports tool calling.</p>
          </>
        )}
      </SetupField>

      <SetupField title="API key" optional={provider.local} error={errors.key}>
        <span className="onboarding-key-input">
          <KeyRound size={19} />
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider.local ? 'Optional API key' : `Your ${provider.label} API key`}
            aria-label={`${provider.label} API key`}
            aria-invalid={Boolean(errors.key)}
            data-field="key"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
            {showKey ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </span>
        {!provider.local && (
          <p className="onboarding-key-help">
            {isDesktop ? 'Stays on this computer.' : 'Saved by AppBlips on this computer, not in the browser.'}
            <a href={keyUrl} target="_blank" rel="noopener noreferrer">Get a key <ArrowUpRight size={15} /></a>
          </p>
        )}
        {!provider.local && isDesktop && weakEncryption && (
          <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
        )}
      </SetupField>

      <SetupField title="Model" error={errors.model}>
        <div data-field="model">
          <ModelCombobox
            value={model}
            onChange={setModel}
            models={modelList.models}
            loading={modelList.loading}
            allowCustom
            placeholder="Select a model or enter its ID…"
          />
        </div>
        {modelList.error && <p className="onboarding-key-help" role="status">{modelList.error} Type a model ID to continue.</p>}
      </SetupField>
    </form>
  );
}

// `onExit` is only passed when onboarding is replayed from Settings: the user
// already has (or deliberately skipped) a setup, so they may leave without
// re-entering a key. A first run offers "Skip for now" instead, which saves
// that onboarding is done so it doesn't come back on the next launch.
export default function DesktopOnboarding({ providerInfo, onComplete, onExit }) {
  const [providerId, setProviderId] = useState(providerInfo?.id || defaultProvider.id);
  const provider = USER_PROVIDER_OPTIONS.find((option) => option.id === providerId) || defaultProvider;
  const [baseUrl, setBaseUrl] = useState(providerInfo?.baseUrl || '');
  const changeProvider = (id) => { setProviderId(id); setModel(''); setApiKey(''); setBaseUrl(''); };
  const [model, setModel] = useState(
    (providerInfo?.id === provider.id && providerInfo?.model) || provider.models[0]?.id || '',
  );
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null);
  // Set when "Start building" is pressed with fields missing; from then on the
  // missing fields stay marked until they are filled in.
  const [attempted, setAttempted] = useState(false);
  const titleRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const needsKey = !provider.local && !apiKey.trim();
  const needsModel = !model.trim();
  const errors = attempted ? {
    key: needsKey ? `Paste your ${provider.label} API key here.` : '',
    model: needsModel ? 'Choose a model, or type its ID.' : '',
  } : {};
  const busy = status?.kind === 'busy' || status?.kind === 'ok';

  const save = async () => {
    if (busy) return;
    if (needsKey || needsModel) {
      setAttempted(true);
      const first = formRef.current?.querySelector(needsKey ? '[data-field="key"]' : '[data-field="model"] input');
      first?.focus();
      return;
    }
    setStatus({ kind: 'busy', text: 'Saving your AI setup…' });
    try {
      await providerApi.set({ enabled: true, id: provider.id, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setStatus({ kind: 'ok', text: 'You’re ready.' });
      window.setTimeout(onComplete, 350);
    } catch (error) {
      logError(`Could not save the AI setup (${provider.id})`, error);
      setStatus({ kind: 'error', text: ipcErrorMessage(error) || 'Could not save your AI setup.' });
    }
  };

  const skip = async () => {
    if (busy) return;
    try {
      await providerApi.set({ onboardingComplete: true });
    } catch (err) {
      // Not remembering the skip only means setup shows again next launch.
      logWarn('Could not remember that AI setup was skipped', err);
    }
    onComplete();
  };

  // Tell the user exactly what is still missing, so "Start building" never
  // looks like a dead end.
  const missing = needsModel && needsKey ? 'Connect a provider to continue.'
    : needsModel ? 'Choose a model to continue.'
      : needsKey ? 'Paste your API key to continue.' : '';

  return (
    <div className="desktop-onboarding" role="dialog" aria-modal="true" aria-labelledby="desktop-onboarding-title">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="onboarding-logo-key" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
        </filter>
      </svg>
      <div className="onboarding-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <main className="desktop-onboarding-card is-setup">
        <header className="onboarding-topbar">
          <img src="/newlog.webp" alt="AppBlips" />
          {onExit ? (
            <button type="button" className="onboarding-exit" onClick={onExit} disabled={status?.kind === 'busy'}>
              Exit setup <X size={15} />
            </button>
          ) : (
            <span><Laptop size={20} /> {isDesktop ? 'Desktop setup' : 'Setup'}</span>
          )}
        </header>

        <div className="onboarding-stage">
          <section className="onboarding-copy">
            <span className="onboarding-eyebrow"><Sparkles size={14} /> Welcome to AppBlips</span>
            <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
              Choose the AI that <span className="onboarding-title-accent">builds with you.</span>
            </h1>
            <p>Connect through Anthropic, OpenAI, Gemini, DeepSeek, or OpenRouter, or use LM Studio or Ollama on this computer. You can change this later in Settings.</p>
            <div className={`onboarding-your-turn ${attempted && missing ? 'is-invalid' : ''}`} aria-live="polite">
              <span className="onboarding-your-turn-icon">{missing ? <Zap size={24} /> : <Check size={24} />}</span>
              <span><strong>{missing ? 'Your turn' : 'All set'}</strong>{missing || 'Click Start building to begin.'}</span>
            </div>
          </section>
          <section className="onboarding-visual-wrap">
            <SetupForm
              formRef={formRef}
              onSubmit={save}
              provider={provider}
              setProviderId={changeProvider}
              {...{ baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey, errors }}
              weakEncryption={providerInfo?.weakEncryption}
            />
          </section>
        </div>

        <footer className="onboarding-footer">
          <div>
            {!onExit && (
              <button type="button" className="onboarding-skip" onClick={skip} disabled={busy}>
                Skip for now
              </button>
            )}
          </div>
          <div className="onboarding-actions">
            {status?.kind === 'error' && <span className="onboarding-error" role="alert"><CircleAlert size={15} /> {status.text}</span>}
            <button
              type="button"
              className="onboarding-next"
              onClick={save}
              disabled={busy}
            >
              {status?.kind === 'busy' ? <Loader2 className="animate-spin" size={18} /> : status?.kind === 'ok' && <Check size={18} />}
              {busy ? status.text : <>Start building <ArrowRight size={18} /></>}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
