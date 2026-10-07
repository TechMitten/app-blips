import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleAlert, Code2, Eye, EyeOff,
  Gamepad2, KeyRound, Layers3, Loader2, LockKeyhole, MonitorSmartphone,
  MousePointer2, Palette, Rocket, Smartphone, Sparkles, WandSparkles, X,
} from 'lucide-react';
import { ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';
import { USER_PROVIDER_OPTIONS } from '../../electron/server/providers.js';
import ModelCombobox from './ModelCombobox';
import useProviderModels from '../hooks/useProviderModels';

const defaultProvider = USER_PROVIDER_OPTIONS[0];



function IdeaVisual() {
  return (
    <div className="desktop-onboarding-visual idea-visual" aria-hidden="true">
      <div className="onboarding-prompt-card">
        <span className="onboarding-avatar"><Sparkles size={17} /></span>
        <span>Build a calm habit tracker with weekly insights</span>
        <span className="onboarding-send"><ArrowRight size={15} /></span>
      </div>
      <div className="onboarding-build-line"><span /><WandSparkles size={20} /><span /></div>
      <div className="onboarding-app-window">
        <div className="onboarding-window-bar"><i /><i /><i /><b>My habits</b></div>
        <div className="onboarding-window-body">
          <div className="onboarding-mini-sidebar"><i /><i /><i /></div>
          <div className="onboarding-mini-content">
            <span className="onboarding-kicker">GOOD MORNING</span>
            <strong>Small steps, real progress.</strong>
            <div className="onboarding-stat-row"><i /><i /><i /></div>
            <div className="onboarding-chart"><span /><span /><span /><span /><span /><span /><span /></div>
          </div>
        </div>
        <span className="onboarding-live-pill"><i /> Live preview</span>
      </div>
    </div>
  );
}

function WorkflowVisual() {
  return (
    <div className="desktop-onboarding-visual workflow-visual" aria-hidden="true">
      <div className="onboarding-orbit orbit-one" />
      <div className="onboarding-orbit orbit-two" />
      <div className="onboarding-center-mark"><Layers3 size={31} /></div>
      <div className="onboarding-float-card float-app"><Smartphone size={21} /><span>App</span></div>
      <div className="onboarding-float-card float-site"><MonitorSmartphone size={21} /><span>Website</span></div>
      <div className="onboarding-float-card float-game"><Gamepad2 size={21} /><span>Game</span></div>
      <div className="onboarding-tool-chip tool-palette"><Palette size={15} /> Click to edit</div>
      <div className="onboarding-tool-chip tool-code"><Code2 size={15} /> Own the code</div>
      <div className="onboarding-tool-chip tool-ship"><Rocket size={15} /> Export</div>
      <MousePointer2 className="onboarding-cursor" size={25} />
    </div>
  );
}

function SetupVisual({ provider, setProviderId, baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {
  const modelList = useProviderModels({ id: provider.id, apiKey, baseUrl });

  return (
    <div className="desktop-onboarding-setup flex flex-col h-full bg-[#111827]/60">
      <div className="onboarding-setup-heading">
        <span className="onboarding-setup-icon"><Bot size={23} /></span>
        <span><strong>{provider.label}</strong><small>{provider.local ? 'Use a model running on this computer' : provider.id === 'openrouter' ? 'One key, your choice of leading models' : `Connect directly to ${provider.label}’s API`}</small></span>
        <span className="onboarding-private-badge"><LockKeyhole size={12} /> Private</span>
      </div>

      <label className="onboarding-key-label">
        <span>Provider</span>
        <select value={provider.id} onChange={(event) => setProviderId(event.target.value)} className="rounded-lg p-2" style={{ backgroundColor: '#1e293b', color: '#f1f5f9', colorScheme: 'dark' }}>
          {USER_PROVIDER_OPTIONS.map((option) => <option key={option.id} value={option.id} style={{ backgroundColor: '#1e293b', color: '#f1f5f9' }}>{option.label}</option>)}
        </select>
      </label>
      {provider.local && <label className="onboarding-key-label">
        <span>Local server URL</span>
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={provider.baseUrl} className="rounded-lg bg-slate-800 p-2 text-slate-100" />
      </label>}
      <fieldset className="onboarding-model-fieldset flex flex-col gap-2 !pb-2">
        <label className="text-sm font-semibold text-slate-200">Choose your model</label>
        <ModelCombobox
          value={model}
          onChange={setModel}
          models={modelList.models}
          loading={modelList.loading}
          allowCustom
          placeholder="Select a model or enter its ID…"
        />
        <button type="button" onClick={modelList.refresh} disabled={modelList.loading || modelList.needsKey} className="text-sm text-slate-300 disabled:opacity-50">Refresh models</button>
        {modelList.needsKey && <p className="onboarding-key-help">Enter your API key to load models, or enter a model ID manually.</p>}
        {modelList.error && <p className="onboarding-key-help" role="status">{modelList.error} Type a model ID to continue.</p>}
      </fieldset>

      <label className="onboarding-key-label">
        <span>{provider.local ? 'API key (optional)' : `${provider.label} API key`}</span>
        <span className="onboarding-key-input">
          <KeyRound size={17} />
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider.local ? 'Optional API key' : `Your ${provider.label} API key`}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <p className="onboarding-key-help">
        {provider.local ? 'Start your local server and load a model that supports tool calling. Use its exact model name and a URL ending in /v1.' : <>{isDesktop ? 'Your key stays on this computer and is encrypted with your system keychain.' : 'Your key is stored locally in your browser and is never sent to our servers.'}{' '}
        <a href={provider.id === 'gemini' ? 'https://aistudio.google.com/apikey' : provider.id === 'deepseek' ? 'https://platform.deepseek.com/api_keys' : provider.id === 'openai' ? 'https://platform.openai.com/api-keys' : 'https://openrouter.ai/settings/keys'} target="_blank" rel="noopener noreferrer">Create a {provider.label} key</a></>}
      </p>
      {provider.id === 'openai' && <p className="onboarding-key-help">Choose an OpenAI model that supports tool calling through Chat Completions.</p>}
      {!provider.local && isDesktop && weakEncryption && (
        <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
      )}
    </div>
  );
}

const slides = [
  {
    eyebrow: 'Welcome to AppBlips',
    title: 'Turn an idea into something you can use.',
    body: 'Describe what you want in plain English. AppBlips designs it, writes the code and brings it to life in a real preview.',
    visual: <IdeaVisual />,
  },
  {
    eyebrow: 'Build your way',
    title: 'Create, refine and ship — all in one place.',
    body: 'Make apps, responsive websites and browser games. Edit visually, keep iterating in chat, then export when it feels right.',
    visual: <WorkflowVisual />,
  },
];

// `onExit` is only passed when onboarding is replayed from Settings: the user
// already has (or deliberately skipped) a setup, so they may leave at any step
// without re-entering a key. A first run has no exit, as before.
export default function DesktopOnboarding({ providerInfo, onComplete, onExit }) {
  const [step, setStep] = useState(0);
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
  const titleRef = useRef(null);
  const setup = step === slides.length;
  const total = slides.length + 1;

  useEffect(() => { titleRef.current?.focus(); }, [step]);

  const save = async () => {
    if (!model.trim() || (!provider.local && !apiKey.trim())) return;
    setStatus({ kind: 'busy', text: 'Saving your AI setup…' });
    try {
      await providerApi.set({ enabled: true, id: provider.id, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setStatus({ kind: 'ok', text: 'You’re ready.' });
      window.setTimeout(onComplete, 350);
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) || 'Could not save your AI setup.' });
    }
  };

  const content = setup ? {
    eyebrow: 'One last step',
    title: 'Choose the AI that builds with you.',
    body: 'Connect through OpenRouter, OpenAI, Gemini, or DeepSeek, or use LM Studio or Ollama on this computer. You can change this later in Settings.',
  } : slides[step];

  return (
    <div className="desktop-onboarding" role="dialog" aria-modal="true" aria-labelledby="desktop-onboarding-title">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="onboarding-logo-key" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
        </filter>
      </svg>
      <div className="onboarding-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <main className={`desktop-onboarding-card ${setup ? 'is-setup' : ''}`}>
        <header className="onboarding-topbar">
          <img src="/newlog.webp" alt="AppBlips" />
          {onExit ? (
            <button type="button" className="onboarding-exit" onClick={onExit} disabled={status?.kind === 'busy'}>
              Exit setup <X size={15} />
            </button>
          ) : (
            <span>Desktop setup</span>
          )}
        </header>

        <div className="onboarding-stage" key={step}>
          <section className="onboarding-copy">
            <span className="onboarding-eyebrow"><Sparkles size={14} /> {content.eyebrow}</span>
            <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>{content.title}</h1>
            <p>{content.body}</p>
            {!setup && (
              <div className="onboarding-benefits">
                {step === 0 ? (
                  <><span><Check size={14} /> No coding required</span><span><Check size={14} /> Your projects stay local</span></>
                ) : (
                  <><span><Check size={14} /> Visual editing</span><span><Check size={14} /> Export anytime</span></>
                )}
              </div>
            )}
          </section>
          <section className="onboarding-visual-wrap">
            {setup
              ? <SetupVisual provider={provider} setProviderId={changeProvider} {...{ baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey }} weakEncryption={providerInfo?.weakEncryption} />
              : content.visual}
          </section>
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${total}`}>
            {Array.from({ length: total }, (_, index) => <span key={index} className={index === step ? 'is-active' : index < step ? 'is-done' : ''} />)}
          </div>
          <div className="onboarding-actions">
            {step > 0 && status?.kind !== 'busy' && (
              <button type="button" className="onboarding-back" onClick={() => { setStep((value) => value - 1); setStatus(null); }}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {status?.kind === 'error' && <span className="onboarding-error" role="alert"><CircleAlert size={15} /> {status.text}</span>}
            {setup ? (
              <button type="button" className="onboarding-next" onClick={save} disabled={!model.trim() || (!provider.local && !apiKey.trim()) || status?.kind === 'busy' || status?.kind === 'ok'}>
                {status?.kind === 'busy' ? <Loader2 className="animate-spin" size={17} /> : status?.kind === 'ok' ? <Check size={17} /> : <Rocket size={17} />}
                {status?.kind === 'busy' ? status.text : status?.kind === 'ok' ? status.text : 'Start building'}
              </button>
            ) : (
              <button type="button" className="onboarding-next" onClick={() => setStep((value) => value + 1)}>
                Next <ArrowRight size={17} />
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
